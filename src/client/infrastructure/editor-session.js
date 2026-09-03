import * as Y from 'yjs';

import { CommentThreadStore } from './comment-thread-store.js';
import { EditorCollaborationClient } from './editor-collaboration-client.js';
import { EditorViewAdapter } from './editor-view-adapter.js';
import { appendActivity } from '../../domain/governance-activity.js';
import { createProposal, revalidateOpenProposals } from '../../domain/governance-proposals.js';

const GOVERNED_EDIT_ORIGIN = 'governance-webmcp-edit';
const LOCAL_EDIT_ORIGIN = 'governance-local-edit';
const LOCAL_EDIT_BURST_MS = 1000;

function actorFromSnapshot(snapshot) {
  if (
    snapshot?.state !== 'active'
    || typeof snapshot.displayName !== 'string'
    || typeof snapshot.kind !== 'string'
    || typeof snapshot.participantSessionId !== 'string'
    || typeof snapshot.roleId !== 'string'
  ) {
    return null;
  }
  return {
    displayName: snapshot.displayName,
    kind: snapshot.kind,
    participantSessionId: snapshot.participantSessionId,
    roleId: snapshot.roleId,
  };
}

function findExactTargets(content, edits) {
  const changes = [];
  const failedEdits = [];

  for (const edit of edits) {
    const from = content.indexOf(edit.oldText);
    if (from === -1) {
      failedEdits.push(edit);
      continue;
    }
    if (content.indexOf(edit.oldText, from + 1) !== -1) {
      throw new Error('A requested text replacement is not unique in the document');
    }
    changes.push({ ...edit, from, to: from + edit.oldText.length });
  }

  changes.sort((left, right) => left.from - right.from);
  for (let index = 1; index < changes.length; index += 1) {
    if (changes[index].from < changes[index - 1].to) {
      throw new Error('Requested text replacements overlap');
    }
  }
  return { changes, failedEdits };
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function unlocatedAnchorForConflict(oldText) {
  const detachedDoc = new Y.Doc();
  const detachedText = detachedDoc.getText('codemirror');
  detachedText.insert(0, 'x');
  const anchor = {
    anchorEnd: Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(detachedText, 1, -1),
    ),
    anchorEndLine: 1,
    anchorKind: 'text',
    anchorQuote: oldText,
    anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(detachedText, 0)),
    anchorStartLine: 1,
  };
  detachedDoc.destroy();
  return anchor;
}

function anchorForConflict(ytext, content, oldText) {
  const from = content.indexOf(oldText);
  if (from === -1) {
    return unlocatedAnchorForConflict(oldText);
  }
  const to = from + oldText.length;
  return {
    anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to)),
    anchorEndLine: lineNumberAt(content, to),
    anchorKind: 'text',
    anchorQuote: oldText,
    anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from)),
    anchorStartLine: lineNumberAt(content, from),
  };
}

export class EditorSession {
  constructor({
    canComment = true,
    canEdit = true,
    editorContainer,
    lineWrappingEnabled = true,
    vimModeEnabled = false,
    initialTheme,
    lineInfoElement,
    onAwarenessChange,
    onConnectionChange,
    onCommentsChange,
    onContentChange,
    onImagePaste,
    onSelectionChange,
    preferredUserName,
    localUser,
    getFileList,
    getGovernanceSnapshot = () => null,
    governed = false,
  }) {
    this.commentCapability = typeof canComment === 'function' ? Boolean(canComment()) : Boolean(canComment);
    this.editCapability = typeof canEdit === 'function' ? Boolean(canEdit()) : Boolean(canEdit);
    this.getGovernanceSnapshot = getGovernanceSnapshot;
    this.governed = Boolean(governed);
    this.onAwarenessChange = onAwarenessChange;
    this.onCommentsChange = onCommentsChange;
    this.onContentChange = onContentChange;
    this.onSelectionChange = onSelectionChange;
    this.activeFilePath = '';
    this.bootstrapContent = null;
    this.pendingCollaborativeBindings = null;
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    this.connectionFrozen = false;
    this.localEditBurst = null;
    this.localEditBurstTimer = null;
    this.destroying = false;
    const governanceSnapshot = this.governed ? this.getGovernanceSnapshot() : null;

    this.collaborationClient = new EditorCollaborationClient({
      governanceSnapshot,
      localUser,
      onAwarenessChange: (users) => this.onAwarenessChange?.(users),
      onConnectionChange: (state) => {
        if (this.destroying) {
          return;
        }
        if (this.governed && state?.status === 'disconnected') {
          this.freezeForDisconnect();
        }
        onConnectionChange?.(state);
      },
      onInitialSync: () => {
        this.connectionFrozen = false;
        this.viewAdapter.setCanEdit(this.editCapability);
        this.emitContentChange();
      },
      preferredUserName,
      resolveAwarenessCursor: (cursor) => this.resolveAwarenessCursor(cursor),
    });
    this.viewAdapter = new EditorViewAdapter({
      canEdit: () => this.canEdit(),
      editorContainer,
      getFileList: getFileList || (() => []),
      initialTheme,
      lineInfoElement,
      lineWrappingEnabled,
      vimModeEnabled,
      onDocChanged: () => {
        this.emitContentChange();
      },
      onImagePaste,
      onLocalEdit: (action) => this.handleLocalEdit(action),
      onViewportChanged: (viewport) => {
        this.collaborationClient.setLocalViewport(viewport);
      },
      onSelectionChanged: () => {
        this.onSelectionChange?.(this.getCurrentSelectionCommentAnchor());
      },
    });
    this.commentThreadStore = new CommentThreadStore({
      canWrite: () => this.canComment(),
      getDoc: () => this.collaborationClient.ydoc,
      getEditorState: () => this.viewAdapter.getState(),
      getLocalUser: () => this.collaborationClient.getLocalUser(),
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
    });
  }

  async initialize(filePath) {
    this.activeFilePath = filePath;
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    const collaborationBindings = await this.collaborationClient.initialize(filePath);
    this.commentThreadStore.bind({
      commentThreads: collaborationBindings.commentThreads,
      ydoc: collaborationBindings.ydoc,
      ytext: collaborationBindings.ytext,
    });

    this.pendingCollaborativeBindings = collaborationBindings;
    if (this.collaborationClient.initialSyncComplete) {
      this.activateCollaborativeView();
    }

    this.onAwarenessChange?.(this.collaborationClient.collectUsers((cursor) => this.resolveAwarenessCursor(cursor)));
  }

  activateCollaborativeView() {
    if (!this.pendingCollaborativeBindings) {
      return false;
    }

    this.viewAdapter.initialize({
      awareness: this.pendingCollaborativeBindings.awareness,
      filePath: this.activeFilePath,
      undoManager: this.pendingCollaborativeBindings.undoManager,
      ytext: this.pendingCollaborativeBindings.ytext,
    });
    this.commentThreadStore.refreshComments();
    this.pendingCollaborativeBindings = null;
    this.bootstrapContent = null;
    return true;
  }

  showBootstrapContent({ content = '', filePath = this.activeFilePath } = {}) {
    if (this.collaborationClient.initialSyncComplete) {
      return false;
    }

    this.activeFilePath = filePath;
    this.bootstrapContent = String(content ?? '');
    this.viewAdapter.initializeProvisional({
      content: this.bootstrapContent,
      filePath: this.activeFilePath,
    });
    this.commentThreadStore.refreshComments();
    return this.emitContentChange();
  }

  hasBootstrapContent() {
    return this.bootstrapContent !== null;
  }

  emitContentChange({ force = false } = {}) {
    const nextContent = this.getText();
    if (!force && this.hasDeliveredContent && nextContent === this.lastDeliveredContent) {
      return false;
    }

    this.hasDeliveredContent = true;
    this.lastDeliveredContent = nextContent;
    this.onContentChange?.();
    return true;
  }

  ensureInitialContent() {
    return this.emitContentChange();
  }

  canComment() {
    return !this.connectionFrozen && this.commentCapability;
  }

  canEdit() {
    return !this.connectionFrozen && this.editCapability;
  }

  setGovernanceCapabilities({ canComment, canEdit }) {
    if (this.editCapability && !canEdit) {
      this.flushLocalEditBurst();
    }
    this.commentCapability = Boolean(canComment);
    this.editCapability = Boolean(canEdit);
    this.viewAdapter.setCanEdit(this.canEdit());
  }

  setCanEdit(value) {
    this.setGovernanceCapabilities({
      canComment: this.commentCapability,
      canEdit: value,
    });
  }

  getGovernanceContext() {
    const {
      commentThreads: comments,
      governanceActivity: activity,
      ydoc,
      ytext,
    } = this.collaborationClient;
    return comments && activity && ydoc && ytext
      ? { activity, comments, ydoc, ytext }
      : null;
  }

  appendLocalEditActivity(actor) {
    const context = this.getGovernanceContext();
    if (!context) {
      return false;
    }
    context.ydoc.transact(() => {
      appendActivity(context.activity, {
        action: 'direct_edit_applied',
        actor,
        outcome: 'applied',
        source: 'document_editor',
        target: 'document',
      });
    }, LOCAL_EDIT_ORIGIN);
    return true;
  }

  flushLocalEditBurst() {
    if (!this.localEditBurst) {
      return false;
    }
    if (this.localEditBurstTimer !== null) {
      clearTimeout(this.localEditBurstTimer);
      this.localEditBurstTimer = null;
    }
    this.localEditBurst = null;
    return true;
  }

  handleLocalEdit(action) {
    if (action === 'flush') {
      return this.flushLocalEditBurst();
    }
    if (!this.canEdit()) {
      return false;
    }

    const actor = actorFromSnapshot(this.getGovernanceSnapshot?.());
    const context = this.getGovernanceContext();
    if (!actor || !context) {
      return false;
    }

    context.ydoc.transact(() => {
      revalidateOpenProposals(context, {
        actor,
        origin: LOCAL_EDIT_ORIGIN,
        source: 'document_editor',
      });
    }, LOCAL_EDIT_ORIGIN);

    if (action !== 'native') {
      this.flushLocalEditBurst();
      return this.appendLocalEditActivity(actor);
    }

    if (!this.localEditBurst) {
      this.localEditBurst = true;
      this.appendLocalEditActivity(actor);
    }
    if (this.localEditBurstTimer !== null) {
      clearTimeout(this.localEditBurstTimer);
    }
    this.localEditBurstTimer = setTimeout(() => {
      this.localEditBurstTimer = null;
      this.flushLocalEditBurst();
    }, LOCAL_EDIT_BURST_MS);
    return true;
  }

  freezeForDisconnect() {
    if (this.connectionFrozen) {
      return false;
    }
    this.flushLocalEditBurst();
    this.connectionFrozen = true;
    this.viewAdapter.setCanEdit(false);
    this.collaborationClient.pauseForDisconnect();
    return true;
  }

  isFrozenForDisconnect() {
    return this.connectionFrozen;
  }

  reconnectAfterGovernanceValidation(governanceSnapshot) {
    if (!this.connectionFrozen) {
      return false;
    }
    this.collaborationClient.reconnect(governanceSnapshot);
    return true;
  }

  applyTheme(theme) {
    this.viewAdapter.applyTheme(theme);
  }

  getText() {
    return this.collaborationClient.getText() || this.viewAdapter.getText();
  }

  hasUnsynchronizedLocalChanges() {
    return this.collaborationClient.hasUnsynchronizedLocalChanges();
  }

  getScrollContainer() {
    return this.viewAdapter.getScrollContainer();
  }

  getTopVisibleLineNumber(viewportRatio = 0) {
    return this.viewAdapter.getTopVisibleLineNumber(viewportRatio);
  }

  getLocalUser() {
    return this.collaborationClient.getLocalUser();
  }

  get awareness() {
    return this.collaborationClient.awareness;
  }

  get provider() {
    return this.collaborationClient.provider;
  }

  get ydoc() {
    return this.collaborationClient.ydoc;
  }

  get ytext() {
    return this.collaborationClient.ytext;
  }

  getCurrentSelectionLineRange() {
    return this.viewAdapter.getCurrentSelectionLineRange();
  }

  getCurrentSelectionCommentAnchor() {
    return this.viewAdapter.getCurrentSelectionCommentAnchor();
  }

  getCommentAnchorClientRect(anchor) {
    return this.viewAdapter.getAnchorClientRect(anchor);
  }

  getSelectionChipClientRect(anchor) {
    return this.viewAdapter.getSelectionChipClientRect(anchor);
  }

  getCommentThreads() {
    return this.commentThreadStore.getCommentThreads();
  }

  createCommentThread(payload) {
    return this.commentThreadStore.createCommentThread(payload);
  }

  replyToCommentThread(threadId, body) {
    return this.commentThreadStore.replyToCommentThread(threadId, body);
  }

  toggleCommentReaction(threadId, messageId, emoji) {
    return this.commentThreadStore.toggleCommentReaction(threadId, messageId, emoji);
  }

  deleteCommentThread(threadId) {
    return this.commentThreadStore.deleteCommentThread(threadId);
  }

  isLineWrappingEnabled() {
    return this.viewAdapter.isLineWrappingEnabled();
  }

  isVimModeEnabled() {
    return this.viewAdapter.isVimModeEnabled();
  }

  setVimMode(enabled) {
    return this.viewAdapter.setVimMode(enabled);
  }

  setLineWrapping(enabled) {
    return this.viewAdapter.setLineWrapping(enabled);
  }

  scrollToLine(lineNumber, viewportRatio = 0) {
    return this.viewAdapter.scrollToLine(lineNumber, viewportRatio);
  }

  revealSearchMatch(match) {
    return this.viewAdapter.revealSearchMatch(match);
  }

  getUserCursor(clientId) {
    return this.collaborationClient.getUserCursor(
      clientId,
      (cursor) => this.resolveAwarenessCursor(cursor),
    );
  }

  getUserViewport(clientId) {
    return this.collaborationClient.getUserViewport(clientId);
  }

  scrollToPosition(position, alignment = 'center') {
    return this.viewAdapter.scrollToPosition(position, alignment);
  }

  scrollToUserViewport(clientId) {
    const viewport = this.getUserViewport(clientId);
    if (!viewport) {
      return false;
    }

    return this.scrollToLine(viewport.topLine, viewport.viewportRatio);
  }

  scrollToUserCursor(clientId, alignment = 'center') {
    const cursor = this.getUserCursor(clientId);
    if (!cursor) {
      return false;
    }

    return this.scrollToPosition(cursor.cursorHead, alignment)
      || this.scrollToLine(cursor.cursorLine);
  }

  setUserName(name) {
    return this.collaborationClient.setUserName(name);
  }

  requestMeasure() {
    this.viewAdapter.requestMeasure();
  }

  formatDocument(filePath) {
    return this.viewAdapter.formatDocument(filePath);
  }

  runEditorCommand(commandId) {
    return this.viewAdapter.runEditorCommand(commandId);
  }

  applyMarkdownToolbarAction(action) {
    return this.viewAdapter.applyMarkdownToolbarAction(action);
  }

  insertText(text) {
    return this.viewAdapter.insertText(text);
  }

  applyTextReplacements(replacements) {
    if (!this.collaborationClient.initialSyncComplete) {
      throw new Error('The collaborative document is not synchronized');
    }
    return this.viewAdapter.applyTextReplacements(replacements);
  }

  applyGovernedTextEdits({ edits, actor }) {
    if (!this.collaborationClient.initialSyncComplete) {
      throw new Error('The collaborative document is not synchronized');
    }
    const { commentThreads: comments, governanceActivity: activity, ydoc, ytext } = this.collaborationClient;
    if (!comments || !activity || !ydoc || !ytext) {
      throw new Error('The collaborative document is not available');
    }

    const content = ytext.toString();
    const { changes, failedEdits } = findExactTargets(content, edits);
    const context = { activity, comments, ydoc, ytext };
    let conflictProposals = [];

    ydoc.transact(() => {
      if (failedEdits.length > 0) {
        conflictProposals = failedEdits.map((edit) => createProposal(context, {
          actor,
          anchor: anchorForConflict(ytext, content, edit.oldText),
          baseRevision: edit.revision,
          expectedText: edit.oldText,
          replacementText: edit.newText,
          source: 'webmcp_apply',
        }));
        const revalidation = revalidateOpenProposals(context, {
          actor,
          origin: GOVERNED_EDIT_ORIGIN,
          source: 'webmcp_apply',
        });
        const revalidatedById = new Map(revalidation.changed.map((proposal) => [proposal.id, proposal]));
        conflictProposals = conflictProposals.map((proposal) => revalidatedById.get(proposal.id) ?? proposal);
        appendActivity(activity, {
          action: 'text_edits_conflicted',
          actor,
          outcome: 'conflict',
          source: 'webmcp_apply',
          target: 'document',
        });
        return;
      }

      for (const change of changes.toReversed()) {
        ytext.delete(change.from, change.to - change.from);
        if (change.newText) {
          ytext.insert(change.from, change.newText);
        }
      }
      revalidateOpenProposals(context, {
        actor,
        origin: GOVERNED_EDIT_ORIGIN,
        source: 'webmcp_apply',
      });
      appendActivity(activity, {
        action: 'text_edits_applied',
        actor,
        outcome: 'applied',
        source: 'webmcp_apply',
        target: 'document',
      });
    }, GOVERNED_EDIT_ORIGIN);

    return {
      conflictProposals,
      replacementCount: failedEdits.length > 0 ? 0 : changes.length,
    };
  }

  proposeTextEdit({ oldText, newText, revision, actor }) {
    if (!this.collaborationClient.initialSyncComplete) {
      throw new Error('The collaborative document is not synchronized');
    }
    const { commentThreads: comments, governanceActivity: activity, ydoc, ytext } = this.collaborationClient;
    if (!comments || !activity || !ydoc || !ytext) {
      throw new Error('The collaborative document is not available');
    }

    const content = ytext.toString();
    const { failedEdits } = findExactTargets(content, [{ oldText, newText }]);
    if (failedEdits.length > 0) {
      throw new Error('A proposed text replacement no longer matches the document');
    }
    return createProposal({ activity, comments, ydoc, ytext }, {
      actor,
      anchor: anchorForConflict(ytext, content, oldText),
      baseRevision: revision,
      expectedText: oldText,
      replacementText: newText,
      source: 'webmcp_proposal',
    });
  }

  replaceText(text) {
    return this.viewAdapter.replaceText(text);
  }

  toggleTaskListItem(lineNumber) {
    if (!this.collaborationClient.initialSyncComplete) {
      return false;
    }

    return this.viewAdapter.toggleTaskListItem(lineNumber);
  }

  flashExternalUpdate(range) {
    return this.viewAdapter.flashRemoteRange(range);
  }

  isInitialSyncComplete() {
    return !this.connectionFrozen && this.collaborationClient.initialSyncComplete;
  }

  waitForInitialSync(timeoutMs = 1500) {
    return this.collaborationClient.waitForInitialSync(timeoutMs);
  }

  destroy() {
    this.destroying = true;
    this.flushLocalEditBurst();
    this.commentThreadStore.unbind();
    this.activeFilePath = '';
    this.bootstrapContent = null;
    this.pendingCollaborativeBindings = null;
    this.hasDeliveredContent = false;
    this.lastDeliveredContent = null;
    this.viewAdapter.destroy();
    this.collaborationClient.destroy();
  }

  resolveAwarenessCursor(cursor) {
    const ydoc = this.collaborationClient.ydoc;
    const ytext = this.collaborationClient.ytext;
    const state = this.viewAdapter.getState();
    if (!cursor?.anchor || !cursor?.head || !ydoc || !state || !ytext) {
      return null;
    }

    const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ydoc);
    const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc);
    if (!anchor || !head || anchor.type !== ytext || head.type !== ytext) {
      return null;
    }

    const line = state.doc.lineAt(head.index);
    return {
      cursorAnchor: anchor.index,
      cursorHead: head.index,
      cursorLine: line.number,
    };
  }
}
