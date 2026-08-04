import { PreviewRenderer } from '../application/preview-renderer.js';
import { ensureQuickSwitcherInstance, toggleQuickSwitcherInstance } from '../application/quick-switcher-loader.js';
import { WorkspaceRouteController } from '../application/workspace-route-controller.js';
import { WikiLinkFileController } from '../application/wiki-link-file-controller.js';
import { WorkspacePreviewController } from '../application/workspace-preview-controller.js';
import { WorkspaceCoordinator } from '../application/workspace-coordinator.js';
import { bindAppShellElements } from '../application/app-shell-elements.js';
import { LOBBY_CHAT_MESSAGE_MAX_LENGTH, LobbyPresence } from '../infrastructure/lobby-presence.js';
import { BrowserNotificationPort } from '../infrastructure/browser-notification-port.js';
import { BrowserPreferencesPort } from '../infrastructure/browser-preferences-port.js';
import { AppVersionMonitor } from '../infrastructure/app-version-monitor.js';
import { backlinksApiClient } from '../infrastructure/backlinks-api-client.js';
import { gitApiClient } from '../infrastructure/git-api-client.js';
import {
  getHashRoute,
  getRuntimeConfig,
  navigateToFile,
  navigateToGitCommit,
  navigateToGitDiff,
  navigateToGitFileHistory,
  navigateToGitFilePreview,
  navigateToGitHistory,
} from '../infrastructure/runtime-config.js';
import { plantUmlApiClient } from '../infrastructure/plantuml-api-client.js';
import { TabActivityLock } from '../infrastructure/tab-activity-lock.js';
import { vaultApiClient } from '../infrastructure/vault-api-client.js';
import { WorkspaceSyncClient } from '../infrastructure/workspace-sync-client.js';
import { BacklinksPanel } from '../presentation/backlinks-panel.js';
import { CommentOverviewController } from '../presentation/comment-overview-controller.js';
import { CommentUiController } from '../presentation/comment-ui-controller.js';
import { FileExplorerController } from '../presentation/file-explorer-controller.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { ScrollSyncController } from '../presentation/scroll-sync-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';
import { VideoEmbedController } from '../presentation/video-embed-controller.js';
import { ImageLightboxController } from '../presentation/image-lightbox-controller.js';
import { createAppShellFeatureSurface } from './app-shell-feature-surface.js';

export class CollabMdAppShell {
  constructor() {
    this.elements = bindAppShellElements(document);
    this.features = createAppShellFeatureSurface(this);
    this.runtimeConfig = getRuntimeConfig();
    this.activeSidebarTab = 'files';
    this.chatInitialSyncComplete = false;
    this.chatIsOpen = false;
    this.chatMessageIds = new Set();
    this.chatMessages = [];
    this.chatUnreadCount = 0;
    this.connectionHelpShown = false;
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.currentDrawioMode = null;
    this.currentFilePath = null;
    this.fileExplorerReady = false;
    this.followedCursorSignature = '';
    this.followedUserClientId = null;
    this.gitRepoAvailable = false;
    this.globalUsers = [];
    this.isTabActive = false;
    this.presencePanelOpen = false;
    this.sessionLoadToken = 0;
    this.navigation = {
      getHashRoute,
      navigateToFile,
      navigateToGitCommit,
      navigateToGitDiff,
      navigateToGitFileHistory,
      navigateToGitFilePreview,
      navigateToGitHistory,
    };
    this.preferences = new BrowserPreferencesPort({
      chatNotificationsKey: 'collabmd-chat-notifications-enabled',
      lineWrappingKey: 'collabmd-editor-line-wrap',
      sidebarVisibleKey: 'collabmd-sidebar-visible',
      userNameKey: 'collabmd-user-name',
    });
    this.notifications = new BrowserNotificationPort();
    this.backlinksApiClient = backlinksApiClient;
    this.gitApiClient = gitApiClient;
    this.plantUmlApiClient = plantUmlApiClient;
    this.vaultApiClient = vaultApiClient;
    this._session = null;
    this._hasPromptedForDisplayName = false;
    this._backlinkRefreshTimer = null;
    this._pendingPreviewLayoutSync = false;
    this._previewHydrationPaused = false;
    this._previewLayoutResizeObserver = null;
    this._previewLayoutSyncTimer = null;
    this._reloadPromptShown = false;
    this._staticPreviewDocument = null;
    this.pendingGitResetPath = null;
    this.chatTimeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    this.chatNotificationsEnabled = this.preferences.getChatNotificationsEnabled();
    this.chatNotificationPermission = this.notifications.getPermission();
    this.lobbyChatMessageMaxLength = LOBBY_CHAT_MESSAGE_MAX_LENGTH;
    this.quickSwitcher = null;
    this.quickSwitcherModulePromise = null;
    this.fileExplorerReadyPromise = Promise.resolve();
    this._gitControllerPrewarmHandle = null;
    this.mobileBreakpointQuery = window.matchMedia('(max-width: 768px)');
    this.pendingWorkspaceRequestIds = new Set();
    this._fileOpenPerf = null;
    this.versionMonitor = new AppVersionMonitor({
      currentBuildId: this.runtimeConfig.build?.id,
      onUpdateAvailable: (payload) => this.features.promptForVersionReload(payload),
      runtimeConfig: this.runtimeConfig,
    });

    this.lobby = new LobbyPresence({
      preferredUserName: this.features.getStoredUserName(),
      onChange: (users) => this.features.updateGlobalUsers(users),
      onChatChange: (messages, meta) => this.features.updateChatMessages(messages, meta),
    });
    this.workspaceSync = new WorkspaceSyncClient({
      onTreeChange: (tree, metadata = {}) => {
        const wasReady = this.fileExplorerReady;
        this.fileExplorer.setTree(tree, metadata);
        this.features.handleCommentOverviewWorkspaceTreeChange?.();
        this.fileExplorerReady = true;
        if (!wasReady && this.isTabActive) {
          void this.features.handleHashChange();
        }
      },
      onWorkspaceEvent: (event) => {
        void this.features.handleIncomingWorkspaceEvent(event);
      },
    });

    this.toastController = new ToastController(this.elements.toastContainer);
    this.chatToastController = new ToastController(this.elements.chatToastContainer);
    this.fileExplorer = new FileExplorerController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onFileDelete: () => this.navigation.navigateToFile(null),
      onFileSelect: (filePath) => this.features.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      pendingWorkspaceRequestIds: this.pendingWorkspaceRequestIds,
      toastController: this.toastController,
      vaultClient: this.vaultApiClient,
    });
    this.commentsOverview = new CommentOverviewController({
      onOverviewChange: (_overview, { threadCounts }) => {
        this.fileExplorer.setThreadCounts(threadCounts);
      },
      onThreadSelect: (payload) => this.features.openCommentOverviewThread(payload),
      panelElement: this.elements.commentOverviewPanel,
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
    });
    this.gitPanel = this.features.createLazyGitPanelController();
    this.outlineController = new OutlineController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onNavigateToHeading: ({ sourceLine }) => {
        if (!Number.isFinite(sourceLine)) return;
        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
      onWillOpen: () => this.commentUi?.closeDrawer(),
    });
    this.videoEmbed = new VideoEmbedController({
      previewElement: this.elements.previewContent,
    });
    this.basesPreview = this.features.createLazyBasesPreviewController();
    this.imageLightbox = new ImageLightboxController({
      previewElement: this.elements.previewContent,
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.features.getPreviewSource(),
      getFileList: () => this.fileExplorer.flatDocumentFiles,
      getWikiLinkAutoCreate: () => this.runtimeConfig.wikiLinkAutoCreate !== false,
      loadFileSource: async (filePath) => {
        const payload = await this.vaultApiClient.readFile(filePath);
        return String(payload?.content ?? '');
      },
      getSourceFilePath: () => this.currentFilePath,
      onAfterRenderCommit: (_previewElement, stats) => {
        this.recordFileOpenMetric('preview_committed', {
          chars: stats?.chars ?? 0,
          renderVersion: stats?.renderVersion ?? 0,
        });
        this.videoEmbed.reconcileEmbeds(this.elements.previewContent);
        this.videoEmbed.syncLayout();
        this.basesPreview.reconcileEmbeds(this.elements.previewContent);
        this.drawioEmbed.reconcileEmbeds(this.elements.previewContent);
        this.drawioEmbed.syncLayout();
        this.excalidrawEmbed.reconcileEmbeds(this.elements.previewContent, { isLargeDocument: stats.isLargeDocument });
        this.excalidrawEmbed.syncLayout();
        this.scrollSyncController.setLargeDocumentMode(stats.isLargeDocument);
        this.features.syncPreviewHeadingLinkButtons();
        this.features.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: true });
        this.features.schedulePreviewLayoutSync({ delayMs: 0 });
        this.features.refreshCommentUiLayout();
      },
      onBeforeRenderCommit: () => {
        this.videoEmbed.detachForCommit();
        this.drawioEmbed.detachForCommit();
        this.excalidrawEmbed.detachForCommit();
      },
      onPreviewLayoutChange: () => {
        this.scrollSyncController.invalidatePreviewBlocks();
        this.features.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: false });
        this.features.schedulePreviewLayoutSync({ delayMs: 0 });
        this.features.refreshCommentUiLayout();
      },
      onRenderComplete: () => {
        this.videoEmbed.syncLayout();
        this.drawioEmbed.syncLayout();
        this.excalidrawEmbed.syncLayout();
        this.features.applyPendingPreviewRouteAnchor({ allowExpired: true, behavior: 'auto', clearMissing: true });
        this.features.schedulePreviewLayoutSync({ delayMs: 0 });
        this.features.refreshCommentUiLayout();
      },
      outlineController: this.outlineController,
      plantUmlRenderClient: this.plantUmlApiClient,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      toastController: this.toastController,
    });
    this.themeController = new ThemeController({ onChange: (theme) => this.features.handleThemeChange(theme) });
    this.layoutController = new LayoutController({
      mobileBreakpointQuery: this.mobileBreakpointQuery,
      onMeasureEditor: () => this.session?.requestMeasure(),
      onViewRequest: (view) => this.features.handleLayoutViewRequest(view),
    });
    this.scrollSyncController = new ScrollSyncController({
      getEditorLineNumber: () => this.session?.getTopVisibleLineNumber(0.35) ?? 1,
      onEditorScrollActivityChange: (isActive) => this.features.handleEditorScrollActivityChange(isActive),
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      scrollEditorToLine: (lineNumber, viewportRatio) => this.session?.scrollToLine(lineNumber, viewportRatio),
    });
    this.backlinksPanel = new BacklinksPanel({
      headerPanelElement: this.elements.backlinksHeaderPanel,
      inlinePanelElement: this.elements.backlinksInlinePanel,
      loadBacklinks: (filePath, options = {}) => this.backlinksApiClient.readBacklinks(filePath, options),
      onFileSelect: (filePath) => this.features.handleFileSelection(filePath, { closeSidebarOnMobile: true }),
      panelElement: this.elements.backlinksPanel,
    });
    this.excalidrawEmbed = this.features.createLazyExcalidrawEmbedController();
    this.drawioEmbed = this.features.createLazyDrawioEmbedController();
    this.commentUi = new CommentUiController({
      commentSelectionButton: this.elements.commentSelectionButton,
      commentsDrawer: this.elements.commentsDrawer,
      commentsDrawerEmpty: this.elements.commentsDrawerEmpty,
      commentsDrawerList: this.elements.commentsDrawerList,
      commentsToggleButton: this.elements.commentsToggleButton,
      editorContainer: this.elements.editorContainer,
      onWillOpenDrawer: () => this.outlineController.close(),
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      onCreateThread: ({ anchor, body }) => this.features.createCommentThread({ anchor, body }),
      onNavigateToLine: (lineNumber) => {
        const session = this.session;
        this.scrollSyncController.suspendSync(250);
        const didScroll = session?.scrollToLine(lineNumber, 0.2);
        if (didScroll) {
          requestAnimationFrame(() => {
            if (this.session !== session) {
              return;
            }

            this.scrollSyncController.suspendSync(0);
            this.scrollSyncController.syncPreviewToEditor();
          });
        }
      },
      onReplyToThread: (threadId, body) => this.features.replyToCommentThread(threadId, body),
      onToggleReaction: (threadId, messageId, emoji) => this.session?.toggleCommentReaction(threadId, messageId, emoji),
      onResolveThread: (threadId) => this.features.resolveCommentThread(threadId),
    });
    this.workspacePreviewController = new WorkspacePreviewController({
      backlinksPanel: this.backlinksPanel,
      basesPreview: this.basesPreview,
      drawioEmbed: this.drawioEmbed,
      elements: this.elements,
      excalidrawEmbed: this.excalidrawEmbed,
      getDisplayName: (filePath) => this.features.getDisplayName(filePath),
      getSession: () => this.session,
      isBaseFile: (filePath) => this.features.isBaseFile(filePath),
      isDrawioFile: (filePath) => this.features.isDrawioFile(filePath),
      isExcalidrawFile: (filePath) => this.features.isExcalidrawFile(filePath),
      isImageFile: (filePath) => this.features.isImageFile(filePath),
      isMermaidFile: (filePath) => this.features.isMermaidFile(filePath),
      isPlantUmlFile: (filePath) => this.features.isPlantUmlFile(filePath),
      layoutController: this.layoutController,
      outlineController: this.outlineController,
      previewRenderer: this.previewRenderer,
      schedulePreviewLayoutSync: (options) => this.features.schedulePreviewLayoutSync(options),
      scrollSyncController: this.scrollSyncController,
      videoEmbed: this.videoEmbed,
    });
    this.wikiLinkFileController = new WikiLinkFileController({
      getFileList: () => this.fileExplorer.flatDocumentFiles,
      navigation: this.navigation,
      refreshExplorer: () => this.fileExplorer.refresh(),
      toastController: this.toastController,
      vaultApiClient: this.vaultApiClient,
      wikiLinkAutoCreate: this.runtimeConfig.wikiLinkAutoCreate !== false,
    });
    this.gitDiffView = this.features.createLazyGitDiffViewController();
    this.fileHistoryView = this.features.createLazyFileHistoryViewController();
    this.tabActivityLock = new TabActivityLock({
      onActivated: ({ takeover }) => this.features.handleTabActivated({ takeover }),
      onBlocked: () => this.features.handleTabBlocked({ reason: 'active-elsewhere' }),
      onStolen: () => this.features.handleTabBlocked({ reason: 'taken-over' }),
    });
    this.workspaceCoordinator = new WorkspaceCoordinator({
      attachEditorScroller: (scroller) => this.scrollSyncController.attachEditorScroller(scroller),
      beginDocumentLoad: () => this.previewRenderer.beginDocumentLoad(),
      cleanupAfterSessionDestroy: () => {
        this.scrollSyncController.setLargeDocumentMode(false);
        this.scrollSyncController.invalidatePreviewBlocks();
        this.outlineController.cleanup();
        this.followedCursorSignature = '';
        clearTimeout(this._backlinkRefreshTimer);
      },
      createEditorSession: (EditorSession, options) => new EditorSession({
        editorContainer: this.elements.editorContainer,
        getFileList: options.getFileList,
        initialTheme: options.theme,
        lineInfoElement: this.elements.lineInfo,
        lineWrappingEnabled: options.lineWrappingEnabled,
        localUser: options.localUser,
        onImagePaste: options.onImagePaste,
        onAwarenessChange: options.onAwarenessChange,
        onCommentsChange: options.onCommentsChange,
        onConnectionChange: options.onConnectionChange,
        onContentChange: options.onContentChange,
        onSelectionChange: options.onSelectionChange,
        preferredUserName: options.preferredUserName,
      }),
      getDisplayName: (filePath) => this.features.getDisplayName(filePath),
      getFileList: () => this.fileExplorer.flatDocumentFiles,
      getLineWrappingEnabled: () => this.features.getStoredLineWrapping(),
      getLocalUser: () => this.lobby.getLocalUser(),
      getStoredUserName: () => this.features.getStoredUserName(),
      getTheme: () => this.themeController.getTheme(),
      isBaseFile: (filePath) => this.features.isBaseFile(filePath),
      isDrawioFile: (filePath) => this.features.isDrawioFile(filePath),
      isExcalidrawFile: (filePath) => this.features.isExcalidrawFile(filePath),
      isImageFile: (filePath) => this.features.isImageFile(filePath),
      isMermaidFile: (filePath) => this.features.isMermaidFile(filePath),
      isPlantUmlFile: (filePath) => this.features.isPlantUmlFile(filePath),
      isTabActive: () => this.isTabActive,
      loadBootstrapContent: async (filePath) => {
        const response = await this.vaultApiClient.readFile(filePath);
        return typeof response?.content === 'string' ? response.content : null;
      },
      loadEditorSessionClass: () => this.loadEditorSessionClass(),
      loadBacklinks: (filePath) => this.backlinksPanel.load(filePath),
      onBeforeFileOpen: () => {
        this.session = null;
        this.commentUi.attachSession(null);
        this.layoutController.reset();
        this.features.resetPreviewMode();
        this.elements.emptyState?.classList.add('hidden');
        this.elements.editorPage?.classList.remove('hidden');
        this.elements.diffPage?.classList.add('hidden');
        this.features.clearInitialFileBootstrap();
      },
      onConnectionChange: (state) => this.features.handleConnectionChange(state),
      onContentChange: ({ isBase, isMermaid, isPlantUml }) => {
        this.features.handleCommentEditorContentChange();
        if (isBase) {
          void this.features.renderBaseFilePreview(this.currentFilePath, {
            source: this.session?.getText?.() ?? '',
          });
          return;
        }

        this.previewRenderer.queueRender();
        if (!isMermaid && !isPlantUml) {
          this.features.scheduleBacklinkRefresh();
        }
      },
      onCommentsChange: (threads) => this.features.handleCommentThreadsChange(threads),
      onFileAwarenessChange: (users) => this.features.updateFileAwareness(users),
      onFileOpenError: () => {
        this.features.showEditorLoadError();
        this.features.syncWrapToggle();
        this.toastController.show('Failed to initialize editor');
      },
      onFileOpenReady: () => {
        this.features.hideEditorLoading();
      },
      onSelectionChange: (anchor) => this.features.handleCommentSelectionChange(anchor),
      onImagePaste: (file) => this.features.handleEditorImageInsert(file),
      onFileOpenMetric: (name, payload) => this.recordFileOpenMetric(name, payload),
      onSessionAssigned: (session) => {
        this.session = session;
        this.commentUi.attachSession(session);
      },
      onRenderDrawioPreview: (filePath) => this.features.renderDrawioFilePreview(filePath),
      onRenderBasePreview: (filePath) => this.features.renderBaseFilePreview(filePath),
      onRenderExcalidrawPreview: (filePath) => this.features.renderExcalidrawFilePreview(filePath),
      onRenderImagePreview: (filePath) => this.features.renderImageFilePreview(filePath),
      onSyncWrapToggle: () => this.features.syncWrapToggle(),
      onUpdateActiveFile: (filePath) => this.fileExplorer.setActiveFile(filePath),
      onUpdateCurrentFile: (filePath) => {
        this.currentFilePath = filePath;
      },
      onUpdateLobbyCurrentFile: (filePath) => this.lobby.setCurrentFile(filePath),
      onUpdateVisibleChrome: (filePath, { displayName }) => {
        this.features.syncFileChrome(filePath, {
          drawioMode: this.currentDrawioMode,
          preferPreviewForBase: this.features.isBaseFile(filePath),
        });
        this.features.syncCommentChrome(filePath);
        this.features.syncFileHistoryButton({ filePath, mode: 'editor' });
        if (this.elements.activeFileName) {
          this.elements.activeFileName.textContent = displayName;
        }
      },
      onViewModeReset: () => this.features.resetPreviewMode(),
      renderPresence: () => this.features.renderPresence(),
      scrollContainerForSession: (session) => session.getScrollContainer(),
      shouldUseDrawioPreview: () => Boolean(this.runtimeConfig.drawioBaseUrl),
      showEditorLoading: () => this.features.showEditorLoading(),
      stateStore: this,
    });
    this.workspaceRouteController = new WorkspaceRouteController({
      backlinksPanel: this.backlinksPanel,
      clearInitialFileBootstrap: () => this.features.clearInitialFileBootstrap(),
      clearStaticPreviewDocument: () => this.features.clearStaticPreviewDocument(),
      closeSidebarOnMobile: () => this.features.closeSidebarOnMobile(),
      drawioEmbed: this.drawioEmbed,
      elements: this.elements,
      excalidrawEmbed: this.excalidrawEmbed,
      fileHistoryView: this.fileHistoryView,
      fileExplorer: this.fileExplorer,
      getIsTabActive: () => this.isTabActive,
      getSessionLoadToken: () => this.sessionLoadToken,
      gitDiffView: this.gitDiffView,
      gitPanel: this.gitPanel,
      imageLightbox: this.imageLightbox,
      layoutController: this.layoutController,
      lobby: this.lobby,
      navigation: this.navigation,
      previewRenderer: this.previewRenderer,
      requestPreviewRouteAnchor: (anchorId, filePath) => this.features.requestPreviewRouteAnchor(anchorId, filePath),
      renderAvatars: () => this.features.renderAvatars(),
      renderPresence: () => this.features.renderPresence(),
      resetPreviewMode: () => this.features.resetPreviewMode(),
      scrollSyncController: this.scrollSyncController,
      setCurrentFilePath: (value) => {
        this.currentFilePath = value;
        if (!value) {
          this.commentUi.setCurrentFile(null, { supported: false });
          this.features.handleCommentThreadsChange([]);
          this.features.handleCommentSelectionChange(null);
        }
      },
      setSession: (value) => {
        this.session = value;
        this.commentUi.attachSession(value);
      },
      setSessionLoadToken: (value) => {
        this.sessionLoadToken = value;
      },
      setSidebarTab: (value) => this.features.setSidebarTab(value),
      setSidebarVisibility: (showSidebar) => this.features.setSidebarVisibility(showSidebar),
      showGitCommit: (route) => this.features.showGitCommit(route),
      showGitDiff: (route) => this.features.showGitDiff(route),
      showGitFileHistory: (route) => this.features.showGitFileHistory(route),
      showGitFilePreview: (route) => this.features.showGitFilePreview(route),
      showGitHistory: () => this.features.showGitHistory(),
      syncMainChrome: (payload) => this.features.syncMainChrome(payload),
      videoEmbed: this.videoEmbed,
      workspaceCoordinator: this.workspaceCoordinator,
    });

    if (this.chatNotificationPermission !== 'granted') {
      this.chatNotificationsEnabled = false;
    }
  }

  get session() { return this._session; }
  set session(value) { this._session = value; }

  publishFileOpenPerf() {
    if (typeof window === 'undefined') {
      return;
    }

    window.__COLLABMD_PERF__ ??= {};
    window.__COLLABMD_PERF__.fileOpen = this._fileOpenPerf
      ? {
        ...this._fileOpenPerf,
        details: { ...this._fileOpenPerf.details },
        marks: { ...this._fileOpenPerf.marks },
      }
      : null;
  }

  recordFileOpenMetric(name, payload = {}) {
    if (name === 'open_started') {
      this._fileOpenPerf = {
        details: {
          filePath: payload.filePath || this.currentFilePath || '',
          loadToken: payload.loadToken ?? 0,
        },
        marks: {
          open_started: performance.now(),
        },
      };
      this.publishFileOpenPerf();
      return;
    }

    if (!this._fileOpenPerf) {
      return;
    }

    const metricLoadToken = payload.loadToken ?? this._fileOpenPerf.details.loadToken;
    if (metricLoadToken !== this._fileOpenPerf.details.loadToken) {
      return;
    }

    this._fileOpenPerf.marks[name] = performance.now();
    if (payload.filePath) {
      this._fileOpenPerf.details.filePath = payload.filePath;
    }
    Object.entries(payload).forEach(([key, value]) => {
      if (key === 'filePath' || key === 'loadToken') {
        return;
      }
      this._fileOpenPerf.details[key] = value;
    });
    this.publishFileOpenPerf();
  }

  loadEditorSessionClass() {
    if (!this._editorSessionModulePromise) {
      this._editorSessionModulePromise = import('../infrastructure/editor-session.js')
        .then((module) => module.EditorSession);
    }

    return this._editorSessionModulePromise;
  }

  scheduleEditorSessionPrewarm({ timeout = 1500 } = {}) {
    if (this._editorSessionModulePromise || this._editorSessionPrewarmHandle) {
      return;
    }

    const runPrewarm = () => {
      this._editorSessionPrewarmHandle = null;
      void this.loadEditorSessionClass();
    };

    if (typeof window.requestIdleCallback === 'function') {
      this._editorSessionPrewarmHandle = window.requestIdleCallback(runPrewarm, { timeout });
      return;
    }

    this._editorSessionPrewarmHandle = window.setTimeout(runPrewarm, 0);
  }

  loadQuickSwitcherController() {
    return import('../presentation/quick-switcher-controller.js')
      .then((module) => module.QuickSwitcherController);
  }

  async ensureQuickSwitcher() {
    return ensureQuickSwitcherInstance(this);
  }

  async toggleQuickSwitcher() {
    return toggleQuickSwitcherInstance(this);
  }
}
