import { expect, it } from 'vitest';

import { GroundWorkspaceController } from '../../src/client/application/ground-workspace-controller.js';

const DOCUMENT_ID = 'AbCdEf0123456789_-xyZA';
const CREATED_ID = 'ZyXwVu9876543210_-abCD';
const ORIGIN = 'https://ground.test';

const sessionOf = ({ capabilities, roleId, state, version = 1 }) => ({
  displayName: 'Visitor',
  documentPath: DOCUMENT_ID,
  participantSessionId: 'anonymous-user',
  participants: [],
  roleId,
  state,
  version,
  ...(capabilities ? { capabilities } : {}),
});

const PENDING = sessionOf({ roleId: 'pending', state: 'pending' });
const ACTIVE = sessionOf({
  capabilities: ['document.read', 'document.edit'],
  roleId: 'editor',
  state: 'active',
  version: 2,
});
const REVOKED = sessionOf({ roleId: 'revoked', state: 'revoked', version: 3 });

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const idle = async () => {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
};

const createGroundWorkspaceHarness = ({
  createResult = { documentId: CREATED_ID, recoveryToken: 'created-token' },
  initialSync,
  recoverResult = { recoveryToken: 'rotated-token', sequence: 7 },
  snapshots = [PENDING],
} = {}) => {
  const pendingSnapshots = [...snapshots];
  const displayNamePrompt = deferred();
  const historyCalls = [];
  const sessions = [];
  const apiCalls = [];
  const governanceListeners = new Set();

  const entry = {
    currentView: null,
    recoveryLinks: [],
    showLanding: () => {
      entry.currentView = 'landing';
    },
    requestDisplayName: () => {
      entry.currentView = 'name';
      return displayNamePrompt.promise;
    },
    resolveDisplayName: (name) => displayNamePrompt.resolve(name),
    showDocument: () => {
      entry.currentView = 'document';
    },
    showRecoveryLink: (url) => {
      entry.recoveryLinks.push(url);
    },
    showStatus: (accessState) => {
      entry.currentView = accessState;
    },
    showUnavailable: () => {
      entry.currentView = 'unavailable';
    },
  };

  const governance = {
    destroyCalls: 0,
    roles: {},
    snapshot: null,
    startCalls: [],
    recover: async (input) => {
      apiCalls.push({ input, operation: 'recover_owner' });
      return recoverResult;
    },
    refresh: async () => governance.snapshot,
    start: async (input) => {
      governance.startCalls.push(input);
      const next = pendingSnapshots.shift() ?? null;
      governance.snapshot = next;
      governanceListeners.forEach((listener) => listener(next, {
        documentPath: input.docId,
        status: next ? 'snapshot' : 'unavailable',
      }));
      return next;
    },
    subscribe: (listener) => {
      governanceListeners.add(listener);
      return () => governanceListeners.delete(listener);
    },
    destroy: () => {
      governance.destroyCalls += 1;
    },
    publish: (snapshot, status = 'snapshot') => {
      governance.snapshot = snapshot;
      governanceListeners.forEach((listener) => listener(snapshot, {
        documentPath: DOCUMENT_ID,
        status,
      }));
    },
  };

  const createSession = ({ onAuthoritativeReload }) => {
    const session = {
      destroyCalls: 0,
      initializeCalls: 0,
      onAuthoritativeReload,
      destroy: () => {
        session.destroyCalls += 1;
      },
      initialize: async () => {
        session.initializeCalls += 1;
      },
      waitForInitialSync: () => initialSync?.promise ?? Promise.resolve(),
    };
    sessions.push(session);
    return session;
  };

  const controller = new GroundWorkspaceController({
    api: {
      request: async (operation, input) => {
        apiCalls.push({ input, operation });
        if (operation === 'create_document') {
          return createResult;
        }
        throw Object.assign(new Error(operation), { code: 'GROUND_INVALID_REQUEST' });
      },
    },
    createSession,
    entry,
    governance,
    history: {
      pushState: (_state, _title, url) => historyCalls.push({ kind: 'push', url }),
      replaceState: (_state, _title, url) => historyCalls.push({ kind: 'replace', url }),
    },
    origin: ORIGIN,
  });

  return { apiCalls, controller, entry, governance, historyCalls, sessions };
};

it('keeps a new visitor Pending after only a display name and creates no editor', async () => {
  const harness = createGroundWorkspaceHarness({ snapshots: [PENDING] });

  const started = harness.controller.start({ docId: DOCUMENT_ID, type: 'document' });
  await idle();
  harness.entry.resolveDisplayName('Reviewer Agent');
  await started;

  expect(harness.governance.startCalls).toEqual([
    { displayName: 'Reviewer Agent', docId: DOCUMENT_ID },
  ]);
  expect(harness.entry.currentView).toBe('pending');
  expect(harness.sessions.length).toBe(0);
});

it('shows the landing surface without joining any document', async () => {
  const harness = createGroundWorkspaceHarness();

  await harness.controller.start({ type: 'landing' });

  expect(harness.entry.currentView).toBe('landing');
  expect(harness.governance.startCalls).toEqual([]);
});

it('shows the unavailable surface for an unroutable path', async () => {
  const harness = createGroundWorkspaceHarness();

  await harness.controller.start({ type: 'unavailable' });

  expect(harness.entry.currentView).toBe('unavailable');
  expect(harness.governance.startCalls).toEqual([]);
});

it('navigates to one canonical segment after creating a document', async () => {
  const harness = createGroundWorkspaceHarness({ snapshots: [ACTIVE] });

  const creating = harness.controller.createDocument();
  await idle();
  harness.entry.resolveDisplayName('Owner');
  await creating;

  expect(harness.apiCalls[0]).toEqual({
    input: { displayName: 'Owner' },
    operation: 'create_document',
  });
  expect(harness.historyCalls).toEqual([{ kind: 'push', url: `/${CREATED_ID}` }]);
  expect(harness.entry.recoveryLinks).toEqual([`${ORIGIN}/${CREATED_ID}?recover=created-token`]);
  expect(harness.governance.startCalls).toEqual([{ displayName: 'Owner', docId: CREATED_ID }]);
});

it('waits for collaboration readiness before revealing the document', async () => {
  const initialSync = deferred();
  const harness = createGroundWorkspaceHarness({ initialSync, snapshots: [ACTIVE] });

  const started = harness.controller.start({ docId: DOCUMENT_ID, type: 'document' });
  await idle();
  harness.entry.resolveDisplayName('Editor');
  await idle();

  expect(harness.sessions.length).toBe(1);
  expect(harness.sessions[0].initializeCalls).toBe(1);
  expect(harness.entry.currentView).not.toBe('document');

  initialSync.resolve();
  await started;
  expect(harness.entry.currentView).toBe('document');
});

it('destroys the session and shows status only when access is revoked', async () => {
  const harness = createGroundWorkspaceHarness({ snapshots: [ACTIVE] });
  const started = harness.controller.start({ docId: DOCUMENT_ID, type: 'document' });
  await idle();
  harness.entry.resolveDisplayName('Editor');
  await started;
  expect(harness.entry.currentView).toBe('document');

  harness.governance.publish(REVOKED);
  await idle();

  expect(harness.sessions[0].destroyCalls).toBe(1);
  expect(harness.entry.currentView).toBe('revoked');
});

it('rebuilds a fresh session from server data after a rejected optimistic edit', async () => {
  const harness = createGroundWorkspaceHarness({ snapshots: [ACTIVE] });
  const started = harness.controller.start({ docId: DOCUMENT_ID, type: 'document' });
  await idle();
  harness.entry.resolveDisplayName('Editor');
  await started;

  harness.sessions[0].onAuthoritativeReload({ reason: 'GROUND_FORBIDDEN', status: 'frozen' });
  await idle();

  expect(harness.sessions[0].destroyCalls).toBe(1);
  expect(harness.sessions.length).toBe(2);
  expect(harness.sessions[1].initializeCalls).toBe(1);
});

it('replaces the recovery url before requesting recovery and shows the new link once', async () => {
  const harness = createGroundWorkspaceHarness({ snapshots: [ACTIVE] });

  const recovering = harness.controller.recoverOwner({
    docId: DOCUMENT_ID,
    recoveryToken: 'used-token',
  });
  await idle();
  harness.entry.resolveDisplayName('Owner');
  await recovering;

  const replaceIndex = harness.historyCalls.findIndex(({ kind }) => kind === 'replace');
  const recoverIndex = harness.apiCalls.findIndex(
    ({ operation }) => operation === 'recover_owner',
  );
  expect(harness.historyCalls[replaceIndex]).toEqual({ kind: 'replace', url: `/${DOCUMENT_ID}` });
  expect(recoverIndex).toBeGreaterThanOrEqual(0);
  expect(harness.entry.recoveryLinks).toEqual([`${ORIGIN}/${DOCUMENT_ID}?recover=rotated-token`]);
});

it('releases the governance client and session on destroy', async () => {
  const harness = createGroundWorkspaceHarness({ snapshots: [ACTIVE] });
  const started = harness.controller.start({ docId: DOCUMENT_ID, type: 'document' });
  await idle();
  harness.entry.resolveDisplayName('Editor');
  await started;

  harness.controller.destroy();

  expect(harness.sessions[0].destroyCalls).toBe(1);
  expect(harness.governance.destroyCalls).toBe(1);
});
