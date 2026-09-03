import { isMarkdownFilePath } from '../../domain/file-kind.js';

const sameGovernanceBoundary = (previous, next) => {
  if (previous?.participantSessionId !== next?.participantSessionId
    || previous?.roleId !== next?.roleId) {
    return false;
  }
  const previousCapabilities = [...(previous?.capabilities ?? [])].sort();
  const nextCapabilities = [...(next?.capabilities ?? [])].sort();
  return previousCapabilities.length === nextCapabilities.length
    && previousCapabilities.every((capability, index) => capability === nextCapabilities[index]);
};

export class WorkspaceCoordinator {
  constructor({
    cleanupAfterSessionDestroy = () => {},
    createEditorSession,
    getFileList,
    getGovernanceSnapshot,
    getVaultFileList = getFileList,
    getLineWrappingEnabled,
    getVimModeEnabled,
    getLocalUser,
    getStoredUserName,
    getTheme,
    hasGovernanceCapability,
    isTabActive,
    loadEditorSessionClass,
    onConnectionChange = () => {},
    onContentChange = () => {},
    onFileAwarenessChange = () => {},
    onFileOpenError = () => {},
    onFileOpenReady = () => {},
    onGovernanceAccessChanged = () => {},
    onGovernanceDocumentCleared = () => {},
    onSelectionChange = () => {},
    onSessionAssigned = () => {},
    onUpdateCurrentFile = () => {},
    onUpdateLobbyCurrentFile = () => {},
    refreshGovernanceSnapshot = null,
    stateStore,
  }) {
    this.cleanupAfterSessionDestroy = cleanupAfterSessionDestroy;
    this.createEditorSession = createEditorSession;
    this.getFileList = getFileList;
    this.getGovernanceSnapshot = getGovernanceSnapshot;
    this.getVaultFileList = getVaultFileList;
    this.getLineWrappingEnabled = getLineWrappingEnabled;
    this.getVimModeEnabled = getVimModeEnabled ?? (() => false);
    this.getLocalUser = getLocalUser;
    this.getStoredUserName = getStoredUserName;
    this.getTheme = getTheme;
    this.hasGovernanceCapability = hasGovernanceCapability;
    this.isTabActive = isTabActive;
    this.loadEditorSessionClass = loadEditorSessionClass;
    this.onConnectionChange = onConnectionChange;
    this.onContentChange = onContentChange;
    this.onFileAwarenessChange = onFileAwarenessChange;
    this.onFileOpenError = onFileOpenError;
    this.onFileOpenReady = onFileOpenReady;
    this.onGovernanceAccessChanged = onGovernanceAccessChanged;
    this.onGovernanceDocumentCleared = onGovernanceDocumentCleared;
    this.onSelectionChange = onSelectionChange;
    this.onSessionAssigned = onSessionAssigned;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.refreshGovernanceSnapshot = refreshGovernanceSnapshot;
    this.stateStore = stateStore;
    this.session = null;
  }

  getSession() {
    return this.session;
  }

  cleanupSession() {
    if (!this.session) {
      return;
    }
    this.session.destroy();
    this.session = null;
    this.cleanupAfterSessionDestroy();
    this.onSessionAssigned(null);
  }

  hasDocumentCapability(snapshot, capability, filePath = this.stateStore.currentFilePath) {
    return snapshot?.documentPath === filePath
      && this.hasGovernanceCapability(snapshot, capability) === true;
  }

  async applyGovernanceTransition(previous, next) {
    const filePath = this.stateStore.currentFilePath;
    if (!isMarkdownFilePath(filePath) || next?.documentPath !== filePath) {
      return false;
    }

    const hadDocumentAccess = this.hasDocumentCapability(previous, 'document.read', filePath);
    const hasDocumentAccess = this.hasDocumentCapability(next, 'document.read', filePath);

    if (!hasDocumentAccess) {
      const discarded = this.session?.hasUnsynchronizedLocalChanges?.() === true;
      if (hadDocumentAccess || this.session) {
        this.stateStore.sessionLoadToken += 1;
      }
      if (this.session) {
        this.cleanupSession();
        this.onGovernanceDocumentCleared();
        this.onGovernanceAccessChanged({ discarded, state: next.state });
      } else if (hadDocumentAccess) {
        this.onGovernanceDocumentCleared();
      }
      return true;
    }

    if (this.session) {
      if (!sameGovernanceBoundary(previous, next)) {
        const discarded = this.session.hasUnsynchronizedLocalChanges?.() === true;
        this.stateStore.sessionLoadToken += 1;
        this.cleanupSession();
        this.onGovernanceDocumentCleared();
        this.onGovernanceAccessChanged({ discarded, state: next.state });
        await this.openFile(filePath, { forceReload: true });
      }
      return true;
    }

    await this.openFile(filePath, { forceReload: true });
    return true;
  }

  async revalidateGovernanceAfterDisconnect() {
    const session = this.session;
    if (!session?.isFrozenForDisconnect?.() || typeof this.refreshGovernanceSnapshot !== 'function') {
      return false;
    }

    const previous = this.getGovernanceSnapshot() ?? null;
    let next;
    try {
      next = await this.refreshGovernanceSnapshot();
    } catch {
      return false;
    }
    if (!next || this.session !== session || !session.isFrozenForDisconnect?.()) {
      return false;
    }
    if (this.hasDocumentCapability(next, 'document.read', this.stateStore.currentFilePath)
      && sameGovernanceBoundary(previous, next)) {
      session.reconnectAfterGovernanceValidation?.(next);
      return true;
    }
    return false;
  }

  async openFile(filePath, { forceReload = false } = {}) {
    if (!this.isTabActive()) {
      return false;
    }

    if (!isMarkdownFilePath(filePath) || !this.getVaultFileList().includes(filePath)) {
      this.cleanupSession();
      this.stateStore.sessionLoadToken += 1;
      this.onFileOpenError({ code: 'not-found', filePath });
      return false;
    }

    if (filePath === this.stateStore.currentFilePath && this.session && !forceReload) {
      return true;
    }

    const loadToken = ++this.stateStore.sessionLoadToken;
    this.cleanupSession();
    this.stateStore.currentFilePath = filePath;
    this.onUpdateCurrentFile(filePath);
    this.onUpdateLobbyCurrentFile(filePath);

    let snapshot = this.getGovernanceSnapshot() ?? null;
    if (!this.hasDocumentCapability(snapshot, 'document.read', filePath)) {
      this.onFileOpenReady(null);
      return true;
    }

    const EditorSession = await this.loadEditorSessionClass();
    if (loadToken !== this.stateStore.sessionLoadToken) {
      return false;
    }
    snapshot = this.getGovernanceSnapshot() ?? null;
    if (!this.hasDocumentCapability(snapshot, 'document.read', filePath)) {
      this.onFileOpenReady(null);
      return true;
    }

    const session = this.createEditorSession(EditorSession, {
      canComment: false,
      canEdit: this.hasDocumentCapability(snapshot, 'document.edit', filePath),
      filePath,
      getFileList: this.getFileList,
      getGovernanceSnapshot: this.getGovernanceSnapshot,
      governed: true,
      lineWrappingEnabled: this.getLineWrappingEnabled(),
      localUser: this.getLocalUser(),
      onAwarenessChange: (users) => this.onFileAwarenessChange(users),
      onConnectionChange: (state) => {
        this.onConnectionChange(state);
        if (state?.status === 'disconnected') {
          void this.revalidateGovernanceAfterDisconnect();
        }
      },
      onContentChange: () => this.onContentChange(),
      onSelectionChange: (anchor) => this.onSelectionChange(anchor),
      preferredUserName: this.getStoredUserName(),
      theme: this.getTheme(),
      vimModeEnabled: this.getVimModeEnabled(),
    });
    this.session = session;
    this.onSessionAssigned(session);

    try {
      await session.initialize(filePath);
      if (loadToken !== this.stateStore.sessionLoadToken) {
        session.destroy();
        return false;
      }
      await session.waitForInitialSync(null);
      if (loadToken !== this.stateStore.sessionLoadToken) {
        session.destroy();
        return false;
      }
      session.activateCollaborativeView?.();
      session.ensureInitialContent?.();
      session.applyTheme(this.getTheme());
      this.onFileOpenReady(session);
      session.requestMeasure();
      return true;
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      if (this.session === session) {
        this.session = null;
        this.onSessionAssigned(null);
      }
      if (loadToken === this.stateStore.sessionLoadToken) {
        this.onFileOpenError({ code: 'load-failed', filePath });
      }
      return false;
    }
  }
}
