import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { createRandomUser, normalizeUserName } from '../domain/room.js';
import { resolveWsBaseUrl } from './runtime-config.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

const governanceParamsFor = (snapshot, documentPath) => {
  if (snapshot?.state !== 'active'
    || snapshot.documentPath !== documentPath
    || typeof snapshot.participantSessionId !== 'string'
    || snapshot.participantSessionId.length === 0
    || !Number.isSafeInteger(snapshot.version)
    || snapshot.version <= 0) {
    return null;
  }
  return {
    governanceParticipantSessionId: snapshot.participantSessionId,
    governanceVersion: String(snapshot.version),
  };
};

export class EditorCollaborationClient {
  constructor({
    governanceSnapshot = null,
    localUser = null,
    onAwarenessChange = null,
    onConnectionChange = null,
    onInitialSync = null,
    preferredUserName,
    resolveAwarenessCursor = null,
  }) {
    this.governanceSnapshot = governanceSnapshot;
    this.onAwarenessChange = onAwarenessChange;
    this.onConnectionChange = onConnectionChange;
    this.onInitialSync = onInitialSync;
    this.preferredUserName = preferredUserName;
    this.providedLocalUser = localUser;
    this.resolveAwarenessCursor = resolveAwarenessCursor ?? (() => null);
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.ydoc = null;
    this.ytext = null;
    this.undoManager = null;
    this.commentThreads = null;
    this.governanceActivity = null;
    this.wsBaseUrl = '';
    this.initialSyncComplete = false;
    this.initialSyncPromise = Promise.resolve();
    this.resolveInitialSync = null;
    this.destroying = false;
    this.connected = false;
    this.unsynchronizedLocalChanges = false;
    this.handleDocumentUpdate = (_update, origin) => {
      if (!this.connected && origin !== this.provider) {
        this.unsynchronizedLocalChanges = true;
      }
    };
    this.handleSync = (isSynced) => {
      if (!isSynced) {
        return;
      }

      this.unsynchronizedLocalChanges = false;
      if (this.initialSyncComplete) {
        return;
      }

      this.initialSyncComplete = true;
      this.resolveInitialSync?.();
      this.resolveInitialSync = null;
      this.onInitialSync?.();
    };
  }

  normalizeViewport(viewport) {
    if (!viewport || typeof viewport !== 'object') {
      return null;
    }

    const topLine = Number(viewport.topLine);
    const viewportRatio = Number(viewport.viewportRatio);
    if (!Number.isFinite(topLine) || topLine < 1) {
      return null;
    }

    return {
      topLine: Math.max(1, Math.round(topLine)),
      viewportRatio: Number.isFinite(viewportRatio) ? Math.min(Math.max(viewportRatio, 0), 1) : 0.35,
    };
  }

  async initialize(filePath) {
    this.wsBaseUrl = resolveWsBaseUrl();
    this.ydoc = new Y.Doc();
    this.ydoc.on('update', this.handleDocumentUpdate);
    this.ytext = this.ydoc.getText('codemirror');
    this.commentThreads = this.ydoc.getArray('comments');
    this.governanceActivity = this.ydoc.getArray('governanceActivity');

    const undoManager = new Y.UndoManager(this.ytext);
    this.undoManager = undoManager;
    const governanceParams = governanceParamsFor(this.governanceSnapshot, filePath);
    const provider = new WebsocketProvider(this.wsBaseUrl, filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
      ...(governanceParams ? { params: governanceParams } : {}),
    });
    stopReconnectOnControlledClose(provider);
    const awareness = provider.awareness;
    const user = this.providedLocalUser ?? createRandomUser(this.preferredUserName);

    this.provider = provider;
    this.awareness = awareness;
    this.localUser = user;
    this.beginInitialSync();

    awareness.setLocalStateField('user', user);
    awareness.on('change', () => {
      this.onAwarenessChange?.(this.collectUsers(this.resolveAwarenessCursor));
    });

    this.trackConnectionStatus();

    provider.on('sync', this.handleSync);

    return {
      awareness,
      commentThreads: this.commentThreads,
      governanceActivity: this.governanceActivity,
      localUser: this.localUser,
      undoManager,
      ydoc: this.ydoc,
      ytext: this.ytext,
    };
  }

  beginInitialSync() {
    if (!this.initialSyncComplete && this.resolveInitialSync) {
      return;
    }
    this.initialSyncComplete = false;
    this.initialSyncPromise = new Promise((resolve) => {
      this.resolveInitialSync = resolve;
    });
  }

  pauseForDisconnect() {
    this.provider?.disconnect();
  }

  reconnect(governanceSnapshot = null) {
    const governanceParams = governanceParamsFor(governanceSnapshot, this.provider?.roomname);
    if (governanceParams) {
      this.governanceSnapshot = governanceSnapshot;
      this.provider.params = governanceParams;
    }
    this.provider?.connect();
  }

  destroy() {
    this.destroying = true;
    this.resolveInitialSync?.();
    this.resolveInitialSync = null;
    this.initialSyncComplete = false;
    this.initialSyncPromise = Promise.resolve();
    this.connected = false;
    this.unsynchronizedLocalChanges = false;

    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this.awareness = null;
    this.localUser = null;

    this.undoManager?.destroy();
    this.undoManager = null;
    this.ydoc?.off?.('update', this.handleDocumentUpdate);
    this.ydoc?.destroy();
    this.ydoc = null;
    this.ytext = null;
    this.commentThreads = null;
    this.governanceActivity = null;
  }

  waitForInitialSync(timeoutMs = 1500) {
    if (this.initialSyncComplete) {
      return Promise.resolve();
    }

    if (timeoutMs === null || timeoutMs === undefined || timeoutMs === false) {
      return this.initialSyncPromise;
    }

    return Promise.race([
      this.initialSyncPromise,
      new Promise((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  getText() {
    return this.ytext?.toString() ?? '';
  }

  hasUnsynchronizedLocalChanges() {
    return this.unsynchronizedLocalChanges;
  }

  getLocalUser() {
    return this.localUser;
  }

  setUserName(name) {
    const normalizedName = normalizeUserName(name);
    if (!normalizedName || !this.awareness || !this.localUser) {
      return null;
    }

    this.localUser = {
      ...this.localUser,
      name: normalizedName,
    };
    this.awareness.setLocalStateField('user', this.localUser);
    return normalizedName;
  }

  getUserCursor(clientId, resolveCursor) {
    if (!this.awareness) {
      return null;
    }

    const awarenessState = this.awareness.getStates().get(clientId);
    return resolveCursor(awarenessState?.cursor);
  }

  getUserViewport(clientId) {
    if (!this.awareness) {
      return null;
    }

    const awarenessState = this.awareness.getStates().get(clientId);
    return this.normalizeViewport(awarenessState?.viewport);
  }

  setLocalViewport(viewport) {
    if (!this.awareness) {
      return null;
    }

    const nextViewport = this.normalizeViewport(viewport);
    this.awareness.setLocalStateField('viewport', nextViewport);
    return nextViewport;
  }

  collectUsers(resolveCursor = () => null) {
    if (!this.awareness) {
      return [];
    }

    const users = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (!state.user) {
        return;
      }

      const cursor = resolveCursor(state.cursor);
      users.push({
        ...(cursor ?? {}),
        ...state.user,
        clientId,
        hasCursor: Boolean(cursor),
        isLocal: clientId === this.awareness.clientID,
        viewport: this.normalizeViewport(state.viewport),
      });
    });

    return users;
  }

  trackConnectionStatus() {
    if (!this.provider) {
      return;
    }

    let attempts = 0;
    let hasEverConnected = false;

    this.provider.on('status', ({ status }) => {
      this.connected = status === 'connected';
      if (status === 'connecting') {
        attempts += 1;
      }

      const firstConnection = status === 'connected' && !hasEverConnected;
      if (status === 'connected') {
        attempts = 0;
        hasEverConnected = true;
      }
      if (status === 'disconnected') {
        if (!this.destroying) {
          this.beginInitialSync();
        }
      }

      if (this.destroying) {
        return;
      }

      this.onConnectionChange?.({
        attempts,
        firstConnection,
        hasEverConnected,
        status,
        unreachable: !hasEverConnected && attempts >= 3,
        wsBaseUrl: this.wsBaseUrl,
      });
    });
  }
}
