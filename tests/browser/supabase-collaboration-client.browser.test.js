import * as Y from 'yjs';
import { expect, it } from 'vitest';

import { SupabaseCollaborationClient } from '../../src/client/infrastructure/supabase-collaboration-client.js';

const DOCUMENT_ID = 'AbCdEf0123456789_-xyZA';
const USER_ID = 'anonymous-user';

const ACTIVE_SNAPSHOT = Object.freeze({
  capabilities: ['document.read', 'document.suggest', 'document.edit'],
  displayName: 'Editor',
  documentPath: DOCUMENT_ID,
  participantSessionId: USER_ID,
  roleId: 'editor',
  state: 'active',
  version: 2,
});

const toBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const encodeText = (text) => {
  const doc = new Y.Doc();
  doc.getText('codemirror').insert(0, text);
  return toBase64(Y.encodeStateAsUpdate(doc));
};

const appendText = (baseUpdates, text) => {
  const doc = new Y.Doc();
  for (const update of baseUpdates) {
    Y.applyUpdate(doc, fromBase64(update));
  }
  const before = Y.encodeStateVector(doc);
  const ytext = doc.getText('codemirror');
  ytext.insert(ytext.length, text);
  return toBase64(Y.encodeStateAsUpdate(doc, before));
};

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const flush = async () => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

const createCollaborationHarness = () => {
  const calls = [];
  const channels = [];
  const appended = [];
  const hydrateQueue = [];
  let hydrateResponse = { headSequence: 0, snapshot: '', snapshotSequence: 0, updates: [] };
  let appendResult = null;

  const api = {
    request: async (operation, input) => {
      calls.push(operation);
      if (operation === 'hydrate_document') {
        const pending = hydrateQueue.shift();
        return pending ? pending.promise : hydrateResponse;
      }
      if (operation === 'append_update') {
        appended.push(input);
        if (appendResult instanceof Error) {
          throw appendResult;
        }
        return appendResult ?? { sequence: appended.length };
      }
      throw Object.assign(new Error(operation), { code: 'GROUND_INVALID_REQUEST' });
    },
  };

  const supabase = {
    channel: (topic, options) => {
      const channel = {
        handlers: new Map(),
        options,
        presence: {},
        subscribeCallback: null,
        topic,
        tracked: [],
        on: (type, filter, handler) => {
          channel.handlers.set(`${type}:${filter.event}`, handler);
          return channel;
        },
        subscribe: (callback) => {
          channel.subscribeCallback = callback;
          return channel;
        },
        track: async (state) => {
          channel.tracked.push(state);
        },
        untrack: async () => {},
        presenceState: () => channel.presence,
        emitSubscribed: () => channel.subscribeCallback?.('SUBSCRIBED'),
        emitUpdate: (payload) => channel.handlers.get('broadcast:update')({ payload }),
        emitPresenceSync: (presence) => {
          channel.presence = presence;
          return channel.handlers.get('presence:sync')?.({});
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: () => {},
  };

  return {
    api,
    appended,
    calls,
    channels,
    get channel() {
      return channels.at(-1);
    },
    createClient: (overrides = {}) => new SupabaseCollaborationClient({
      api,
      governanceSnapshot: ACTIVE_SNAPSHOT,
      supabase,
      userId: USER_ID,
      ...overrides,
    }),
    deferHydrate: () => {
      const pending = deferred();
      hydrateQueue.push(pending);
      return pending;
    },
    setAppendResult: (result) => {
      appendResult = result;
    },
    setHydrate: (response) => {
      hydrateResponse = response;
    },
  };
};

const emptyHydrate = { headSequence: 0, snapshot: '', snapshotSequence: 0, updates: [] };

const startClient = async (harness, overrides) => {
  const client = harness.createClient(overrides);
  const initializing = client.initialize(DOCUMENT_ID);
  await flush();
  harness.channel.emitSubscribed();
  return { bindings: await initializing, client };
};

it('subscribes before hydrating and buffers a notice that arrives during the fetch', async () => {
  const harness = createCollaborationHarness();
  const first = encodeText('Budget: $100K');
  const second = appendText([first], ' -> $110K');
  const pendingHydrate = harness.deferHydrate();
  const client = harness.createClient();

  const initializing = client.initialize(DOCUMENT_ID);
  await flush();

  // Subscription is established before any hydrate request leaves the client.
  expect(harness.channel.topic).toBe(`ground-document:${DOCUMENT_ID}`);
  expect(harness.channel.options.config.private).toBe(true);
  expect(harness.calls).toEqual([]);

  harness.channel.emitSubscribed();
  await flush();
  expect(harness.calls).toEqual(['hydrate_document']);

  harness.channel.emitUpdate({ sequence: 2 });
  harness.setHydrate({
    headSequence: 2,
    snapshot: first,
    snapshotSequence: 1,
    updates: [{ sequence: 2, update: second }],
  });
  pendingHydrate.resolve({ headSequence: 1, snapshot: first, snapshotSequence: 1, updates: [] });

  await initializing;

  // The buffered notice forced a second fetch; the gap check then found none.
  expect(harness.calls).toEqual(['hydrate_document', 'hydrate_document']);
  expect(client.initialSyncComplete).toBe(true);
  expect(client.getText()).toBe('Budget: $100K -> $110K');
});

it('exposes the hydrated Y.Doc bindings the editor session expects', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate({
    headSequence: 1,
    snapshot: encodeText('Launch plan'),
    snapshotSequence: 1,
    updates: [],
  });

  const { bindings, client } = await startClient(harness);

  expect(Object.keys(bindings).toSorted()).toEqual([
    'awareness',
    'commentThreads',
    'governanceActivity',
    'localUser',
    'undoManager',
    'ydoc',
    'ytext',
  ]);
  expect(bindings.ytext.toString()).toBe('Launch plan');
  expect(client.provider).toBe(null);
});

it('applies a repeated sequence only once', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate({
    headSequence: 1,
    snapshot: encodeText('One'),
    snapshotSequence: 1,
    updates: [],
  });
  const { client } = await startClient(harness);
  const callsAfterSync = harness.calls.length;

  await harness.channel.emitUpdate({ sequence: 1 });
  await harness.channel.emitUpdate({ sequence: 1 });

  expect(harness.calls.length).toBe(callsAfterSync);
  expect(client.getText()).toBe('One');
});

it('merges same-microtask local edits into one request and never overlaps requests', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  const { bindings, client } = await startClient(harness);

  bindings.ytext.insert(0, 'a');
  bindings.ytext.insert(1, 'b');
  await client.waitForPendingUpdates();

  expect(harness.appended.length).toBe(1);
  expect(harness.appended[0].documentId).toBe(DOCUMENT_ID);
  expect(harness.appended[0].expectedRoleVersion).toBe(ACTIVE_SNAPSHOT.version);
  expect(harness.appended[0].operationKind).toBe('document_edit');
  expect(typeof harness.appended[0].update).toBe('string');

  bindings.ytext.insert(2, 'c');
  await client.waitForPendingUpdates();
  expect(harness.appended.length).toBe(2);
});

it('reports unsynchronized local changes until the server acknowledges a sequence', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  const { bindings, client } = await startClient(harness);
  const acknowledgement = deferred();

  expect(client.hasUnsynchronizedLocalChanges()).toBe(false);
  harness.api.request = async (operation, input) => {
    if (operation === 'append_update') {
      harness.appended.push(input);
      await acknowledgement.promise;
      return { sequence: 4 };
    }
    return emptyHydrate;
  };

  bindings.ytext.insert(0, 'pending');
  await flush();
  expect(client.hasUnsynchronizedLocalChanges()).toBe(true);

  acknowledgement.resolve();
  await client.waitForPendingUpdates();
  expect(client.hasUnsynchronizedLocalChanges()).toBe(false);
});

it.each([
  ['GROUND_FORBIDDEN'],
  ['GROUND_UNAVAILABLE'],
  ['GROUND_STALE_STATE'],
  ['GROUND_UPDATE_TOO_LARGE'],
  ['GROUND_TEMPORARILY_UNAVAILABLE'],
])('freezes persistence and requests an authoritative reload after %s', async (code) => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  const reloads = [];
  const { bindings, client } = await startClient(harness, {
    onAuthoritativeReload: (detail) => reloads.push(detail),
  });
  harness.setAppendResult(Object.assign(new Error(code), { code }));

  bindings.ytext.insert(0, 'rejected');
  await client.waitForPendingUpdates();

  expect(reloads).toEqual([{ reason: code, status: 'frozen' }]);
  expect(client.frozen).toBe(true);

  bindings.ytext.insert(0, 'more');
  await client.waitForPendingUpdates();
  expect(harness.appended.length).toBe(1);
});

it('repeats subscribe, hydrate and the gap check on reconnect', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate({
    headSequence: 1,
    snapshot: encodeText('First'),
    snapshotSequence: 1,
    updates: [],
  });
  const { client } = await startClient(harness);

  client.pauseForDisconnect();
  expect(client.initialSyncComplete).toBe(false);
  const channelsBeforeReconnect = harness.channels.length;
  const callsBeforeReconnect = harness.calls.length;

  const reconnected = client.reconnect(ACTIVE_SNAPSHOT);
  await flush();
  expect(harness.channels.length).toBe(channelsBeforeReconnect + 1);
  harness.channel.emitSubscribed();
  await reconnected;

  expect(harness.calls.length).toBeGreaterThan(callsBeforeReconnect);
  expect(client.initialSyncComplete).toBe(true);
});

// Supabase resends the join push after a dropped socket, so the same subscribe
// callback reports SUBSCRIBED again on the same channel. Broadcast is never
// replayed, so only repeating the hydration protocol recovers what was missed.
it('rehydrates when the existing channel rejoins after a dropped connection', async () => {
  const harness = createCollaborationHarness();
  const first = encodeText('First');
  harness.setHydrate({
    headSequence: 1,
    snapshot: first,
    snapshotSequence: 0,
    updates: [],
  });
  const { bindings } = await startClient(harness);
  expect(bindings.ytext.toString()).toBe('First');

  const channelsBeforeRejoin = harness.channels.length;
  harness.setHydrate({
    headSequence: 2,
    snapshot: first,
    snapshotSequence: 0,
    updates: [{ sequence: 2, update: appendText([first], ' and second') }],
  });

  harness.channel.emitSubscribed();
  await flush();
  await flush();

  expect(harness.channels.length).toBe(channelsBeforeRejoin);
  expect(bindings.ytext.toString()).toBe('First and second');
});

// Realtime keys `presenceState()` by the Presence key, and assigns a fresh
// random key per connection when the channel declares none. Two tabs of one
// participant would then arrive under two keys, which no mocked Presence map
// can reveal.
it('declares the authenticated user id as the Presence key', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  await startClient(harness);

  expect(harness.channel.options.config.presence).toEqual({ key: USER_ID });
});

it('renders one online participant for two Presence entries sharing a user id', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  const { client } = await startClient(harness, {
    localUser: { color: '#123456', name: 'Editor' },
  });

  await harness.channel.emitPresenceSync({
    'other-user': [
      { clientId: 30, user: { color: '#00ff00', name: 'Reviewer' }, userId: 'other-user' },
    ],
    [USER_ID]: [
      { clientId: 10, user: { color: '#123456', name: 'Editor' }, userId: USER_ID },
      { clientId: 11, user: { color: '#123456', name: 'Editor' }, userId: USER_ID },
    ],
  });

  const users = client.collectUsers();
  expect(users.length).toBe(2);
  expect(users.filter((user) => user.name === 'Editor').length).toBe(1);
  expect(users.some((user) => user.name === 'Reviewer')).toBe(true);
});

it('publishes the local name and viewport through Presence', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  const { client } = await startClient(harness, {
    localUser: { color: '#123456', name: 'Editor' },
  });

  expect(client.setLocalViewport({ topLine: 12, viewportRatio: 0.5 }))
    .toEqual({ topLine: 12, viewportRatio: 0.5 });
  expect(client.setUserName('Renamed Editor')).toBe('Renamed Editor');
  await flush();

  const latest = harness.channel.tracked.at(-1);
  expect(latest.userId).toBe(USER_ID);
  expect(latest.user.name).toBe('Renamed Editor');
  expect(latest.viewport).toEqual({ topLine: 12, viewportRatio: 0.5 });
});

it('resolves waitForSequence once that sequence is applied', async () => {
  const harness = createCollaborationHarness();
  const first = encodeText('One');
  harness.setHydrate({
    headSequence: 1,
    snapshot: first,
    snapshotSequence: 1,
    updates: [],
  });
  const { client } = await startClient(harness);

  let settled = false;
  const waiting = client.waitForSequence(2).then(() => {
    settled = true;
  });
  await flush();
  expect(settled).toBe(false);

  harness.setHydrate({
    headSequence: 2,
    snapshot: first,
    snapshotSequence: 1,
    updates: [{ sequence: 2, update: appendText([first], ' Two') }],
  });
  await harness.channel.emitUpdate({ sequence: 2 });
  await waiting;

  expect(settled).toBe(true);
  expect(client.getText()).toBe('One Two');
});

it('stops persisting and clears state after destroy', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate(emptyHydrate);
  const { bindings, client } = await startClient(harness);

  client.destroy();

  expect(client.ydoc).toBe(null);
  expect(client.getText()).toBe('');
  expect(client.initialSyncComplete).toBe(false);
  bindings.ytext.insert(0, 'after destroy');
  await flush();
  expect(harness.appended.length).toBe(0);
});

// A freshly created document stores its snapshot at sequence 0, because only
// compaction ever raises `snapshot_sequence`. Skipping the snapshot in that case
// silently dropped the seeded document text and the Owner join Activity.
it('applies the snapshot of a new document whose snapshot sequence is zero', async () => {
  const harness = createCollaborationHarness();
  harness.setHydrate({
    headSequence: 0,
    snapshot: encodeText('# Launch plan'),
    snapshotSequence: 0,
    updates: [],
  });

  const { bindings, client } = await startClient(harness);

  expect(client.getText()).toBe('# Launch plan');
  expect(bindings.ytext.toString()).toBe('# Launch plan');
});

it('keeps the snapshot applied across a notice-driven rehydrate', async () => {
  const harness = createCollaborationHarness();
  const snapshot = encodeText('# Launch plan');
  harness.setHydrate({ headSequence: 0, snapshot, snapshotSequence: 0, updates: [] });
  const { client } = await startClient(harness);

  harness.setHydrate({
    headSequence: 1,
    snapshot,
    snapshotSequence: 0,
    updates: [{ sequence: 1, update: appendText([snapshot], ' v2') }],
  });
  await harness.channel.emitUpdate({ sequence: 1 });

  expect(client.getText()).toBe('# Launch plan v2');
});
