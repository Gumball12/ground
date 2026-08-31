import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorSession } from '../../src/client/infrastructure/editor-session.js';
import { WorkspaceCoordinator } from '../../src/client/application/workspace-coordinator.js';
import * as appShell from '../../src/client/bootstrap/collabmd-app-shell.js';

function createStateStore() {
  return {
    connectionState: null,
    connectionHelpShown: false,
    currentDrawioMode: null,
    currentFilePath: null,
    sessionLoadToken: 0,
  };
}

const governanceSnapshot = ({
  capabilities = ['document.read', 'document.comment', 'document.suggest', 'document.edit'],
  issuedAt = 1,
  participantSessionId = 'participant-1',
  roleId = 'editor',
  state = 'active',
  version = 1,
} = {}) => ({
  capabilities,
  displayName: 'Tester',
  documentPath: 'README.md',
  issuedAt,
  kind: 'human',
  participantSessionId,
  roleId,
  state,
  version,
});

function hasGovernanceCapability(snapshot, capability) {
  return snapshot?.state === 'active' && snapshot.capabilities.includes(capability);
}

function createCoordinator(overrides = {}) {
  const events = [];
  const stateStore = createStateStore();
  const session = overrides.session ?? {
    activateCollaborativeView() {
      events.push('activate-collab');
    },
    applyTheme() {
      events.push('apply-theme');
    },
    destroy() {
      events.push('destroy');
    },
    ensureInitialContent() {
      events.push('ensure-content');
    },
    getScrollContainer() {
      return null;
    },
    getText() {
      return '<h1>Hello</h1>';
    },
    hasBootstrapContent() {
      return false;
    },
    initialize: async () => {
      events.push('initialize');
    },
    requestMeasure() {
      events.push('measure');
    },
    showBootstrapContent() {
      events.push('show-bootstrap');
      return true;
    },
    waitForInitialSync: async () => {
      events.push('wait-sync');
    },
  };

  const coordinator = new WorkspaceCoordinator({
    attachEditorScroller: () => {},
    beginDocumentLoad: () => {
      events.push('begin-load');
    },
    cleanupAfterSessionDestroy: () => {
      events.push('cleanup-session');
    },
    createEditorSession: () => session,
    getDisplayName: () => 'README',
    getFileList: overrides.getFileList ?? (() => [
      'README.assets/diagram.png',
      'README.md',
      'docs/brief.pdf',
      'report.html',
      'test.dsl',
      'vault/architecture.drawio',
      'vault/new-diagram.excalidraw',
      'views/board.base',
    ]),
    getVaultFileList: overrides.getVaultFileList,
    getLineWrappingEnabled: () => true,
    getLocalUser: () => null,
    getStoredUserName: () => 'Tester',
    getTheme: () => 'light',
    isDrawioFile: () => false,
    isExcalidrawFile: () => false,
    isMermaidFile: () => false,
    isPlantUmlFile: () => false,
    isStructurizrWorkspaceFile: () => false,
    isTabActive: () => true,
    loadBootstrapContent: async () => null,
    loadEditorSessionClass: async () => EditorSession,
    loadBacklinks: () => {
      events.push('load-backlinks');
    },
    onBeforeFileOpen: () => {
      events.push('before-open');
    },
    onConnectionChange: () => {},
    onContentChange: () => {
      events.push('content-change');
    },
    onFileAwarenessChange: () => {},
    onFileOpenError: () => {
      events.push('open-error');
    },
    onFileOpenReady: () => {
      events.push('open-ready');
    },
    onImagePaste: () => {
      events.push('image-paste');
    },
    onRenderBasePreview: () => {
      events.push('render-base');
    },
    onRenderDrawioPreview: () => {
      events.push('render-drawio');
    },
    onRenderExcalidrawPreview: () => {
      events.push('render-excalidraw');
    },
    onRenderHtmlPreview: () => {
      events.push('render-html');
    },
    onRenderImagePreview: () => {
      events.push('render-image');
    },
    onRenderPdfPreview: () => {
      events.push('render-pdf');
    },
    onRenderStructurizrPreview: () => {
      events.push('render-structurizr');
    },
    onSyncWrapToggle: () => {
      events.push('sync-wrap');
    },
    onUpdateActiveFile: () => {},
    onUpdateCurrentFile: () => {},
    onUpdateLobbyCurrentFile: () => {},
    onUpdateVisibleChrome: () => {},
    onViewModeReset: () => {
      events.push('reset-view');
    },
    renderPresence: () => {
      events.push('render-presence');
    },
    scrollContainerForSession: () => null,
    shouldUseDrawioPreview: () => true,
    showEditorLoading: () => {
      events.push('show-loading');
    },
    stateStore,
    ...overrides,
  });

  coordinator.waitForNextPaint = async () => {
    events.push('wait-next-paint');
  };

  return { coordinator, events, session, stateStore };
}

test('EditorSession emitContentChange deduplicates repeated content', () => {
  const notifications = [];
  const session = Object.create(EditorSession.prototype);
  session.onContentChange = () => {
    notifications.push('change');
  };
  session.getText = () => 'hello';
  session.hasDeliveredContent = false;
  session.lastDeliveredContent = null;

  assert.equal(session.emitContentChange(), true);
  assert.equal(session.emitContentChange(), false);

  session.getText = () => 'hello world';
  assert.equal(session.emitContentChange(), true);
  assert.deepEqual(notifications, ['change', 'change']);
});

test('WorkspaceCoordinator rejects missing files before creating an editor session', async () => {
  const { coordinator } = createCoordinator({ getFileList: () => ['README.md'] });

  const opened = await coordinator.openFile('__missing__.md');

  assert.equal(opened, false);
  assert.equal(coordinator.getSession(), null);
});

test('WorkspaceCoordinator clears the active path after a missing file so Governance cannot reopen it', async () => {
  const activePaths = [];
  const currentPaths = [];
  const lobbyPaths = [];
  const snapshot = governanceSnapshot();
  const { coordinator, stateStore } = createCoordinator({
    getFileList: () => ['README.md'],
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
    onUpdateActiveFile: (filePath) => activePaths.push(filePath),
    onUpdateCurrentFile: (filePath) => currentPaths.push(filePath),
    onUpdateLobbyCurrentFile: (filePath) => lobbyPaths.push(filePath),
  });

  await coordinator.openFile('README.md');
  assert.notEqual(coordinator.getSession(), null);

  assert.equal(await coordinator.openFile('__missing__.md'), false);
  assert.equal(stateStore.currentFilePath, null);
  assert.equal(currentPaths.at(-1), null);
  assert.equal(activePaths.at(-1), null);
  assert.equal(lobbyPaths.at(-1), null);

  await coordinator.applyGovernanceTransition(null, snapshot);
  assert.equal(coordinator.getSession(), null);
});

test('WorkspaceCoordinator renders an arbitrary .dsl workspace root', async () => {
  let renderedPath = null;
  const { coordinator } = createCoordinator({
    isStructurizrWorkspaceFile: (filePath) => filePath.endsWith('.dsl'),
    onRenderStructurizrPreview: (filePath) => {
      renderedPath = filePath;
    },
  });

  await coordinator.openFile('test.dsl');

  assert.equal(renderedPath, 'test.dsl');
});

test('WorkspaceCoordinator renders editable HTML source as HTML preview', async () => {
  let renderedContent = null;
  const { coordinator } = createCoordinator({
    onRenderHtmlPreview: ({ content }) => {
      renderedContent = content;
    },
  });

  await coordinator.openFile('report.html');

  assert.equal(renderedContent, '<h1>Hello</h1>');
});

test('WorkspaceCoordinator marks file open before post-paint work completes', async () => {
  const { coordinator, events } = createCoordinator();

  await coordinator.openFile('README.md');

  assert.ok(events.indexOf('open-ready') >= 0);
  assert.ok(events.indexOf('wait-next-paint') >= 0);
  assert.ok(events.indexOf('open-ready') < events.indexOf('wait-next-paint'));
  assert.ok(events.indexOf('ensure-content') > events.indexOf('wait-sync'));
  assert.ok(events.indexOf('load-backlinks') > events.indexOf('wait-next-paint'));
});

test('WorkspaceCoordinator ensures initial content after sync wait even without early content events', async () => {
  let ensureCalls = 0;
  const { coordinator } = createCoordinator({
    session: {
      applyTheme() {},
      destroy() {},
      ensureInitialContent() {
        ensureCalls += 1;
      },
      getScrollContainer() {
        return null;
      },
      hasBootstrapContent() {
        return false;
      },
      initialize: async () => {},
      requestMeasure() {},
      showBootstrapContent() {
        return false;
      },
      waitForInitialSync: async () => {},
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(ensureCalls, 1);
});

test('WorkspaceCoordinator forwards image paste handling into the editor session options', async () => {
  let sessionOptions = null;
  const { coordinator } = createCoordinator({
    createEditorSession: (_EditorSessionClass, options) => {
      sessionOptions = options;
      return {
        applyTheme() {},
        destroy() {},
        ensureInitialContent() {},
        getScrollContainer() {
          return null;
        },
        hasBootstrapContent() {
          return false;
        },
        initialize: async () => {},
        requestMeasure() {},
        showBootstrapContent() {
          return false;
        },
        waitForInitialSync: async () => {},
      };
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(typeof sessionOptions?.onImagePaste, 'function');
});

test('WorkspaceCoordinator omits image paste handling in governed mode', async () => {
  let sessionOptions = null;
  const snapshot = governanceSnapshot();
  const { coordinator } = createCoordinator({
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
    createEditorSession: (_EditorSessionClass, options) => {
      sessionOptions = options;
      return {
        activateCollaborativeView() {},
        applyTheme() {},
        destroy() {},
        ensureInitialContent() {},
        getScrollContainer() {
          return null;
        },
        hasBootstrapContent() {
          return false;
        },
        initialize: async () => {},
        requestMeasure() {},
        showBootstrapContent() {
          return false;
        },
        waitForInitialSync: async () => {},
      };
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(Object.hasOwn(sessionOptions, 'onImagePaste'), false);
});

test('WorkspaceCoordinator keeps pending Participants out of the document provider', async () => {
  let createSessionCalls = 0;
  const snapshot = governanceSnapshot({ roleId: undefined, state: 'pending' });
  const { coordinator } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {};
    },
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
  });

  assert.equal(await coordinator.openFile('README.md'), true);
  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
});

test('WorkspaceCoordinator governed disconnect starts a post-freeze governance refresh', async () => {
  const snapshot = governanceSnapshot();
  let connectionHandler = null;
  let refreshCalls = 0;
  const session = {
    activateCollaborativeView() {},
    applyTheme() {},
    destroy() {},
    ensureInitialContent() {},
    getScrollContainer: () => null,
    hasBootstrapContent: () => false,
    initialize: async () => {},
    isFrozenForDisconnect: () => true,
    reconnectAfterGovernanceValidation() {},
    requestMeasure() {},
    setCanEdit() {},
    showBootstrapContent: () => false,
    waitForInitialSync: async () => {},
  };
  const { coordinator } = createCoordinator({
    createEditorSession: (_EditorSessionClass, options) => {
      connectionHandler = options.onConnectionChange;
      return session;
    },
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
    refreshGovernanceSnapshot: async () => {
      refreshCalls += 1;
      return { ...snapshot };
    },
  });
  await coordinator.openFile('README.md');

  connectionHandler({ status: 'disconnected' });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(refreshCalls, 1);
});

test('WorkspaceCoordinator normal snapshots leave a frozen EditorSession disconnected', async () => {
  const snapshot = governanceSnapshot();
  let reconnectCalls = 0;
  let destroyCalls = 0;
  const session = {
    destroy() {
      destroyCalls += 1;
    },
    isFrozenForDisconnect: () => true,
    reconnectAfterGovernanceValidation() {
      reconnectCalls += 1;
    },
    setCanEdit() {},
  };
  const { coordinator, stateStore } = createCoordinator({
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
    session,
  });
  coordinator.session = session;
  stateStore.currentFilePath = 'README.md';

  await coordinator.applyGovernanceTransition(snapshot, { ...snapshot });

  assert.equal(reconnectCalls, 0);
  assert.equal(destroyCalls, 0);
  assert.equal(coordinator.getSession(), session);
});

test('WorkspaceCoordinator reconnects only after its post-disconnect refresh resolves', async () => {
  const snapshot = governanceSnapshot();
  let resolveRefresh;
  let reconnectCalls = 0;
  const refreshPromise = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const session = {
    destroy() {},
    isFrozenForDisconnect: () => true,
    reconnectAfterGovernanceValidation() {
      reconnectCalls += 1;
    },
    setCanEdit() {},
  };
  const { coordinator, stateStore } = createCoordinator({
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
    refreshGovernanceSnapshot: () => refreshPromise,
    session,
  });
  coordinator.session = session;
  stateStore.currentFilePath = 'README.md';

  const revalidating = coordinator.revalidateGovernanceAfterDisconnect();
  await Promise.resolve();
  assert.equal(reconnectCalls, 0);
  assert.equal(coordinator.getSession(), session);

  resolveRefresh({ ...snapshot });
  assert.equal(await revalidating, true);
  assert.equal(reconnectCalls, 1);
  assert.equal(coordinator.getSession(), session);
});

test('WorkspaceCoordinator recreates from authoritative content when document.edit is lost', async () => {
  const previous = governanceSnapshot({ roleId: 'editor', version: 1 });
  const next = governanceSnapshot({
    capabilities: ['document.read', 'document.comment', 'document.suggest'],
    issuedAt: 2,
    roleId: 'editor',
    version: 2,
  });
  const events = [];
  const session = {
    destroy() {
      events.push('destroy');
    },
    isFrozenForDisconnect: () => false,
    setCanEdit(value) {
      events.push(`can-edit:${value}`);
    },
  };
  const { coordinator, stateStore } = createCoordinator({
    getGovernanceSnapshot: () => next,
    hasGovernanceCapability,
    onGovernanceAccessChanged: (transition) => events.push(`access:${transition.state}`),
    session,
  });
  coordinator.session = session;
  stateStore.currentFilePath = 'README.md';
  coordinator.openFile = async (filePath, options) => {
    events.push(`open:${filePath}:${options.forceReload}`);
    return true;
  };

  await coordinator.applyGovernanceTransition(previous, next);

  assert.deepEqual(events, [
    'can-edit:false',
    'destroy',
    'access:active',
    'open:README.md:true',
  ]);
  assert.equal(coordinator.getSession(), null);
});

test('app shell capability callback consumes snapshot capabilities', () => {
  const snapshot = governanceSnapshot({
    capabilities: ['document.read'],
    roleId: 'custom-reader',
  });

  assert.equal(appShell.hasGovernanceCapability?.(snapshot, 'document.read'), true);
  assert.equal(appShell.hasGovernanceCapability?.(snapshot, 'document.edit'), false);
});

test('WorkspaceCoordinator destroys revoked document state and stays control-only', async () => {
  const previous = governanceSnapshot({ roleId: 'editor', version: 1 });
  const next = governanceSnapshot({ roleId: 'editor', state: 'revoked', version: 2 });
  const events = [];
  const session = {
    destroy() {
      events.push('destroy');
    },
    setCanEdit(value) {
      events.push(`can-edit:${value}`);
    },
  };
  const { coordinator, stateStore } = createCoordinator({
    getGovernanceSnapshot: () => next,
    hasGovernanceCapability,
    onGovernanceAccessChanged: (transition) => events.push(`access:${transition.state}`),
    session,
  });
  coordinator.session = session;
  stateStore.currentFilePath = 'README.md';
  coordinator.openFile = async () => {
    events.push('open');
    return true;
  };

  await coordinator.applyGovernanceTransition(previous, next);

  assert.deepEqual(events, ['can-edit:false', 'destroy', 'access:revoked']);
  assert.equal(coordinator.getSession(), null);
});

test('WorkspaceCoordinator never creates a provider after revocation wins an in-flight module load', async () => {
  const previous = governanceSnapshot({ roleId: 'editor', version: 1 });
  const next = governanceSnapshot({ roleId: 'editor', state: 'revoked', version: 2 });
  let snapshot = previous;
  let resolveEditorSessionClass;
  let createSessionCalls = 0;
  const editorSessionClassPromise = new Promise((resolve) => {
    resolveEditorSessionClass = resolve;
  });
  const { coordinator } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
        initialize: async () => {},
      };
    },
    getGovernanceSnapshot: () => snapshot,
    hasGovernanceCapability,
    loadEditorSessionClass: () => editorSessionClassPromise,
  });

  const opening = coordinator.openFile('README.md');
  await Promise.resolve();
  snapshot = next;
  await coordinator.applyGovernanceTransition(previous, next);
  resolveEditorSessionClass(EditorSession);
  await opening;

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
});

test('WorkspaceCoordinator skips creating an editor session for Excalidraw files', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    isExcalidrawFile: (filePath) => filePath?.endsWith('.excalidraw'),
  });

  await coordinator.openFile('vault/new-diagram.excalidraw');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-excalidraw'));
});

test('WorkspaceCoordinator skips creating an editor session for draw.io files', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    isDrawioFile: (filePath) => filePath?.endsWith('.drawio'),
    shouldUseDrawioPreview: () => true,
  });

  await coordinator.openFile('vault/architecture.drawio');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-drawio'));
});

test('WorkspaceCoordinator reopens draw.io files when switching from text mode back to preview mode', async () => {
  let createSessionCalls = 0;
  const existingSession = {
    destroy() {},
  };
  const { coordinator, events, stateStore } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    isDrawioFile: (filePath) => filePath?.endsWith('.drawio'),
    session: existingSession,
    shouldUseDrawioPreview: () => true,
  });
  coordinator.session = existingSession;
  stateStore.currentFilePath = 'vault/architecture.drawio';
  stateStore.currentDrawioMode = 'text';

  await coordinator.openFile('vault/architecture.drawio');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('cleanup-session'));
  assert.ok(events.includes('render-drawio'));
});

test('WorkspaceCoordinator skips creating an editor session for image attachments', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    getFileList: () => ['README.md'],
    getVaultFileList: () => ['README.assets/diagram.png', 'README.md'],
    isImageFile: (filePath) => filePath?.endsWith('.png'),
  });

  await coordinator.openFile('README.assets/diagram.png');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-image'));
});

test('WorkspaceCoordinator skips creating an editor session for PDF files', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return { destroy() {} };
    },
    isPdfFile: (filePath) => filePath?.endsWith('.pdf'),
  });

  await coordinator.openFile('docs/brief.pdf');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-pdf'));
});

test('WorkspaceCoordinator opens base files in the editor and renders the base preview', async () => {
  let createSessionCalls = 0;
  const { coordinator, events, session } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return session;
    },
    isBaseFile: (filePath) => filePath?.endsWith('.base'),
  });

  await coordinator.openFile('views/board.base');

  assert.equal(createSessionCalls, 1);
  assert.equal(coordinator.getSession(), session);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-base'));
});

test('WorkspaceCoordinator shows bootstrap content before live sync completes', async () => {
  let resolveInitialSync;
  const initialSyncPromise = new Promise((resolve) => {
    resolveInitialSync = resolve;
  });
  const { coordinator, events } = createCoordinator({
    loadBootstrapContent: async () => '# Bootstrap\n',
    session: {
      activateCollaborativeView() {
        events.push('activate-collab');
      },
      applyTheme() {
        events.push('apply-theme');
      },
      destroy() {
        events.push('destroy');
      },
      ensureInitialContent() {
        events.push('ensure-content');
      },
      getScrollContainer() {
        return null;
      },
      hasBootstrapContent() {
        return true;
      },
      initialize: async () => {
        events.push('initialize');
      },
      requestMeasure() {
        events.push('measure');
      },
      showBootstrapContent() {
        events.push('show-bootstrap');
        return true;
      },
      waitForInitialSync: async () => {
        events.push('wait-sync');
        await initialSyncPromise;
      },
    },
  });

  const openPromise = coordinator.openFile('README.md');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(events.includes('show-bootstrap'));
  assert.ok(events.includes('open-ready'));
  assert.equal(events.includes('activate-collab'), false);

  resolveInitialSync();
  await openPromise;

  assert.ok(events.includes('activate-collab'));
  assert.ok(events.indexOf('show-bootstrap') < events.indexOf('open-ready'));
});

test('WorkspaceCoordinator skips bootstrap when live sync wins the race', async () => {
  const { coordinator, events } = createCoordinator({
    loadBootstrapContent: async () => '# Bootstrap\n',
    session: {
      activateCollaborativeView() {
        events.push('activate-collab');
      },
      applyTheme() {
        events.push('apply-theme');
      },
      destroy() {
        events.push('destroy');
      },
      ensureInitialContent() {
        events.push('ensure-content');
      },
      getScrollContainer() {
        return null;
      },
      hasBootstrapContent() {
        return false;
      },
      initialize: async () => {
        events.push('initialize');
      },
      requestMeasure() {
        events.push('measure');
      },
      showBootstrapContent() {
        events.push('show-bootstrap');
        return true;
      },
      waitForInitialSync: async () => {
        events.push('wait-sync');
      },
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(events.includes('show-bootstrap'), false);
  assert.ok(events.includes('activate-collab'));
});
