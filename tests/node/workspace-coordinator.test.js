import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkspaceCoordinator } from '../../src/client/application/workspace-coordinator.js';
import { EditorSession } from '../../src/client/infrastructure/editor-session.js';
import * as appShell from '../../src/client/bootstrap/collabmd-app-shell.js';

const activeSnapshot = ({
  capabilities = ['document.read', 'document.suggest', 'document.edit'],
  roleId = 'editor',
  state = 'active',
  version = 1,
} = {}) => ({
  capabilities,
  displayName: 'Tester',
  documentPath: 'README.md',
  kind: 'human',
  participantSessionId: 'participant-1',
  roleId,
  state,
  version,
});

const hasGovernanceCapability = (snapshot, capability) => snapshot?.state === 'active'
  && snapshot.capabilities.includes(capability);

const createStateStore = () => ({
  currentFilePath: null,
  sessionLoadToken: 0,
});

const createSession = (events) => ({
  activateCollaborativeView() {
    events.push('activate');
  },
  applyTheme(theme) {
    events.push(`theme:${theme}`);
  },
  destroy() {
    events.push('destroy');
  },
  ensureInitialContent() {
    events.push('ensure-content');
  },
  async initialize(filePath) {
    events.push(`initialize:${filePath}`);
  },
  requestMeasure() {
    events.push('measure');
  },
  async waitForInitialSync() {
    events.push('wait-sync');
  },
});

const createCoordinator = (overrides = {}) => {
  const events = [];
  const stateStore = overrides.stateStore ?? createStateStore();
  const snapshotRef = overrides.snapshotRef ?? { current: activeSnapshot() };
  const session = overrides.session ?? createSession(events);
  let sessionOptions = null;
  let createSessionCalls = 0;
  let loadSessionClassCalls = 0;
  const vaultFiles = overrides.vaultFiles ?? ['README.assets/image.png', 'README.md', 'docs/guide.md'];
  const documentFiles = overrides.documentFiles ?? ['README.md', 'docs/guide.md'];

  const coordinator = new WorkspaceCoordinator({
    cleanupAfterSessionDestroy: () => events.push('cleanup'),
    createEditorSession: (_EditorSessionClass, options) => {
      createSessionCalls += 1;
      sessionOptions = options;
      return session;
    },
    getFileList: () => documentFiles,
    getGovernanceSnapshot: () => snapshotRef.current,
    getLineWrappingEnabled: () => true,
    getLocalUser: () => ({ name: 'Tester' }),
    getStoredUserName: () => 'Tester',
    getTheme: () => 'light',
    getVaultFileList: () => vaultFiles,
    getVimModeEnabled: () => false,
    hasGovernanceCapability,
    isTabActive: () => true,
    loadEditorSessionClass: async () => {
      loadSessionClassCalls += 1;
      return EditorSession;
    },
    onConnectionChange: (state) => events.push(`connection:${state.status}`),
    onContentChange: () => events.push('content'),
    onFileAwarenessChange: () => events.push('awareness'),
    onFileOpenError: ({ code, filePath }) => events.push(`error:${code}:${filePath}`),
    onFileOpenReady: (readySession) => events.push(`ready:${Boolean(readySession)}`),
    onGovernanceAccessChanged: ({ discarded, state }) => events.push(`access:${state}:${discarded}`),
    onGovernanceDocumentCleared: () => events.push('document-cleared'),
    onSelectionChange: () => events.push('selection'),
    onSessionAssigned: (assigned) => events.push(`assigned:${Boolean(assigned)}`),
    onUpdateCurrentFile: (filePath) => events.push(`current:${filePath}`),
    onUpdateLobbyCurrentFile: (filePath) => events.push(`lobby:${filePath}`),
    refreshGovernanceSnapshot: overrides.refreshGovernanceSnapshot,
    stateStore,
    ...overrides.ports,
  });

  return {
    coordinator,
    createSessionCalls: () => createSessionCalls,
    documentFiles,
    events,
    loadSessionClassCalls: () => loadSessionClassCalls,
    session,
    sessionOptions: () => sessionOptions,
    snapshotRef,
    stateStore,
    vaultFiles,
  };
};

test('EditorSession emitContentChange deduplicates repeated content', () => {
  const notifications = [];
  const session = Object.create(EditorSession.prototype);
  session.onContentChange = () => notifications.push('change');
  session.getText = () => 'hello';
  session.hasDeliveredContent = false;
  session.lastDeliveredContent = null;

  assert.equal(session.emitContentChange(), true);
  assert.equal(session.emitContentChange(), false);
  session.getText = () => 'hello world';
  assert.equal(session.emitContentChange(), true);
  assert.deepEqual(notifications, ['change', 'change']);
});

test('app shell capability callback consumes the authoritative snapshot capabilities', () => {
  const snapshot = activeSnapshot({ capabilities: ['document.read'], roleId: 'custom-reader' });

  assert.equal(appShell.hasGovernanceCapability(snapshot, 'document.read'), true);
  assert.equal(appShell.hasGovernanceCapability(snapshot, 'document.edit'), false);
});

test('WorkspaceCoordinator opens an active Markdown document and initializes one governed editor session', async () => {
  const fixture = createCoordinator();

  assert.equal(await fixture.coordinator.openFile('README.md'), true);

  assert.equal(fixture.coordinator.getSession(), fixture.session);
  assert.equal(fixture.createSessionCalls(), 1);
  assert.equal(fixture.loadSessionClassCalls(), 1);
  assert.deepEqual(fixture.events, [
    'current:README.md',
    'lobby:README.md',
    'assigned:true',
    'initialize:README.md',
    'wait-sync',
    'activate',
    'ensure-content',
    'theme:light',
    'ready:true',
    'measure',
  ]);
  const options = fixture.sessionOptions();
  assert.deepEqual({
    canComment: options.canComment,
    canEdit: options.canEdit,
    filePath: options.filePath,
    governed: options.governed,
    lineWrappingEnabled: options.lineWrappingEnabled,
    localUser: options.localUser,
    preferredUserName: options.preferredUserName,
    theme: options.theme,
    vimModeEnabled: options.vimModeEnabled,
  }, {
    canComment: false,
    canEdit: true,
    filePath: 'README.md',
    governed: true,
    lineWrappingEnabled: true,
    localUser: { name: 'Tester' },
    preferredUserName: 'Tester',
    theme: 'light',
    vimModeEnabled: false,
  });
  for (const name of [
    'getFileList',
    'getGovernanceSnapshot',
    'onAwarenessChange',
    'onConnectionChange',
    'onContentChange',
    'onSelectionChange',
  ]) {
    assert.equal(typeof options[name], 'function', name);
  }
});

test('WorkspaceCoordinator session options retain the live non-visual document index callback', async () => {
  const fixture = createCoordinator();
  await fixture.coordinator.openFile('README.md');
  const getFileList = fixture.sessionOptions().getFileList;

  assert.deepEqual(getFileList(), ['README.md', 'docs/guide.md']);
  fixture.documentFiles.push('notes/today.md');
  assert.deepEqual(getFileList(), ['README.md', 'docs/guide.md', 'notes/today.md']);
  assert.equal(getFileList().includes('README.assets/image.png'), false);
  assert.equal(Object.hasOwn(fixture.sessionOptions(), 'onImagePaste'), false);
});

test('WorkspaceCoordinator configures Reviewer sessions as non-editable', async () => {
  const fixture = createCoordinator({
    snapshotRef: {
      current: activeSnapshot({
        capabilities: ['document.read', 'document.suggest'],
        roleId: 'reviewer',
      }),
    },
  });

  await fixture.coordinator.openFile('README.md');

  assert.equal(fixture.sessionOptions().canEdit, false);
  assert.equal(fixture.sessionOptions().canComment, false);
});

test('WorkspaceCoordinator keeps pending and revoked Access states out of the editor provider', async () => {
  for (const state of ['pending', 'revoked']) {
    const fixture = createCoordinator({
      snapshotRef: {
        current: activeSnapshot({ capabilities: [], roleId: undefined, state }),
      },
    });

    assert.equal(await fixture.coordinator.openFile('README.md'), true);
    assert.equal(fixture.createSessionCalls(), 0);
    assert.equal(fixture.loadSessionClassCalls(), 0);
    assert.equal(fixture.coordinator.getSession(), null);
    assert.equal(fixture.events.includes('ready:false'), true);
  }
});

test('WorkspaceCoordinator treats a second open of the active Markdown file as a no-op', async () => {
  const fixture = createCoordinator();
  await fixture.coordinator.openFile('README.md');
  const eventsAfterFirstOpen = [...fixture.events];
  const tokenAfterFirstOpen = fixture.stateStore.sessionLoadToken;

  assert.equal(await fixture.coordinator.openFile('README.md'), true);

  assert.equal(fixture.createSessionCalls(), 1);
  assert.equal(fixture.loadSessionClassCalls(), 1);
  assert.equal(fixture.stateStore.sessionLoadToken, tokenAfterFirstOpen);
  assert.deepEqual(fixture.events, eventsAfterFirstOpen);
});

test('WorkspaceCoordinator rejects non-Markdown and missing routes without creating an editor', async () => {
  for (const filePath of ['README.assets/image.png', 'missing.md']) {
    const fixture = createCoordinator();

    assert.equal(await fixture.coordinator.openFile(filePath), false);
    assert.equal(fixture.createSessionCalls(), 0);
    assert.equal(fixture.coordinator.getSession(), null);
    assert.equal(fixture.events.includes(`error:not-found:${filePath}`), true);
  }
});

test('WorkspaceCoordinator clears an existing clean editor when Access is revoked', async () => {
  const previous = activeSnapshot();
  const next = activeSnapshot({ capabilities: [], state: 'revoked', version: 2 });
  const fixture = createCoordinator();
  await fixture.coordinator.openFile('README.md');
  fixture.session.hasUnsynchronizedLocalChanges = () => false;
  fixture.events.length = 0;
  fixture.snapshotRef.current = next;

  assert.equal(await fixture.coordinator.applyGovernanceTransition(previous, next), true);

  assert.equal(fixture.coordinator.getSession(), null);
  assert.deepEqual(fixture.events, [
    'destroy',
    'cleanup',
    'assigned:false',
    'document-cleared',
    'access:revoked:false',
  ]);
});

test('WorkspaceCoordinator reports discarded disconnected work when Access is revoked', async () => {
  const previous = activeSnapshot();
  const next = activeSnapshot({ capabilities: [], state: 'revoked', version: 2 });
  const fixture = createCoordinator();
  await fixture.coordinator.openFile('README.md');
  fixture.session.hasUnsynchronizedLocalChanges = () => true;
  fixture.events.length = 0;

  assert.equal(await fixture.coordinator.applyGovernanceTransition(previous, next), true);

  assert.equal(fixture.coordinator.getSession(), null);
  assert.deepEqual(fixture.events, [
    'destroy',
    'cleanup',
    'assigned:false',
    'document-cleared',
    'access:revoked:true',
  ]);
});

test('WorkspaceCoordinator never creates an editor when revocation wins an in-flight class load', async () => {
  const previous = activeSnapshot();
  const next = activeSnapshot({ capabilities: [], state: 'revoked', version: 2 });
  const snapshotRef = { current: previous };
  let resolveEditorSessionClass;
  const editorSessionClass = new Promise((resolve) => {
    resolveEditorSessionClass = resolve;
  });
  const fixture = createCoordinator({
    snapshotRef,
    ports: {
      loadEditorSessionClass: () => editorSessionClass,
    },
  });

  const opening = fixture.coordinator.openFile('README.md');
  await Promise.resolve();
  snapshotRef.current = next;
  await fixture.coordinator.applyGovernanceTransition(previous, next);
  resolveEditorSessionClass(EditorSession);

  assert.equal(await opening, false);
  assert.equal(fixture.createSessionCalls(), 0);
  assert.equal(fixture.coordinator.getSession(), null);
});

test('WorkspaceCoordinator recreates the editor across an active Role boundary', async () => {
  const events = [];
  const previous = activeSnapshot();
  const next = activeSnapshot({
    capabilities: ['document.read', 'document.suggest'],
    roleId: 'reviewer',
    version: 2,
  });
  const staleSession = createSession(events);
  staleSession.hasUnsynchronizedLocalChanges = () => false;
  const freshSession = createSession(events);
  const fixture = createCoordinator({
    session: staleSession,
    snapshotRef: { current: next },
    ports: {
      createEditorSession: (_EditorSessionClass, options) => {
        events.push(`fresh-can-edit:${options.canEdit}`);
        return freshSession;
      },
    },
  });
  fixture.coordinator.session = staleSession;
  fixture.stateStore.currentFilePath = 'README.md';

  assert.equal(await fixture.coordinator.applyGovernanceTransition(previous, next), true);

  assert.equal(fixture.coordinator.getSession(), freshSession);
  assert.equal(events.filter((event) => event === 'destroy').length, 1);
  assert.equal(fixture.events.filter((event) => event === 'document-cleared').length, 1);
  assert.equal(fixture.events.filter((event) => event === 'access:active:false').length, 1);
  assert.equal(events.includes('fresh-can-edit:false'), true);
});

test('WorkspaceCoordinator reconnects a frozen active editor only after governance refresh', async () => {
  const snapshot = activeSnapshot();
  const refreshedSnapshot = activeSnapshot({ version: 2 });
  let resolveRefresh;
  let reconnectCalls = 0;
  let reconnectedSnapshot = null;
  const refresh = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const session = {
    destroy() {},
    isFrozenForDisconnect: () => true,
    reconnectAfterGovernanceValidation(nextSnapshot) {
      reconnectCalls += 1;
      reconnectedSnapshot = nextSnapshot;
    },
    setCanEdit() {},
  };
  const fixture = createCoordinator({
    refreshGovernanceSnapshot: () => refresh,
    session,
    snapshotRef: { current: snapshot },
  });
  fixture.coordinator.session = session;
  fixture.stateStore.currentFilePath = 'README.md';

  const revalidating = fixture.coordinator.revalidateGovernanceAfterDisconnect();
  await Promise.resolve();
  assert.equal(reconnectCalls, 0);
  resolveRefresh(refreshedSnapshot);

  assert.equal(await revalidating, true);
  assert.equal(reconnectCalls, 1);
  assert.deepEqual(reconnectedSnapshot, refreshedSnapshot);
});

test('WorkspaceCoordinator discards a dirty disconnected Editor once and never reconnects it after downgrade', async () => {
  const previous = activeSnapshot();
  const next = activeSnapshot({
    capabilities: ['document.read', 'document.suggest'],
    roleId: 'reviewer',
    version: 2,
  });
  const events = [];
  let reconnectCalls = 0;
  const staleSession = {
    ...createSession(events),
    hasUnsynchronizedLocalChanges: () => true,
    isFrozenForDisconnect: () => true,
    reconnectAfterGovernanceValidation() {
      reconnectCalls += 1;
    },
  };
  const freshSession = { ...createSession(events), historyBoundary: 'fresh' };
  const snapshotRef = { current: previous };
  let coordinator;
  const fixture = createCoordinator({
    session: staleSession,
    snapshotRef,
    ports: {
      createEditorSession: (_EditorSessionClass, options) => {
        events.push(`fresh-can-edit:${options.canEdit}`);
        return freshSession;
      },
    },
    refreshGovernanceSnapshot: async () => {
      snapshotRef.current = next;
      await coordinator.applyGovernanceTransition(previous, next);
      return next;
    },
  });
  coordinator = fixture.coordinator;
  coordinator.session = staleSession;
  fixture.stateStore.currentFilePath = 'README.md';

  assert.equal(await coordinator.revalidateGovernanceAfterDisconnect(), false);

  assert.equal(reconnectCalls, 0);
  assert.equal(coordinator.getSession(), freshSession);
  assert.equal(events.filter((event) => event === 'destroy').length, 1);
  assert.equal(fixture.events.filter((event) => event === 'document-cleared').length, 1);
  assert.equal(fixture.events.filter((event) => event === 'access:active:true').length, 1);
  assert.equal(events.filter((event) => event === 'fresh-can-edit:false').length, 1);
  assert.equal(freshSession.historyBoundary, 'fresh');
});

test('WorkspaceCoordinator destroys a failed editor initialization and reports a safe load error', async () => {
  const events = [];
  const session = createSession(events);
  session.initialize = async () => {
    throw new Error('provider failed');
  };
  const fixture = createCoordinator({ session });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    assert.equal(await fixture.coordinator.openFile('README.md'), false);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(fixture.coordinator.getSession(), null);
  assert.deepEqual(events, ['destroy']);
  assert.equal(fixture.events.includes('assigned:false'), true);
  assert.equal(fixture.events.includes('error:load-failed:README.md'), true);
});
