import {
  isBaseFilePath,
  isHtmlFilePath,
  isMarkdownFilePath,
  supportsBacklinksForFilePath,
} from '../../domain/file-kind.js';

const BOOTSTRAP_RENDER_DELAY_MS = 150;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getActiveGrantKey(snapshot) {
  if (snapshot?.state !== 'active') {
    return null;
  }
  return JSON.stringify([
    snapshot.participantSessionId,
    snapshot.roleId,
    snapshot.issuedAt,
  ]);
}

function canReuseFrozenSession(session, sameGrant, editCapabilityChanged) {
  return session?.isFrozenForDisconnect?.() === true
    && sameGrant
    && !editCapabilityChanged;
}

export class WorkspaceCoordinator {
  constructor({
    attachEditorScroller,
    beginDocumentLoad,
    cleanupAfterSessionDestroy,
    createEditorSession,
    getDisplayName,
    getFileList,
    getGovernanceSnapshot = null,
    getVaultFileList = getFileList,
    getLineWrappingEnabled,
    getVimModeEnabled,
    getLocalUser,
    getStoredUserName,
    getTheme,
    hasGovernanceCapability = null,
    isBaseFile,
    isDrawioFile,
    isExcalidrawFile,
    isImageFile,
    isPdfFile,
    isMermaidFile,
    isPlantUmlFile,
    isStructurizrWorkspaceFile,
    isTabActive,
    loadBootstrapContent = null,
    loadEditorSessionClass,
    loadBacklinks,
    onBeforeFileOpen,
    onConnectionChange,
    onContentChange,
    onCommentsChange,
    onFileAwarenessChange,
    onFileOpenError,
    onFileOpenReady,
    onImagePaste,
    onGovernanceAccessChanged = null,
    onSelectionChange,
    onSessionAssigned = null,
    onFileOpenMetric = null,
    onRenderBasePreview,
    onRenderExcalidrawPreview,
    onRenderDrawioPreview,
    onRenderHtmlPreview,
    onRenderImagePreview,
    onRenderPdfPreview,
    onRenderStructurizrPreview,
    onSyncWrapToggle,
    onUpdateActiveFile,
    onUpdateCurrentFile,
    onUpdateLobbyCurrentFile,
    onUpdateVisibleChrome,
    onViewModeReset,
    renderPresence,
    refreshGovernanceSnapshot = null,
    scrollContainerForSession,
    shouldUseDrawioPreview = null,
    showEditorLoading,
    stateStore,
  }) {
    this.attachEditorScroller = attachEditorScroller;
    this.beginDocumentLoad = beginDocumentLoad;
    this.cleanupAfterSessionDestroy = cleanupAfterSessionDestroy;
    this.createEditorSession = createEditorSession;
    this.getDisplayName = getDisplayName;
    this.getFileList = getFileList;
    this.getGovernanceSnapshot = getGovernanceSnapshot;
    this.getVaultFileList = getVaultFileList;
    this.getLineWrappingEnabled = getLineWrappingEnabled;
    this.getVimModeEnabled = getVimModeEnabled ?? (() => false);
    this.getLocalUser = getLocalUser;
    this.getStoredUserName = getStoredUserName;
    this.getTheme = getTheme;
    this.hasGovernanceCapability = hasGovernanceCapability;
    this.isBaseFile = isBaseFile ?? (() => false);
    this.isDrawioFile = isDrawioFile ?? (() => false);
    this.isExcalidrawFile = isExcalidrawFile ?? (() => false);
    this.isImageFile = isImageFile ?? (() => false);
    this.isPdfFile = isPdfFile ?? (() => false);
    this.isMermaidFile = isMermaidFile ?? (() => false);
    this.isPlantUmlFile = isPlantUmlFile ?? (() => false);
    this.isStructurizrWorkspaceFile = isStructurizrWorkspaceFile ?? (() => false);
    this.isTabActive = isTabActive;
    this.loadBootstrapContent = loadBootstrapContent;
    this.loadEditorSessionClassPort = loadEditorSessionClass;
    this.loadBacklinks = loadBacklinks;
    this.onBeforeFileOpen = onBeforeFileOpen;
    this.onConnectionChange = onConnectionChange;
    this.onContentChange = onContentChange;
    this.onCommentsChange = onCommentsChange;
    this.onFileAwarenessChange = onFileAwarenessChange;
    this.onFileOpenError = onFileOpenError;
    this.onFileOpenReady = onFileOpenReady;
    this.onImagePaste = onImagePaste;
    this.onGovernanceAccessChanged = onGovernanceAccessChanged;
    this.onSelectionChange = onSelectionChange;
    this.onSessionAssigned = onSessionAssigned;
    this.onFileOpenMetric = onFileOpenMetric;
    this.onRenderBasePreview = onRenderBasePreview;
    this.onRenderDrawioPreview = onRenderDrawioPreview;
    this.onRenderExcalidrawPreview = onRenderExcalidrawPreview;
    this.onRenderHtmlPreview = onRenderHtmlPreview;
    this.onRenderImagePreview = onRenderImagePreview;
    this.onRenderPdfPreview = onRenderPdfPreview;
    this.onRenderStructurizrPreview = onRenderStructurizrPreview;
    this.onSyncWrapToggle = onSyncWrapToggle;
    this.onUpdateActiveFile = onUpdateActiveFile;
    this.onUpdateCurrentFile = onUpdateCurrentFile;
    this.onUpdateLobbyCurrentFile = onUpdateLobbyCurrentFile;
    this.onUpdateVisibleChrome = onUpdateVisibleChrome;
    this.onViewModeReset = onViewModeReset;
    this.renderPresence = renderPresence;
    this.refreshGovernanceSnapshot = refreshGovernanceSnapshot;
    this.scrollContainerForSession = scrollContainerForSession;
    this.shouldUseDrawioPreview = shouldUseDrawioPreview ?? (() => true);
    this.showEditorLoading = showEditorLoading;
    this.stateStore = stateStore;
    this.session = null;
  }

  getSession() {
    return this.session;
  }

  loadEditorSessionClass() {
    return this.loadEditorSessionClassPort();
  }

  waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });
  }

  reportFileOpenMetric(name, loadToken, data = {}) {
    this.onFileOpenMetric?.(name, {
      filePath: this.stateStore.currentFilePath,
      loadToken,
      ...data,
    });
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.attachEditorScroller(null);
    this.cleanupAfterSessionDestroy();
  }

  isGovernedDocument(filePath = this.stateStore.currentFilePath) {
    return typeof this.getGovernanceSnapshot === 'function'
      && typeof this.hasGovernanceCapability === 'function'
      && isMarkdownFilePath(filePath);
  }

  hasDocumentCapability(snapshot, capability, filePath = this.stateStore.currentFilePath) {
    return snapshot?.documentPath === filePath
      && this.hasGovernanceCapability?.(snapshot, capability) === true;
  }

  async applyGovernanceTransition(previous, next, { allowFrozenReconnect = false } = {}) {
    const filePath = this.stateStore.currentFilePath;
    if (!this.isGovernedDocument(filePath) || next?.documentPath !== filePath) {
      return false;
    }

    const hadDocumentAccess = this.hasDocumentCapability(previous, 'document.read', filePath);
    const hasDocumentAccess = this.hasDocumentCapability(next, 'document.read', filePath);
    const couldEdit = this.hasDocumentCapability(previous, 'document.edit', filePath);
    const canEdit = this.hasDocumentCapability(next, 'document.edit', filePath);
    const canComment = this.hasDocumentCapability(next, 'document.comment', filePath);
    const editCapabilityChanged = couldEdit !== canEdit;
    const previousGrantKey = getActiveGrantKey(previous);
    const sameGrant = previousGrantKey !== null && previousGrantKey === getActiveGrantKey(next);

    if (this.session?.setGovernanceCapabilities) {
      this.session.setGovernanceCapabilities({ canComment, canEdit });
    } else {
      this.session?.setCanEdit?.(canEdit);
    }

    if (!hasDocumentAccess) {
      if (hadDocumentAccess || this.session) {
        this.stateStore.sessionLoadToken += 1;
      }
      if (this.session) {
        this.cleanupSession();
        this.onSessionAssigned?.(null);
        this.onGovernanceAccessChanged?.({ discarded: true, state: next.state });
      }
      return true;
    }

    if (canReuseFrozenSession(this.session, sameGrant, editCapabilityChanged)) {
      if (allowFrozenReconnect) {
        this.session.reconnectAfterGovernanceValidation?.();
      }
      return true;
    }

    const shouldRecreate = !this.session
      || !hadDocumentAccess
      || editCapabilityChanged
      || (this.session.isFrozenForDisconnect?.() && !sameGrant);
    if (!shouldRecreate) {
      return true;
    }

    const discarded = Boolean(this.session);
    if (discarded) {
      this.cleanupSession();
      this.onSessionAssigned?.(null);
      this.onGovernanceAccessChanged?.({ discarded: true, state: next.state });
    }
    await this.openFile(filePath, { forceReload: true });
    return true;
  }

  async revalidateGovernanceAfterDisconnect() {
    const session = this.session;
    if (!session?.isFrozenForDisconnect?.() || typeof this.refreshGovernanceSnapshot !== 'function') {
      return false;
    }

    const previous = this.getGovernanceSnapshot?.() ?? null;
    let next;
    try {
      next = await this.refreshGovernanceSnapshot();
    } catch {
      return false;
    }
    if (!next || this.session !== session || !session.isFrozenForDisconnect?.()) {
      return false;
    }
    return this.applyGovernanceTransition(previous, next, { allowFrozenReconnect: true });
  }

  prepareForFileOpen(filePath, { drawioMode = null, resetConnectionState = true } = {}) {
    this.onViewModeReset();
    this.onBeforeFileOpen();
    this.stateStore.connectionHelpShown = false;
    if (resetConnectionState) {
      this.stateStore.connectionState = { status: 'connecting', unreachable: false };
    }
    this.stateStore.currentDrawioMode = drawioMode ?? null;
    this.stateStore.currentFilePath = filePath;
    this.onUpdateCurrentFile(filePath);
    this.onUpdateLobbyCurrentFile(filePath);
    this.onUpdateActiveFile(filePath);
    this.onUpdateVisibleChrome(filePath, {
      displayName: this.getDisplayName(filePath),
      drawioMode,
      isMarkdown: isMarkdownFilePath(filePath),
    });
    this.showEditorLoading();
    this.beginDocumentLoad();
    this.renderPresence();

    return { supportsBacklinks: supportsBacklinksForFilePath(filePath) };
  }

  finalizeFileOpen({
    isBase = false,
    isDrawio = false,
    filePath,
    isExcalidraw = false,
    isHtml = false,
    isImage = false,
    isPdf = false,
    supportsBacklinks,
  }) {
    if (isExcalidraw) this.onRenderExcalidrawPreview(filePath);
    if (isBase || isBaseFilePath(filePath)) this.onRenderBasePreview(filePath);
    if (isDrawio) this.onRenderDrawioPreview(filePath);
    if (isHtml) this.onRenderHtmlPreview({ content: this.session?.getText?.() ?? '' });
    if (isImage) this.onRenderImagePreview(filePath);
    if (isPdf) this.onRenderPdfPreview(filePath);
    if (this.isStructurizrWorkspaceFile(filePath)) {
      this.onRenderStructurizrPreview(filePath, {
        source: this.session?.getText?.() ?? '',
      });
    }
    this.onSyncWrapToggle();
    if (supportsBacklinks) this.loadBacklinks(filePath);
  }

  async openFile(filePath, { drawioMode = null, forceReload = false } = {}) {
    if (!this.isTabActive()) {
      return false;
    }

    if (!filePath || !this.getVaultFileList().includes(filePath)) {
      this.cleanupSession();
      this.stateStore.sessionLoadToken += 1;
      this.stateStore.currentFilePath = null;
      this.onUpdateCurrentFile(null);
      this.onUpdateLobbyCurrentFile(null);
      this.onUpdateActiveFile(null);
      this.onFileOpenError({ code: 'not-found', filePath });
      return false;
    }

    const normalizedDrawioMode = drawioMode ?? null;
    const currentDrawioMode = this.stateStore.currentDrawioMode ?? null;
    const isDrawio = this.isDrawioFile(filePath) && drawioMode !== 'text' && this.shouldUseDrawioPreview(filePath);
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isBase = this.isBaseFile(filePath);
    const isImage = this.isImageFile(filePath);
    const isPdf = this.isPdfFile(filePath);
    const isHtml = isHtmlFilePath(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const isStructurizrWorkspace = this.isStructurizrWorkspaceFile(filePath);

    if (
      filePath === this.stateStore.currentFilePath
      && !forceReload
      && normalizedDrawioMode === currentDrawioMode
      && (this.session || isDrawio || isExcalidraw || isImage || isPdf)
    ) {
      this.onUpdateActiveFile(filePath);
      this.onUpdateLobbyCurrentFile(filePath);
      return true;
    }

    const loadToken = ++this.stateStore.sessionLoadToken;
    const openStartedAt = performance.now();

    this.cleanupSession();
    const chromeState = this.prepareForFileOpen(filePath, {
      drawioMode: normalizedDrawioMode,
      resetConnectionState: !isDrawio && !isExcalidraw && !isImage && !isPdf,
    });
    this.reportFileOpenMetric('open_started', loadToken, { filePath });

    if (isDrawio || isExcalidraw || isImage || isPdf) {
      this.onSessionAssigned?.(null);

      if (loadToken !== this.stateStore.sessionLoadToken) {
        return;
      }

      this.onFileOpenReady(null);
      this.finalizeFileOpen({
        filePath,
        isBase,
        isDrawio,
        isExcalidraw,
        isImage,
        isPdf,
        session: null,
        supportsBacklinks: chromeState.supportsBacklinks,
      });
      return true;
    }

    const governed = this.isGovernedDocument(filePath);
    let governanceSnapshot = this.getGovernanceSnapshot?.() ?? null;
    if (governed && !this.hasDocumentCapability(governanceSnapshot, 'document.read', filePath)) {
      this.onSessionAssigned?.(null);
      this.onFileOpenReady(null);
      return true;
    }

    const EditorSession = await this.loadEditorSessionClass();
    if (loadToken !== this.stateStore.sessionLoadToken) {
      return false;
    }
    governanceSnapshot = this.getGovernanceSnapshot?.() ?? null;
    if (governed && !this.hasDocumentCapability(governanceSnapshot, 'document.read', filePath)) {
      this.onSessionAssigned?.(null);
      this.onFileOpenReady(null);
      return true;
    }
    const session = this.createEditorSession(EditorSession, {
      canComment: !governed || this.hasDocumentCapability(governanceSnapshot, 'document.comment', filePath),
      canEdit: !governed || this.hasDocumentCapability(governanceSnapshot, 'document.edit', filePath),
      filePath,
      getFileList: this.getFileList,
      getGovernanceSnapshot: this.getGovernanceSnapshot ?? (() => null),
      governed,
      lineWrappingEnabled: this.getLineWrappingEnabled(),
      localUser: this.getLocalUser(),
      vimModeEnabled: this.getVimModeEnabled(),
      onAwarenessChange: (users) => this.onFileAwarenessChange(users),
      onConnectionChange: (state) => {
        this.onConnectionChange(state);
        if (governed && state?.status === 'disconnected') {
          void this.revalidateGovernanceAfterDisconnect();
        }
      },
      onCommentsChange: (threads) => this.onCommentsChange?.(threads),
      onContentChange: () => {
        if (isExcalidraw) {
          return;
        }

        this.onContentChange({
          isBase,
          isHtml,
          isMermaid,
          isPlantUml,
          isStructurizrWorkspace,
        });
      },
      ...(!governed ? { onImagePaste: (file) => this.onImagePaste?.(file) } : {}),
      preferredUserName: this.getStoredUserName(),
      onSelectionChange: (anchor) => this.onSelectionChange?.(anchor),
      theme: this.getTheme(),
    });

    this.session = session;
    this.onSessionAssigned?.(session);

    try {
      let fileOpenReady = false;
      let fileOpenFinalized = false;
      let liveSyncComplete = false;

      const readySession = async (reason) => {
        if (fileOpenReady || loadToken !== this.stateStore.sessionLoadToken) {
          return;
        }

        fileOpenReady = true;
        this.attachEditorScroller(this.scrollContainerForSession(session));
        session.applyTheme(this.getTheme());
        this.onFileOpenReady(session);
        this.reportFileOpenMetric('editor_ready', loadToken, { reason });
        session.requestMeasure();
        await this.waitForNextPaint();

        if (fileOpenFinalized || loadToken !== this.stateStore.sessionLoadToken) {
          return;
        }

        fileOpenFinalized = true;
        this.finalizeFileOpen({
          filePath,
          isBase,
          isExcalidraw,
          isHtml,
          session,
          supportsBacklinks: chromeState.supportsBacklinks,
        });
      };

      const bootstrapPromise = this.loadBootstrapContent
        ? (async () => {
          this.reportFileOpenMetric('bootstrap_fetch_started', loadToken);
          try {
            const content = await this.loadBootstrapContent(filePath);
            this.reportFileOpenMetric('bootstrap_fetch_completed', loadToken, {
              found: content !== null,
            });
            return content;
          } catch (error) {
            this.reportFileOpenMetric('bootstrap_fetch_completed', loadToken, {
              error: error.message,
              found: false,
            });
            return null;
          }
        })()
        : Promise.resolve(null);

      const initializePromise = session.initialize(filePath);
      const liveSyncPromise = (async () => {
        await initializePromise;

        if (loadToken !== this.stateStore.sessionLoadToken) {
          return false;
        }

        await session.waitForInitialSync(null);
        if (loadToken !== this.stateStore.sessionLoadToken) {
          return false;
        }

        liveSyncComplete = true;
        session.activateCollaborativeView?.();
        this.attachEditorScroller(this.scrollContainerForSession(session));
        session.applyTheme(this.getTheme());
        this.reportFileOpenMetric('initial_sync_complete', loadToken);
        session.ensureInitialContent?.();
        if (!fileOpenReady) {
          await readySession('live-sync');
        } else {
          session.requestMeasure();
        }
        return true;
      })();

      const bootstrapVisibilityPromise = (async () => {
        const bootstrapContent = await bootstrapPromise;
        if (
          bootstrapContent === null
          || liveSyncComplete
          || fileOpenReady
          || loadToken !== this.stateStore.sessionLoadToken
        ) {
          return false;
        }

        const elapsedMs = performance.now() - openStartedAt;
        const remainingDelayMs = Math.max(0, BOOTSTRAP_RENDER_DELAY_MS - elapsedMs);
        if (remainingDelayMs > 0) {
          const winner = await Promise.race([
            liveSyncPromise.then((didSync) => (didSync ? 'live-sync' : 'stale')),
            delay(remainingDelayMs).then(() => 'timeout'),
          ]);
          if (winner === 'live-sync') {
            return false;
          }
        }

        if (
          liveSyncComplete
          || fileOpenReady
          || loadToken !== this.stateStore.sessionLoadToken
        ) {
          return false;
        }

        const didApplyBootstrap = session.showBootstrapContent({
          content: bootstrapContent,
          filePath,
        });
        if (!didApplyBootstrap && !session.hasBootstrapContent?.()) {
          return false;
        }

        this.reportFileOpenMetric('bootstrap_shown', loadToken);
        await readySession('bootstrap');
        return true;
      })();

      await initializePromise;

      if (loadToken !== this.stateStore.sessionLoadToken) {
        session.destroy();
        return;
      }

      await Promise.all([liveSyncPromise, bootstrapVisibilityPromise]);

      if (loadToken !== this.stateStore.sessionLoadToken) {
        session.destroy();
        return;
      }

      if (!fileOpenReady) {
        session.ensureInitialContent?.();
        await readySession('post-initialize');
      }
      return true;
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.attachEditorScroller(null);
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.stateStore.sessionLoadToken) {
        return;
      }

      this.onFileOpenError({ code: 'load-failed', filePath });
      return false;
    }
  }
}
