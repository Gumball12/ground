import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { createRandomUser, normalizeUserName } from '../domain/room.js';

// Updates produced by hydration carry this origin so they are never sent back.
const REMOTE_ORIGIN = Symbol('ground-remote');
// `createProposal` transacts with this exact string in src/domain/governance-proposals.js.
const PROPOSAL_CREATE_ORIGIN = 'governance-proposal-create';
const MAX_SYNC_ROUNDS = 8;

const decodeBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const encodeBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export class SupabaseCollaborationClient {
  constructor({
    api,
    governanceSnapshot = null,
    localUser = null,
    onAuthoritativeReload = null,
    onAwarenessChange = null,
    onConnectionChange = null,
    onInitialSync = null,
    preferredUserName,
    resolveAwarenessCursor = null,
    supabase,
    userId,
  }) {
    this.api = api;
    this.governanceSnapshot = governanceSnapshot;
    this.onAuthoritativeReload = onAuthoritativeReload;
    this.onAwarenessChange = onAwarenessChange;
    this.onConnectionChange = onConnectionChange;
    this.onInitialSync = onInitialSync;
    this.preferredUserName = preferredUserName;
    this.providedLocalUser = localUser;
    this.resolveAwarenessCursor = resolveAwarenessCursor ?? (() => null);
    this.supabase = supabase;
    this.userId = userId;

    this.awareness = null;
    this.channel = null;
    this.commentThreads = null;
    this.docId = null;
    this.governanceActivity = null;
    this.localUser = null;
    this.provider = null;
    this.undoManager = null;
    this.ydoc = null;
    this.ytext = null;

    this.appliedSequence = 0;
    this.buffered = new Set();
    this.buffering = false;
    this.connected = false;
    this.destroying = false;
    this.flushPending = false;
    this.frozen = false;
    this.headSequence = 0;
    this.initialSyncComplete = false;
    this.initialSyncPromise = Promise.resolve();
    this.pendingKind = null;
    this.pendingUpdates = [];
    this.pendingWork = Promise.resolve();
    this.remotePresence = {};
    this.resolveInitialSync = null;
    this.sequenceWaiters = [];
    this.syncChain = Promise.resolve();
    this.unsynchronizedLocalChanges = false;

    this.handleDocumentUpdate = (update, origin) => {
      if (this.destroying || this.frozen || origin === REMOTE_ORIGIN || !this.docId) {
        return;
      }
      this.unsynchronizedLocalChanges = true;
      this.pendingUpdates.push(update);
      if (origin === PROPOSAL_CREATE_ORIGIN) {
        this.pendingKind = 'proposal_create';
      }
      this.#scheduleFlush();
    };
  }

  async initialize(docId) {
    this.docId = docId;
    this.ydoc = new Y.Doc();
    this.ydoc.on('update', this.handleDocumentUpdate);
    this.ytext = this.ydoc.getText('codemirror');
    this.commentThreads = this.ydoc.getArray('comments');
    this.governanceActivity = this.ydoc.getArray('governanceActivity');
    this.undoManager = new Y.UndoManager(this.ytext);
    this.localUser = this.providedLocalUser ?? createRandomUser(this.preferredUserName);
    this.awareness = new Awareness(this.ydoc);
    this.awareness.setLocalStateField('user', this.localUser);
    this.awareness.on('update', () => {
      void this.#trackPresence();
    });

    await this.#connect();

    return {
      awareness: this.awareness,
      commentThreads: this.commentThreads,
      governanceActivity: this.governanceActivity,
      localUser: this.localUser,
      undoManager: this.undoManager,
      ydoc: this.ydoc,
      ytext: this.ytext,
    };
  }

  // Subscribe, hydrate, apply buffered notices, then confirm no remaining gap.
  async #connect() {
    this.beginInitialSync();
    this.buffered.clear();
    this.buffering = true;
    await this.#subscribeAndWait();
    await this.#hydrate();
    await this.#syncToHead();
    this.buffering = false;
    this.connected = true;
    this.unsynchronizedLocalChanges = this.pendingUpdates.length > 0;
    this.initialSyncComplete = true;
    this.resolveInitialSync?.();
    this.resolveInitialSync = null;
    this.onInitialSync?.();
    this.onConnectionChange?.({
      attempts: 0,
      firstConnection: true,
      hasEverConnected: true,
      status: 'connected',
      unreachable: false,
    });
  }

  #subscribeAndWait() {
    return new Promise((resolve, reject) => {
      let joined = false;
      this.channel = this.supabase
        .channel(`ground-document:${this.docId}`, { config: { private: true } })
        .on('broadcast', { event: 'update' }, ({ payload }) => this.#handleNotice(payload ?? {}))
        .on('presence', { event: 'sync' }, () => this.#handlePresenceSync())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void this.#trackPresence();
            // Supabase resends the join push after a dropped socket, so this
            // reports SUBSCRIBED again on the same channel. Broadcast is never
            // replayed, so the hydration protocol has to run again.
            if (joined) {
              this.#resync();
              return;
            }
            joined = true;
            resolve();
            return;
          }
          if (!joined
            && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
            reject(Object.assign(new Error(status), { code: 'GROUND_TEMPORARILY_UNAVAILABLE' }));
          }
        });
    });
  }

  // `#syncToHead` alone cannot recover a rejoin: the client still holds the head
  // it knew before the drop, so it has to fetch once before checking for a gap.
  #resync() {
    if (this.destroying || this.frozen) {
      return;
    }
    this.syncChain = this.syncChain
      .then(() => this.#hydrate())
      .then(() => this.#syncToHead())
      .catch(() => {});
  }

  async #hydrate() {
    const payload = await this.api.request('hydrate_document', { documentId: this.docId });
    this.headSequence = payload.headSequence;
    const pending = [];
    // A new document keeps its snapshot at sequence 0 because only compaction
    // raises `snapshot_sequence`, so the snapshot can never be gated on that
    // number. Yjs applies a known update idempotently, so replaying it is safe.
    if (payload.snapshot) {
      pending.push(decodeBase64(payload.snapshot));
    }
    for (const { sequence, update } of payload.updates) {
      if (sequence > this.appliedSequence) {
        pending.push(decodeBase64(update));
      }
    }
    if (pending.length > 0) {
      this.ydoc.transact(() => {
        for (const update of pending) {
          Y.applyUpdate(this.ydoc, update, REMOTE_ORIGIN);
        }
      }, REMOTE_ORIGIN);
    }
    this.#advanceApplied(payload.headSequence);
  }

  async #syncToHead() {
    let round = 0;
    while (this.#maxKnownSequence() > this.appliedSequence && round < MAX_SYNC_ROUNDS) {
      round += 1;
      await this.#hydrate();
    }
    this.buffered.clear();
  }

  #maxKnownSequence() {
    return Math.max(this.headSequence, ...this.buffered);
  }

  #handleNotice({ sequence }) {
    if (!Number.isInteger(sequence) || this.destroying) {
      return undefined;
    }
    if (this.buffering) {
      this.buffered.add(sequence);
      return undefined;
    }
    if (sequence <= this.appliedSequence) {
      return undefined;
    }

    this.buffered.add(sequence);
    this.syncChain = this.syncChain.then(() => this.#syncToHead()).catch(() => {});
    return this.syncChain;
  }

  #advanceApplied(sequence) {
    if (Number.isInteger(sequence) && sequence > this.appliedSequence) {
      this.appliedSequence = sequence;
    }
    const waiting = this.sequenceWaiters;
    this.sequenceWaiters = waiting.filter(({ sequence: target }) => target > this.appliedSequence);
    waiting
      .filter(({ sequence: target }) => target <= this.appliedSequence)
      .forEach(({ resolve }) => resolve());
  }

  #scheduleFlush() {
    if (this.flushPending) {
      return;
    }
    this.flushPending = true;
    this.pendingWork = this.pendingWork
      .then(() => Promise.resolve())
      .then(() => {
        this.flushPending = false;
        return this.#flushOnce();
      })
      .catch(() => {});
  }

  async #flushOnce() {
    if (this.frozen || this.destroying || !this.docId || this.pendingUpdates.length === 0) {
      return;
    }
    const merged = Y.mergeUpdates(this.pendingUpdates);
    const operationKind = this.pendingKind ?? 'document_edit';
    this.pendingUpdates = [];
    this.pendingKind = null;

    try {
      const { sequence } = await this.api.request('append_update', {
        documentId: this.docId,
        expectedRoleVersion: this.governanceSnapshot?.version,
        operationKind,
        update: encodeBase64(merged),
      });
      this.#advanceApplied(sequence);
      if (this.pendingUpdates.length === 0) {
        this.unsynchronizedLocalChanges = false;
      }
    } catch (error) {
      this.#freeze(error?.code ?? 'GROUND_TEMPORARILY_UNAVAILABLE');
    }
  }

  // A rejected or unconfirmed write means local state may no longer match the
  // server, so persistence stops and the workspace rebuilds from server data.
  #freeze(reason) {
    this.frozen = true;
    this.pendingUpdates = [];
    this.pendingKind = null;
    this.onAuthoritativeReload?.({ reason, status: 'frozen' });
  }

  async waitForPendingUpdates() {
    let observed;
    do {
      observed = this.pendingWork;
      await observed.catch(() => {});
    } while (observed !== this.pendingWork);
  }

  waitForSequence(sequence) {
    if (!Number.isInteger(sequence) || sequence <= this.appliedSequence) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.sequenceWaiters.push({ resolve, sequence });
    });
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
    this.connected = false;
    this.#removeChannel();
    this.beginInitialSync();
  }

  reconnect(governanceSnapshot = null) {
    if (governanceSnapshot) {
      this.governanceSnapshot = governanceSnapshot;
    }
    this.frozen = false;
    this.#removeChannel();
    return this.#connect();
  }

  destroy() {
    this.destroying = true;
    this.resolveInitialSync?.();
    this.resolveInitialSync = null;
    this.initialSyncComplete = false;
    this.initialSyncPromise = Promise.resolve();
    this.connected = false;
    this.unsynchronizedLocalChanges = false;
    this.pendingUpdates = [];
    this.pendingKind = null;
    this.sequenceWaiters = [];
    this.remotePresence = {};

    this.#removeChannel();
    this.awareness?.destroy();
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
    this.docId = null;
  }

  #removeChannel() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
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
    this.localUser = { ...this.localUser, name: normalizedName };
    this.awareness.setLocalStateField('user', this.localUser);
    return normalizedName;
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
      viewportRatio: Number.isFinite(viewportRatio)
        ? Math.min(Math.max(viewportRatio, 0), 1)
        : 0.35,
    };
  }

  setLocalViewport(viewport) {
    if (!this.awareness) {
      return null;
    }
    const nextViewport = this.normalizeViewport(viewport);
    this.awareness.setLocalStateField('viewport', nextViewport);
    return nextViewport;
  }

  getUserCursor(clientId, resolveCursor) {
    return resolveCursor(this.#presenceEntry(clientId)?.cursor);
  }

  getUserViewport(clientId) {
    return this.normalizeViewport(this.#presenceEntry(clientId)?.viewport);
  }

  // Presence transports one entry per tab; the Participant bar shows one row per
  // authenticated user, so entries are coalesced by user id.
  collectUsers(resolveCursor = () => null) {
    const byUser = new Map();
    for (const [userId, entries] of Object.entries(this.remotePresence)) {
      for (const entry of entries) {
        if (!entry?.user || byUser.has(userId)) {
          continue;
        }
        const cursor = resolveCursor(entry.cursor);
        byUser.set(userId, {
          ...(cursor ?? {}),
          ...entry.user,
          clientId: entry.clientId,
          hasCursor: Boolean(cursor),
          isLocal: userId === this.userId,
          viewport: this.normalizeViewport(entry.viewport),
        });
      }
    }
    return [...byUser.values()];
  }

  #presenceEntry(clientId) {
    return Object.values(this.remotePresence)
      .flat()
      .find((entry) => entry?.clientId === clientId);
  }

  #handlePresenceSync() {
    this.remotePresence = this.channel?.presenceState?.() ?? {};
    this.onAwarenessChange?.(this.collectUsers(this.resolveAwarenessCursor));
  }

  async #trackPresence() {
    if (!this.channel || !this.awareness) {
      return;
    }
    await this.channel.track({
      ...this.awareness.getLocalState(),
      clientId: this.awareness.clientID,
      userId: this.userId,
    });
  }
}
