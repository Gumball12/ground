import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import * as Y from 'yjs';

import { EditorSession } from '../../src/client/infrastructure/editor-session.js';
import { createCommentThreadSharedType, serializeCommentThreads } from '../../src/domain/comment-threads.js';
import {
  createProposal,
  groupReviewItems,
  resolveProposal,
} from '../../src/domain/governance-proposals.js';

const EDITOR_SNAPSHOT = Object.freeze({
  displayName: 'Writer',
  documentPath: 'README.md',
  kind: 'human',
  participantSessionId: 'writer-session',
  roleId: 'editor',
  state: 'active',
});

function attachGovernanceDocument(session, content = 'Hello') {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  const commentThreads = ydoc.getArray('comments');
  const governanceActivity = ydoc.getArray('governanceActivity');
  ytext.insert(0, content);
  Object.assign(session.collaborationClient, {
    commentThreads,
    governanceActivity,
    initialSyncComplete: true,
    ydoc,
    ytext,
  });
  return { commentThreads, governanceActivity, ydoc, ytext };
}

function createCommentBindings(content = '# Notes\n\nHello\n') {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  const commentThreads = ydoc.getArray('comments');
  ytext.insert(0, content);
  commentThreads.push([createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorKind: 'line',
    anchorQuote: 'Hello',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 3,
    createdAt: 1,
    createdByName: 'Alice',
    id: 'thread-1',
    messages: [{
      body: 'Existing comment',
      createdAt: 2,
      id: 'comment-1',
      userName: 'Alice',
    }],
  })]);

  return {
    awareness: { getStates: () => new Map() },
    commentThreads,
    localUser: null,
    undoManager: null,
    ydoc,
    ytext,
  };
}

test('EditorSession preserves collaboration compatibility getters', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const awareness = { getStates: () => new Map() };
  const provider = { connected: true, destroy() {}, disconnect() {} };
  const ydoc = { clientID: 1, destroy() {} };
  const ytext = { toString: () => '' };

  session.collaborationClient.awareness = awareness;
  session.collaborationClient.provider = provider;
  session.collaborationClient.ydoc = ydoc;
  session.collaborationClient.ytext = ytext;

  assert.equal(session.awareness, awareness);
  assert.equal(session.provider, provider);
  assert.equal(session.ydoc, ydoc);
  assert.equal(session.ytext, ytext);

  session.destroy();
});

test('EditorSession keeps bootstrap content out of Yjs until collaborative view activation', async () => {
  const contentChanges = [];
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {
      contentChanges.push(session.getText());
    },
    preferredUserName: 'Tester',
  });

  const provisionalCalls = [];
  const collaborativeCalls = [];
  session.viewAdapter.initializeProvisional = ({ content, filePath }) => {
    provisionalCalls.push({ content, filePath });
    session.viewAdapter.getText = () => content;
  };
  session.viewAdapter.initialize = ({ filePath, ytext }) => {
    collaborativeCalls.push({ filePath, text: ytext.toString() });
    session.viewAdapter.getText = () => ytext.toString();
  };

  session.collaborationClient.initialSyncComplete = false;
  session.collaborationClient.initialize = async () => {
    const ytext = {
      toString: () => '# Live\n',
    };
    session.collaborationClient.ytext = ytext;
    return {
      awareness: { getStates: () => new Map() },
      commentThreads: [],
      localUser: null,
      undoManager: null,
      ydoc: {},
      ytext,
    };
  };
  session.commentThreadStore.bind = () => {};

  assert.equal(session.showBootstrapContent({ content: '# Bootstrap\n', filePath: 'README.md' }), true);
  assert.deepEqual(provisionalCalls, [{ content: '# Bootstrap\n', filePath: 'README.md' }]);
  assert.equal(session.getText(), '# Bootstrap\n');

  await session.initialize('README.md');

  assert.equal(collaborativeCalls.length, 0);
  assert.equal(session.collaborationClient.getText(), '# Live\n');
  assert.equal(session.getText(), '# Live\n');

  assert.equal(session.activateCollaborativeView(), true);
  assert.deepEqual(collaborativeCalls, [{ filePath: 'README.md', text: '# Live\n' }]);
  assert.equal(session.bootstrapContent, null);
  assert.deepEqual(contentChanges, ['# Bootstrap\n']);
});

test('EditorSession refreshes comments after provisional and collaborative editor initialization', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  let refreshCalls = 0;
  session.commentThreadStore.refreshComments = () => {
    refreshCalls += 1;
  };
  session.viewAdapter.initializeProvisional = () => {};
  session.viewAdapter.initialize = () => {};

  assert.equal(session.showBootstrapContent({ content: '# Bootstrap\n', filePath: 'README.md' }), true);
  assert.equal(refreshCalls, 1);

  session.pendingCollaborativeBindings = {
    awareness: { getStates: () => new Map() },
    undoManager: null,
    ytext: { toString: () => '# Live\n' },
  };
  session.activeFilePath = 'README.md';

  assert.equal(session.activateCollaborativeView(), true);
  assert.equal(refreshCalls, 2);

  session.destroy();
});

test('EditorSession re-emits existing comments after collaborative editor mount', async () => {
  const commentSnapshots = [];
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: (threads) => {
      commentSnapshots.push(threads);
    },
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const collaborationBindings = createCommentBindings();
  session.viewAdapter.initialize = ({ ytext }) => {
    const state = EditorState.create({ doc: ytext.toString() });
    session.viewAdapter.getState = () => state;
    session.viewAdapter.getText = () => ytext.toString();
  };

  session.collaborationClient.initialSyncComplete = true;
  session.collaborationClient.initialize = async () => {
    session.collaborationClient.ydoc = collaborationBindings.ydoc;
    session.collaborationClient.ytext = collaborationBindings.ytext;
    return collaborationBindings;
  };

  await session.initialize('README.md');

  assert.deepEqual(commentSnapshots.map((threads) => threads.length), [0, 1]);
  assert.equal(commentSnapshots[1][0].id, 'thread-1');
  assert.equal(commentSnapshots[1][0].anchor.startLine, 3);
  assert.equal(commentSnapshots[1][0].messages[0].body, 'Existing comment');

  session.destroy();
});

test('EditorSession only toggles preview task items after collaborative sync', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const toggledLines = [];
  session.viewAdapter.toggleTaskListItem = (lineNumber) => {
    toggledLines.push(lineNumber);
    return true;
  };

  session.collaborationClient.initialSyncComplete = false;
  assert.equal(session.toggleTaskListItem(3), false);
  assert.deepEqual(toggledLines, []);

  session.collaborationClient.initialSyncComplete = true;
  assert.equal(session.toggleTaskListItem(3), true);
  assert.deepEqual(toggledLines, [3]);

  session.destroy();
});

test('EditorSession delegates editor commands to the view adapter', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const commands = [];
  session.viewAdapter.runEditorCommand = (commandId) => {
    commands.push(commandId);
    return commandId === 'undo';
  };

  assert.equal(session.runEditorCommand('undo'), true);
  assert.equal(session.runEditorCommand('redo'), false);
  assert.deepEqual(commands, ['undo', 'redo']);

  session.destroy();
});

test('EditorSession delegates replaceText to the view adapter', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const replaced = [];
  session.viewAdapter.replaceText = (text) => {
    replaced.push(text);
    return true;
  };

  assert.equal(session.replaceText('updated'), true);
  assert.deepEqual(replaced, ['updated']);

  session.destroy();
});

test('EditorSession appends distinct Proposal lifecycle and discrete local edit Activity', () => {
  const session = new EditorSession({
    canComment: () => true,
    canEdit: () => true,
    editorContainer: null,
    getGovernanceSnapshot: () => EDITOR_SNAPSHOT,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const context = attachGovernanceDocument(session);
  createProposal({
    activity: context.governanceActivity,
    comments: context.commentThreads,
    ydoc: context.ydoc,
    ytext: context.ytext,
  }, {
    actor: EDITOR_SNAPSHOT,
    anchor: {
      anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(context.ytext, 5)),
      anchorEndLine: 1,
      anchorKind: 'text',
      anchorQuote: 'Hello',
      anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(context.ytext, 0)),
      anchorStartLine: 1,
    },
    baseRevision: 'revision-1',
    expectedText: 'Hello',
    replacementText: 'Hi',
    source: 'webmcp_proposal',
  });
  context.ytext.delete(0, 5);
  context.ytext.insert(0, 'Changed');

  session.handleLocalEdit('toolbar-format');

  assert.equal(serializeCommentThreads(context.commentThreads)[0].status, 'conflict');
  assert.deepEqual(context.governanceActivity.toArray().map((record) => ({
    action: record.action,
    actor: record.actor,
    outcome: record.outcome,
    source: record.source,
    target: record.target,
  })), [
    {
      action: 'proposal_created',
      actor: {
        displayName: 'Writer',
        kind: 'human',
        participantSessionId: 'writer-session',
        roleId: 'editor',
      },
      outcome: 'open',
      source: 'webmcp_proposal',
      target: serializeCommentThreads(context.commentThreads)[0].id,
    },
    {
      action: 'proposal_status_changed',
      actor: {
        displayName: 'Writer',
        kind: 'human',
        participantSessionId: 'writer-session',
        roleId: 'editor',
      },
      outcome: 'conflict',
      source: 'document_editor',
      target: serializeCommentThreads(context.commentThreads)[0].id,
    },
    {
      action: 'direct_edit_applied',
      actor: {
        displayName: 'Writer',
        kind: 'human',
        participantSessionId: 'writer-session',
        roleId: 'editor',
      },
      outcome: 'applied',
      source: 'document_editor',
      target: 'document',
    },
  ]);
  session.destroy();
});

test('EditorSession records native edit Activity on the burst leading edge and coalesces until flush', () => {
  const session = new EditorSession({
    canComment: () => true,
    canEdit: () => true,
    editorContainer: null,
    getGovernanceSnapshot: () => EDITOR_SNAPSHOT,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const { governanceActivity } = attachGovernanceDocument(session);

  assert.equal(session.handleLocalEdit('native'), true);
  assert.deepEqual(governanceActivity.toArray().map((record) => record.action), [
    'direct_edit_applied',
  ]);

  session.handleLocalEdit('native');
  assert.equal(governanceActivity.length, 1);
  assert.equal(session.flushLocalEditBurst(), true);
  assert.equal(governanceActivity.length, 1);
  assert.equal(session.flushLocalEditBurst(), false);

  session.handleLocalEdit('native');
  assert.deepEqual(governanceActivity.toArray().map((record) => ({
    action: record.action,
    source: record.source,
  })), [
    { action: 'direct_edit_applied', source: 'document_editor' },
    { action: 'direct_edit_applied', source: 'document_editor' },
  ]);
  session.flushLocalEditBurst();
  session.destroy();
});

test('EditorSession freeze ends a synchronized native edit burst without a new Yjs update', () => {
  const session = new EditorSession({
    canComment: () => true,
    canEdit: () => true,
    editorContainer: null,
    getGovernanceSnapshot: () => EDITOR_SNAPSHOT,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const { governanceActivity, ydoc } = attachGovernanceDocument(session);
  const updates = [];
  session.collaborationClient.connected = true;
  ydoc.on('update', session.collaborationClient.handleDocumentUpdate);
  ydoc.on('update', (update) => updates.push(update));

  session.handleLocalEdit('native');
  assert.equal(governanceActivity.length, 1);
  assert.equal(session.hasUnsynchronizedLocalChanges(), false);
  const updateCountBeforeFreeze = updates.length;

  session.collaborationClient.connected = false;
  session.freezeForDisconnect();

  assert.equal(updates.length, updateCountBeforeFreeze);
  assert.equal(governanceActivity.length, 1);
  assert.equal(session.hasUnsynchronizedLocalChanges(), false);
  assert.equal(session.flushLocalEditBurst(), false);
  session.destroy();
});

test('EditorSession records structured exact edits as WebMCP apply Activity', () => {
  const session = new EditorSession({
    canEdit: () => true,
    editorContainer: null,
    getGovernanceSnapshot: () => EDITOR_SNAPSHOT,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const { governanceActivity, ytext } = attachGovernanceDocument(session);

  const result = session.applyGovernedTextEdits({
    actor: EDITOR_SNAPSHOT,
    edits: [{ newText: 'Hi', oldText: 'Hello', revision: 'revision-1' }],
  });

  assert.equal(result.replacementCount, 1);
  assert.equal(ytext.toString(), 'Hi');
  assert.deepEqual(governanceActivity.toArray().map((record) => ({
    action: record.action,
    source: record.source,
  })), [{ action: 'text_edits_applied', source: 'webmcp_apply' }]);
  session.destroy();
});

test('EditorSession stores a missing exact target as a non-destructive Unlocated Conflict', () => {
  const session = new EditorSession({
    canEdit: () => true,
    editorContainer: null,
    getGovernanceSnapshot: () => EDITOR_SNAPSHOT,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const context = attachGovernanceDocument(session, 'Keep this document intact.');

  const result = session.applyGovernedTextEdits({
    actor: EDITOR_SNAPSHOT,
    edits: [{
      newText: 'Destructive replacement',
      oldText: 'Missing source text',
      revision: 'revision-1',
    }],
  });

  assert.equal(result.replacementCount, 0);
  assert.equal(result.conflictProposals.length, 1);
  assert.equal(result.conflictProposals[0].status, 'conflict');
  assert.equal(context.ytext.toString(), 'Keep this document intact.');
  const [reviewGroup] = groupReviewItems({
    activity: context.governanceActivity,
    comments: context.commentThreads,
    ydoc: context.ydoc,
    ytext: context.ytext,
  });
  assert.equal(reviewGroup.unlocated, true);
  for (const key of ['anchorStart', 'anchorEnd']) {
    assert.equal(Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(result.conflictProposals[0][key]),
      context.ydoc,
    ), null);
  }

  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));
  assert.throws(() => resolveProposal({
    activity: context.governanceActivity,
    comments: context.commentThreads,
    ydoc: context.ydoc,
    ytext: context.ytext,
  }, {
    actor: EDITOR_SNAPSHOT,
    proposalId: result.conflictProposals[0].id,
    resolution: 'apply_proposed',
  }), /Unlocated/u);
  assert.equal(context.ytext.toString(), 'Keep this document intact.');
  assert.equal(updates.length, 0);
  session.destroy();
});

test('EditorSession freezes editing, comments, and tools on disconnect', () => {
  const session = new EditorSession({
    canComment: () => true,
    canEdit: () => true,
    editorContainer: null,
    getGovernanceSnapshot: () => EDITOR_SNAPSHOT,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  attachGovernanceDocument(session);
  const editability = [];
  let pauseCalls = 0;
  session.viewAdapter.setCanEdit = (value) => editability.push(value);
  session.collaborationClient.pauseForDisconnect = () => {
    pauseCalls += 1;
  };

  session.freezeForDisconnect();

  assert.deepEqual(editability, [false]);
  assert.equal(pauseCalls, 1);
  assert.equal(session.isInitialSyncComplete(), false);
  assert.equal(session.replyToCommentThread('missing', 'Denied'), null);
  session.destroy();
});

test('EditorSession refreshes governance metadata before reconnecting after another Participant transition', () => {
  const initialSnapshot = { ...EDITOR_SNAPSHOT, version: 3 };
  const refreshedSnapshot = { ...EDITOR_SNAPSHOT, version: 4 };
  const session = new EditorSession({
    editorContainer: null,
    getGovernanceSnapshot: () => initialSnapshot,
    governed: true,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  let connectCalls = 0;
  session.collaborationClient.provider = {
    connect() {
      connectCalls += 1;
    },
    destroy() {},
    disconnect() {},
    params: {
      governanceParticipantSessionId: 'writer-session',
      governanceVersion: '3',
    },
    roomname: 'README.md',
  };
  session.connectionFrozen = true;

  assert.equal(session.reconnectAfterGovernanceValidation(refreshedSnapshot), true);

  assert.equal(connectCalls, 1);
  assert.deepEqual(session.collaborationClient.provider.params, {
    governanceParticipantSessionId: 'writer-session',
    governanceVersion: '4',
  });
  session.destroy();
});

test('EditorSession tracks only disconnected local Yjs updates until sync succeeds', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  const provider = { destroy() {}, disconnect() {} };
  const client = session.collaborationClient;
  client.ydoc = ydoc;
  client.provider = provider;
  client.connected = false;
  assert.equal(typeof client.handleDocumentUpdate, 'function');
  ydoc.on('update', client.handleDocumentUpdate);

  ytext.insert(0, 'local');
  assert.equal(session.hasUnsynchronizedLocalChanges(), true);

  client.handleSync(true);
  assert.equal(session.hasUnsynchronizedLocalChanges(), false);

  ydoc.transact(() => {
    ytext.insert(ytext.length, 'remote');
  }, provider);
  assert.equal(session.hasUnsynchronizedLocalChanges(), false);

  session.destroy();
});

test('EditorSession destruction releases the personal UndoManager with its Y.Doc', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });
  const ydoc = new Y.Doc();
  let undoDestroyCalls = 0;
  session.collaborationClient.ydoc = ydoc;
  session.collaborationClient.undoManager = {
    destroy() {
      undoDestroyCalls += 1;
    },
  };

  session.destroy();

  assert.equal(undoDestroyCalls, 1);
  assert.equal(session.collaborationClient.ydoc, null);
});

function createHostedCollaborationFake() {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  const pendingUpdates = { resolve: null };
  const client = {
    awareness: { getStates: () => new Map() },
    commentThreads: ydoc.getArray('comments'),
    destroyCalls: 0,
    governanceActivity: ydoc.getArray('governanceActivity'),
    initializeCalls: 0,
    // Left false so `initialize` records bindings without mounting a real
    // CodeMirror view; DOM behavior belongs in the browser suite.
    initialSyncComplete: false,
    localUser: { color: '#123456', name: 'Hosted' },
    provider: null,
    undoManager: new Y.UndoManager(ytext),
    ydoc,
    ytext,
    collectUsers: () => [],
    destroy() {
      client.destroyCalls += 1;
    },
    getLocalUser: () => client.localUser,
    getText: () => ytext.toString(),
    hasUnsynchronizedLocalChanges: () => false,
    async initialize() {
      client.initializeCalls += 1;
      return {
        awareness: client.awareness,
        commentThreads: client.commentThreads,
        governanceActivity: client.governanceActivity,
        localUser: client.localUser,
        undoManager: client.undoManager,
        ydoc,
        ytext,
      };
    },
    pauseForDisconnect: () => {},
    reconnect: () => {},
    setLocalViewport: () => null,
    waitForInitialSync: async () => {},
    waitForPendingUpdates: () => new Promise((resolve) => {
      pendingUpdates.resolve = resolve;
    }),
  };
  return { client, pendingUpdates };
}

const hostedSessionOptions = {
  editorContainer: null,
  initialTheme: 'light',
  lineInfoElement: null,
  localUser: null,
  onAwarenessChange: () => {},
  onCommentsChange: () => {},
  onConnectionChange: () => {},
  onContentChange: () => {},
  preferredUserName: 'Tester',
};

test('EditorSession uses an injected collaboration client', async () => {
  const { client } = createHostedCollaborationFake();
  const session = new EditorSession({
    ...hostedSessionOptions,
    createCollaborationClient: () => client,
  });

  await session.initialize('AbCdEf0123456789_-xyZA');

  assert.equal(session.collaborationClient, client);
  assert.equal(client.initializeCalls, 1);
  assert.equal(session.provider, null);
});

test('EditorSession waitForPendingUpdates delegates to the injected client', async () => {
  const { client, pendingUpdates } = createHostedCollaborationFake();
  const session = new EditorSession({
    ...hostedSessionOptions,
    createCollaborationClient: () => client,
  });
  await session.initialize('AbCdEf0123456789_-xyZA');

  let settled = false;
  const waiting = session.waitForPendingUpdates().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  pendingUpdates.resolve();
  await waiting;
  assert.equal(settled, true);
});

test('EditorSession waitForPendingUpdates resolves when the client omits it', async () => {
  const session = new EditorSession({ ...hostedSessionOptions });

  await session.waitForPendingUpdates();
});

test('EditorSession destroy releases the injected client and empties its text', async () => {
  const { client } = createHostedCollaborationFake();
  const session = new EditorSession({
    ...hostedSessionOptions,
    createCollaborationClient: () => client,
  });
  await session.initialize('AbCdEf0123456789_-xyZA');
  client.ytext.insert(0, 'Revoked content');

  session.destroy();

  assert.equal(client.destroyCalls, 1);
});
