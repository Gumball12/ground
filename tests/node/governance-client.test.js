import assert from 'node:assert/strict';
import test from 'node:test';

import { GovernanceClient } from '../../src/client/infrastructure/governance-client.js';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const createDeferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('restores a stored governance session before creating another', async () => {
  const storage = createStorage();
  storage.setItem('collabmd-governance-session', JSON.stringify({
    credential: 'stored-secret', documentPath: 'README.md', participantSessionId: 'participant-1',
  }));
  const requests = [];
  const client = new GovernanceClient({
    fetchImpl: async (url, options = {}) => {
      requests.push({ options, url });
      return jsonResponse({ documentPath: 'README.md', participantSessionId: 'participant-1', version: 2 });
    },
    storage,
  });

  const snapshot = await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });

  assert.equal(snapshot.version, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/governance/session');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer stored-secret');
  client.destroy();
});

test('creates a session after an unavailable restore and persists only the session tuple', async () => {
  const storage = createStorage();
  storage.setItem('collabmd-governance-session', JSON.stringify({
    credential: 'expired-secret', documentPath: 'README.md', participantSessionId: 'expired-participant',
  }));
  const requests = [];
  const client = new GovernanceClient({
    fetchImpl: async (url, options = {}) => {
      requests.push({ options, url });
      if (requests.length === 1) return jsonResponse({ error: 'Unauthorized' }, 401);
      return jsonResponse({
        credential: 'new-secret', documentPath: 'README.md', participantSessionId: 'participant-2', version: 1,
      }, 201);
    },
    storage,
  });

  try {
    await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });

    assert.equal(requests[0].options.headers.Authorization, 'Bearer expired-secret');
    assert.equal(requests[1].options.method, 'POST');
    assert.deepEqual(JSON.parse(storage.getItem('collabmd-governance-session')), {
      credential: 'new-secret', documentPath: 'README.md', participantSessionId: 'participant-2',
    });
  } finally {
    client.destroy();
  }
});

test('polls each second, rejects stale snapshots, and clears its timer on destroy', async () => {
  const storage = createStorage();
  const timers = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay) => {
    const timer = { callback, delay };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => { timer.cleared = true; };
  const responses = [
    jsonResponse({ credential: 'secret', documentPath: 'README.md', participantSessionId: 'participant-3', version: 3 }, 201),
    jsonResponse({ documentPath: 'README.md', participantSessionId: 'participant-3', version: 2 }),
  ];
  const client = new GovernanceClient({ fetchImpl: async () => responses.shift(), storage });
  const versions = [];
  const unsubscribe = client.subscribe((snapshot) => versions.push(snapshot.version));

  try {
    await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });
    assert.equal(timers[0].delay, 1000);
    await timers[0].callback();
    assert.deepEqual(versions, [3]);
    client.destroy();
    assert.equal(timers[0].cleared, true);
  } finally {
    unsubscribe();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('polling contains a fetch rejection and applies the next successful snapshot', async () => {
  const storage = createStorage();
  const timers = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    const timer = { callback };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => { timer.cleared = true; };
  const responses = [
    () => jsonResponse({
      credential: 'secret',
      documentPath: 'README.md',
      participantSessionId: 'participant-3',
      version: 1,
    }, 201),
    () => Promise.reject(new Error('network unavailable')),
    () => jsonResponse({
      documentPath: 'README.md',
      participantSessionId: 'participant-3',
      version: 2,
    }),
  ];
  const client = new GovernanceClient({ fetchImpl: async () => responses.shift()(), storage });
  const versions = [];
  const unhandledRejections = [];
  const onUnhandledRejection = (error) => unhandledRejections.push(error);
  process.on('unhandledRejection', onUnhandledRejection);
  const unsubscribe = client.subscribe((snapshot) => versions.push(snapshot.version));

  try {
    await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });
    timers[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandledRejections, []);
    assert.equal(timers[0].cleared, undefined);

    timers[0].callback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(versions, [1, 2]);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    unsubscribe();
    client.destroy();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('accepts a lower snapshot version after switching documents', async () => {
  const storage = createStorage();
  const responses = [
    jsonResponse({ credential: 'readme-secret', documentPath: 'README.md', participantSessionId: 'readme-session', version: 3 }, 201),
    jsonResponse({ credential: 'notes-secret', documentPath: 'notes.md', participantSessionId: 'notes-session', version: 1 }, 201),
  ];
  const client = new GovernanceClient({ fetchImpl: async () => responses.shift(), storage });

  try {
    await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });
    const snapshot = await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'notes.md', kind: 'human' });

    assert.equal(snapshot.documentPath, 'notes.md');
    assert.equal(snapshot.version, 1);
    assert.deepEqual(JSON.parse(storage.getItem('collabmd-governance-session')), {
      credential: 'notes-secret', documentPath: 'notes.md', participantSessionId: 'notes-session',
    });
  } finally {
    client.destroy();
  }
});

test('ignores an old document response that completes after a document switch', async () => {
  const storage = createStorage();
  let resolveReadme;
  const client = new GovernanceClient({
    fetchImpl: (url, options) => {
      const documentPath = JSON.parse(options.body).documentPath;
      if (documentPath === 'README.md') {
        return new Promise((resolve) => { resolveReadme = resolve; });
      }
      return Promise.resolve(jsonResponse({
        credential: 'notes-secret', documentPath: 'notes.md', participantSessionId: 'notes-session', version: 1,
      }, 201));
    },
    storage,
  });

  try {
    const readme = client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });
    const notes = await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'notes.md', kind: 'human' });
    resolveReadme(jsonResponse({
      credential: 'readme-secret', documentPath: 'README.md', participantSessionId: 'readme-session', version: 9,
    }, 201));

    assert.equal((await readme), null);
    assert.equal(notes.documentPath, 'notes.md');
    assert.deepEqual(JSON.parse(storage.getItem('collabmd-governance-session')), {
      credential: 'notes-secret', documentPath: 'notes.md', participantSessionId: 'notes-session',
    });
  } finally {
    client.destroy();
  }
});

test('refresh invalidates a pre-disconnect poll before issuing its own request', async () => {
  const storage = createStorage();
  const timers = [];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    const timer = { callback };
    timers.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => {
    timer.cleared = true;
  };
  const stalePoll = createDeferred();
  const freshRefresh = createDeferred();
  const responses = [
    jsonResponse({
      credential: 'secret',
      documentPath: 'README.md',
      issuedAt: 1,
      participantSessionId: 'participant-1',
      roleId: 'editor',
      state: 'active',
      version: 1,
    }, 201),
    stalePoll.promise,
    freshRefresh.promise,
  ];
  const client = new GovernanceClient({ fetchImpl: async () => responses.shift(), storage });
  const snapshots = [];
  const unsubscribe = client.subscribe((snapshot) => snapshots.push(snapshot));

  try {
    await client.restoreOrCreate({ displayName: 'Writer', documentPath: 'README.md', kind: 'human' });
    timers[0].callback();
    const refreshing = client.refresh();

    stalePoll.resolve(jsonResponse({
      documentPath: 'README.md',
      issuedAt: 1,
      participantSessionId: 'participant-1',
      roleId: 'editor',
      state: 'active',
      version: 1,
    }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(snapshots.length, 1);

    freshRefresh.resolve(jsonResponse({
      documentPath: 'README.md',
      issuedAt: 1,
      participantSessionId: 'participant-1',
      roleId: 'editor',
      state: 'active',
      version: 1,
    }));
    assert.equal((await refreshing).participantSessionId, 'participant-1');
    assert.equal(snapshots.length, 2);
    assert.equal(timers[0].cleared, true);
  } finally {
    unsubscribe();
    client.destroy();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
