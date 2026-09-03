const LOCK_KEY = 'collabmd-active-tab-lock';
const CHANNEL_NAME = 'collabmd-tab-lock';
const HEARTBEAT_INTERVAL_MS = 4000;

function now() {
  return Date.now();
}

function createTabId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `tab-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class TabActivityLock {
  constructor({
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    onBlocked,
    onActivated,
    onStolen,
    scope = '',
  } = {}) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.staleAfterMs = heartbeatIntervalMs * 3;
    this.onBlocked = onBlocked;
    this.onActivated = onActivated;
    this.onStolen = onStolen;
    this.scope = String(scope || '');
    this.lockKey = this.scope ? `${LOCK_KEY}:${encodeURIComponent(this.scope)}` : LOCK_KEY;
    this.channelName = this.scope ? `${CHANNEL_NAME}:${encodeURIComponent(this.scope)}` : CHANNEL_NAME;
    this.tabId = createTabId();
    this.channel = null;
    this.heartbeatTimer = null;
    this.isOwner = false;
    this.handleStorageEvent = this.handleStorageEvent.bind(this);
    this.handlePageHide = this.handlePageHide.bind(this);
  }

  initialize() {
    window.addEventListener('storage', this.handleStorageEvent);
    window.addEventListener('pagehide', this.handlePageHide);

    if ('BroadcastChannel' in globalThis) {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.addEventListener('message', (event) => {
        this.handleChannelMessage(event.data);
      });
    }
  }

  destroy() {
    this.release();
    window.removeEventListener('storage', this.handleStorageEvent);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.channel?.close();
    this.channel = null;
  }

  tryActivate({ takeover = false } = {}) {
    return this.tryAcquire({ takeover });
  }

  tryAcquire({ takeover = false } = {}) {
    const currentLock = this.readLock();
    if (this.isFreshLock(currentLock) && currentLock.tabId !== this.tabId && !takeover) {
      this.isOwner = false;
      this.stopHeartbeat();
      this.onBlocked?.({ reason: 'active-elsewhere', ownerTabId: currentLock.tabId });
      return false;
    }

    this.writeLock();
    this.startHeartbeat();
    this.isOwner = true;
    this.channel?.postMessage({ type: 'claimed', takeover, tabId: this.tabId });
    this.onActivated?.({ takeover });
    return true;
  }

  release() {
    const currentLock = this.readLock();
    if (currentLock?.tabId === this.tabId) {
      localStorage.removeItem(this.lockKey);
      this.channel?.postMessage({ type: 'released', tabId: this.tabId });
    }

    this.isOwner = false;
    this.stopHeartbeat();
  }

  readLock() {
    try {
      return safeJsonParse(window.localStorage.getItem(this.lockKey));
    } catch {
      return null;
    }
  }

  isFreshLock(lock) {
    return Boolean(
      lock
      && typeof lock.tabId === 'string'
      && Number.isFinite(lock.updatedAt)
      && (now() - lock.updatedAt) < this.staleAfterMs
    );
  }

  writeLock() {
    try {
      window.localStorage.setItem(this.lockKey, JSON.stringify({
        tabId: this.tabId,
        updatedAt: now(),
      }));
    } catch {
      // Ignore storage failures and continue in best-effort mode.
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.writeLock();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.isOwner) {
        this.stopHeartbeat();
        return;
      }

      this.writeLock();
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  handleStorageEvent(event) {
    if (event.key !== this.lockKey) {
      return;
    }

    const nextLock = safeJsonParse(event.newValue);
    this.handleExternalLockChange(nextLock);
  }

  handleChannelMessage(message) {
    if (!message || typeof message !== 'object' || message.tabId === this.tabId) {
      return;
    }

    if (message.type === 'claimed') {
      this.handleExternalLockChange(this.readLock());
    }
  }

  handleExternalLockChange(nextLock) {
    if (!this.isOwner) {
      return;
    }

    if (this.isFreshLock(nextLock) && nextLock.tabId !== this.tabId) {
      this.isOwner = false;
      this.stopHeartbeat();
      this.onStolen?.({ ownerTabId: nextLock.tabId });
    }
  }

  handlePageHide() {
    this.release();
  }
}
