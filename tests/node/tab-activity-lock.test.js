import assert from 'node:assert/strict';
import test from 'node:test';

import { TabActivityLock } from '../../src/client/infrastructure/tab-activity-lock.js';
import { uiFeatureTabActivityMethods } from '../../src/client/application/app-shell/ui-feature-tab-activity.js';

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const withBrowser = (run) => {
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const storage = createStorage();
  globalThis.window = {
    addEventListener() {}, clearInterval() {}, localStorage: storage, removeEventListener() {},
    sessionStorage: createStorage(), setInterval() { return 1; },
  };
  globalThis.localStorage = storage;
  try {
    run();
  } finally {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
};

test('different participant scopes can activate on the same origin', () => {
  withBrowser(() => {
    const owner = new TabActivityLock({ scope: 'owner-session' });
    const reviewer = new TabActivityLock({ scope: 'reviewer-session' });
    assert.equal(owner.tryAcquire(), true);
    assert.equal(reviewer.tryAcquire(), true);
  });
});

test('a duplicate tab with cloned governance and prior tab storage remains blocked', () => {
  withBrowser(() => {
    const clonedState = {
      'collabmd-governance-session': JSON.stringify({
        credential: 'owner-credential',
        documentPath: 'README.md',
        participantSessionId: 'writer-session',
      }),
      'collabmd-tab-id': 'cloned-tab-id',
    };
    window.sessionStorage = createStorage(clonedState);
    const first = new TabActivityLock({ scope: 'writer-session' });
    window.sessionStorage = createStorage(clonedState);
    const duplicate = new TabActivityLock({ scope: 'writer-session' });
    assert.notEqual(first.tabId, duplicate.tabId);
    assert.equal(first.tryAcquire(), true);
    assert.equal(duplicate.tryAcquire(), false);
  });
});

test('unscoped locks preserve the original one-tab behavior', () => {
  withBrowser(() => {
    const first = new TabActivityLock();
    window.sessionStorage = createStorage();
    const duplicate = new TabActivityLock();
    assert.equal(first.tryAcquire(), true);
    assert.equal(duplicate.tryAcquire(), false);
  });
});

test('governance tab activity waits for an active Markdown document before creating a scoped lock', async () => {
  const createdScopes = [];
  const locks = [];
  const governanceCalls = [];
  const context = {
    createTabActivityLock(scope) {
      createdScopes.push(scope);
      const lock = {
        destroy() { lock.destroyed = true; },
        initialize() { lock.initialized = true; },
        tryActivate() { lock.activated = true; },
      };
      locks.push(lock);
      return lock;
    },
    getStoredUserName: () => 'Mina',
    governanceClient: {
      async restoreOrCreate(input) {
        governanceCalls.push(input);
        return { participantSessionId: 'readme-session' };
      },
    },
    navigation: { getHashRoute: () => ({ type: 'empty' }) },
  };
  Object.assign(context, uiFeatureTabActivityMethods);

  await context.initializeGovernanceTabActivity();
  assert.deepEqual(createdScopes, ['']);
  assert.deepEqual(governanceCalls, []);

  await context.initializeGovernanceTabActivity('README.md');
  assert.deepEqual(governanceCalls, [{ displayName: 'Mina', documentPath: 'README.md', kind: 'human' }]);
  assert.deepEqual(createdScopes, ['', 'readme-session']);
  assert.equal(locks[0].destroyed, true);
  assert.equal(locks[1].initialized, true);
  assert.equal(locks[1].activated, true);
});

test('governance tab activity sends the configured AI presentation kind', async () => {
  const governanceCalls = [];
  const context = {
    createTabActivityLock: () => ({ destroy() {}, initialize() {}, tryActivate() {} }),
    getStoredUserName: () => 'Writer',
    governanceClient: {
      async restoreOrCreate(input) {
        governanceCalls.push(input);
        return { participantSessionId: 'writer-session' };
      },
    },
    runtimeConfig: { participantKind: 'ai' },
  };
  Object.assign(context, uiFeatureTabActivityMethods);

  await context.initializeGovernanceTabActivity('README.md');

  assert.deepEqual(governanceCalls, [{
    displayName: 'Writer',
    documentPath: 'README.md',
    kind: 'ai',
  }]);
});

test('governance tab activity resets a Markdown scope when the active file is not Markdown', async () => {
  const scopes = [];
  const locks = [];
  const context = {
    createTabActivityLock(scope) {
      scopes.push(scope);
      const lock = {
        destroy() { lock.destroyed = true; },
        initialize() {},
        tryActivate() {},
      };
      locks.push(lock);
      return lock;
    },
    getStoredUserName: () => 'Mina',
    governanceClient: { restoreOrCreate: async () => ({ participantSessionId: 'readme-session' }) },
  };
  Object.assign(context, uiFeatureTabActivityMethods);

  await context.initializeGovernanceTabActivity('README.md');
  await context.initializeGovernanceTabActivity('image.png');

  assert.deepEqual(scopes, ['', 'readme-session', '']);
  assert.equal(locks[1].destroyed, true);
});

test('a late Markdown bootstrap cannot replace the unscoped lock after an image transition', async () => {
  let resolveReadme;
  let destroyCalls = 0;
  const scopes = [];
  const context = {
    createTabActivityLock(scope) {
      scopes.push(scope);
      return { destroy() {}, initialize() {}, tryActivate() {} };
    },
    getStoredUserName: () => 'Mina',
    governanceClient: {
      destroy() { destroyCalls += 1; },
      restoreOrCreate: () => new Promise((resolve) => { resolveReadme = resolve; }),
    },
  };
  Object.assign(context, uiFeatureTabActivityMethods);

  const readme = context.initializeGovernanceTabActivity('README.md');
  await context.initializeGovernanceTabActivity('image.png');
  resolveReadme({ participantSessionId: 'readme-session' });
  await readme;

  assert.deepEqual(scopes, ['', '']);
  assert.equal(destroyCalls, 1);
});
