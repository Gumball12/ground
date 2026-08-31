const SESSION_STORAGE_KEY = 'collabmd-governance-session';

const parseStoredSession = (storage) => {
  try {
    const value = JSON.parse(storage.getItem(SESSION_STORAGE_KEY) || 'null');
    return typeof value?.credential === 'string'
      && typeof value?.participantSessionId === 'string'
      && typeof value?.documentPath === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
};

export class GovernanceClient {
  constructor({ fetchImpl = globalThis.fetch.bind(globalThis), pollIntervalMs = 1000, storage = sessionStorage } = {}) {
    this.fetchImpl = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
    this.storage = storage;
    this.credential = '';
    this.currentVersion = -1;
    this.documentPath = null;
    this.generation = 0;
    this.listeners = new Set();
    this.pollTimer = null;
    this.snapshot = null;
  }

  async restoreOrCreate({ documentPath, displayName, kind }) {
    const generation = this.#beginDocument(documentPath);
    const stored = parseStoredSession(this.storage);
    if (stored && stored.documentPath !== documentPath) {
      this.storage.removeItem(SESSION_STORAGE_KEY);
    }
    if (stored?.documentPath === documentPath) {
      this.credential = stored.credential;
      const restored = await this.#getSession({ documentPath, generation });
      if (restored) {
        this.#startPolling({ documentPath, generation });
        return restored;
      }
      if (!this.#isCurrent(documentPath, generation)) {
        return null;
      }
      this.storage.removeItem(SESSION_STORAGE_KEY);
      this.credential = '';
    }

    const response = await this.fetchImpl('/api/governance/session', {
      body: JSON.stringify({ displayName, documentPath, kind }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const snapshot = await response.json();
    if (!this.#isCurrent(documentPath, generation)) {
      return null;
    }
    if (!response.ok) {
      throw new Error(snapshot.error || 'Failed to create governance session');
    }

    this.credential = snapshot.credential;
    this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      credential: this.credential,
      documentPath: snapshot.documentPath,
      participantSessionId: snapshot.participantSessionId,
    }));
    this.#applySnapshot(snapshot, { documentPath, generation });
    this.#startPolling({ documentPath, generation });
    return this.snapshot;
  }

  async authorize(capability, documentPath) {
    const response = await this.fetchImpl('/api/governance/authorize', {
      body: JSON.stringify({ capability, documentPath }),
      headers: {
        Authorization: `Bearer ${this.credential}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok) {
      return {
        code: 'GOVERNANCE_AUTHORIZATION_FAILED',
        message: result.error || 'Failed to authorize governance capability',
        ok: false,
        snapshot: this.snapshot,
      };
    }
    return { ...result, snapshot: this.snapshot };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    const documentPath = this.documentPath;
    if (!documentPath || !this.credential) {
      return null;
    }

    const generation = ++this.generation;
    this.#startPolling({ documentPath, generation });
    return this.#getSession({ documentPath, generation });
  }

  destroy() {
    this.generation += 1;
    this.#stopPolling();
    this.credential = '';
    this.currentVersion = -1;
    this.documentPath = null;
    this.snapshot = null;
  }

  async #getSession({ documentPath, generation }) {
    const credential = this.credential;
    const response = await this.fetchImpl('/api/governance/session', {
      headers: credential ? { Authorization: `Bearer ${credential}` } : {},
    });
    const snapshot = await response.json();
    if (!this.#isCurrent(documentPath, generation) || !response.ok) {
      return null;
    }

    this.#applySnapshot(snapshot, { documentPath, generation });
    return this.snapshot;
  }

  #applySnapshot(snapshot, { documentPath, generation }) {
    if (!this.#isCurrent(documentPath, generation)
      || snapshot?.documentPath !== documentPath
      || !Number.isInteger(snapshot?.version)
      || snapshot.version < this.currentVersion) {
      return null;
    }

    this.currentVersion = snapshot.version;
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  #startPolling({ documentPath, generation }) {
    this.#stopPolling();
    this.pollTimer = setInterval(() => {
      void this.#getSession({ documentPath, generation }).catch(() => {});
    }, this.pollIntervalMs);
  }

  #beginDocument(documentPath) {
    this.generation += 1;
    this.#stopPolling();
    this.credential = '';
    this.currentVersion = -1;
    this.documentPath = documentPath;
    this.snapshot = null;
    return this.generation;
  }

  #isCurrent(documentPath, generation) {
    return this.documentPath === documentPath && this.generation === generation;
  }

  #stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
