import { WorkspaceRouteController } from '../application/workspace-route-controller.js';
import { WorkspaceCoordinator } from '../application/workspace-coordinator.js';
import { bindAppShellElements } from '../application/app-shell-elements.js';
import { governanceFeature } from '../application/app-shell/governance-feature.js';
import { uiFeatureShellMethods } from '../application/app-shell/ui-feature-shell.js';
import { uiFeatureTabActivityMethods } from '../application/app-shell/ui-feature-tab-activity.js';
import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { createRandomUser } from '../domain/room.js';
import { BrowserPreferencesPort } from '../infrastructure/browser-preferences-port.js';
import { GovernanceClient } from '../infrastructure/governance-client.js';
import { getHashRoute, getRuntimeConfig, navigateToFile } from '../infrastructure/runtime-config.js';
import { TabActivityLock } from '../infrastructure/tab-activity-lock.js';
import { WebMcpToolRegistry } from '../infrastructure/webmcp-tool-registry.js';
import { WorkspaceSyncClient } from '../infrastructure/workspace-sync-client.js';
import { FileTreeState } from '../presentation/file-tree-state.js';
import { GovernanceUiController } from '../presentation/governance-ui-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';

const APP_SHELL_FEATURES = [
  governanceFeature,
  {
    ...uiFeatureShellMethods,
    ...uiFeatureTabActivityMethods,
  },
];

export function hasGovernanceCapability(snapshot, capability) {
  return snapshot?.state === 'active'
    && Array.isArray(snapshot.capabilities)
    && snapshot.capabilities.includes(capability);
}

export class CollabMdAppShell {
  constructor() {
    for (const feature of APP_SHELL_FEATURES) {
      for (const [name, method] of Object.entries(feature)) {
        if (!(name in this)) {
          this[name] = method;
        }
      }
    }

    this.elements = bindAppShellElements(document);
    this.runtimeConfig = getRuntimeConfig();
    this.connectionHelpShown = false;
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.currentFilePath = null;
    this.governanceDocumentPath = null;
    this.governanceLoad = { documentPath: null, error: null, phase: 'loading' };
    this.governanceRoles = null;
    this.governanceSnapshot = null;
    this.isTabActive = false;
    this.sessionLoadToken = 0;
    this._hasPromptedForDisplayName = false;
    this._session = null;
    this.navigation = {
      getHashRoute,
      navigateToFile,
    };
    this.preferences = new BrowserPreferencesPort({
      lineWrappingKey: 'collabmd-editor-line-wrap',
      recentFilesKey: 'collabmd-recent-files',
      userNameKey: 'collabmd-user-name',
      vimModeKey: 'collabmd-editor-vim-mode',
    });
    this.localUser = createRandomUser(this.getStoredUserName());

    this.toastController = new ToastController(this.elements.toastContainer);
    this.themeController = new ThemeController({
      onChange: (theme) => this.handleThemeChange(theme),
    });
    this.documentIndex = new FileTreeState();
    this.workspaceSync = new WorkspaceSyncClient({
      onTreeChange: (tree, { reset = false } = {}) => {
        this.documentIndex.setTree(tree);
        if (reset) {
          void this.workspaceRouteController?.handleHashChange();
          return;
        }
        if (this.currentFilePath && !this.session) {
          void this.workspaceCoordinator?.openFile(this.currentFilePath);
        }
      },
      onWorkspaceEvent: (event) => {
        void this.handleIncomingWorkspaceEvent(event);
      },
    });

    this.governanceClient = new GovernanceClient();
    this.governanceUi = new GovernanceUiController({
      documentSurface: this.elements.documentSurface,
      governanceRail: this.elements.governanceRail,
      governanceStatusCopy: this.elements.governanceStatusCopy,
      governanceStatusPanel: this.elements.governanceStatusPanel,
      governanceStatusRetry: this.elements.governanceStatusRetry,
      governanceStatusTitle: this.elements.governanceStatusTitle,
      manageAccessButton: this.elements.manageAccessButton,
      manageAccessDialog: this.elements.manageAccessDialog,
      onAssignRole: (participantSessionId, roleId) => (
        this.assignGovernanceRole(participantSessionId, roleId)
      ),
      onResolveProposal: (proposalId, resolution) => {
        void this.resolveGovernanceProposal(proposalId, resolution);
      },
      onRetry: () => {
        void this.workspaceRouteController.handleHashChange({ forceGovernance: true });
      },
      onRevoke: (participantSessionId) => this.revokeGovernanceGrant(participantSessionId),
      onSelectProposal: (proposalId) => this.selectGovernanceProposal(proposalId),
      participantBar: this.elements.participantBar,
      skipToEditor: this.elements.skipToEditor,
    });
    this.webMcpTools = new WebMcpToolRegistry({
      getActiveFilePath: () => this.currentFilePath,
      getIsTabActive: () => this.isTabActive,
      getSession: () => this.session,
      governanceClient: this.governanceClient,
      onDidEdit: ({ replacementCount }) => {
        this.toastController.show(`Agent-assisted edit applied (${replacementCount} replacement${replacementCount === 1 ? '' : 's'}).`);
      },
    });

    this.governanceClient.subscribe((snapshot, transition = {}) => {
      const previous = this.governanceSnapshot;
      this.governanceSnapshot = snapshot;
      let next = snapshot;
      if (snapshot && this.governanceLoad.phase === 'error'
        && snapshot.documentPath === this.currentFilePath) {
        this.governanceLoad = {
          documentPath: snapshot.documentPath,
          error: null,
          phase: 'ready',
        };
      } else if (!snapshot && transition.documentPath === this.currentFilePath) {
        this.governanceLoad = {
          documentPath: transition.documentPath,
          error: transition.error ?? new Error('Unable to verify governance Access'),
          phase: 'error',
        };
        next = {
          capabilities: [],
          documentPath: transition.documentPath,
          participantSessionId: previous?.participantSessionId,
          roleId: undefined,
          state: transition.status,
        };
      }
      void this.applyGovernanceSnapshotTransition(previous, next);
      this.renderGovernanceUi();
      void this.webMcpTools.refresh();
    });

    this.workspaceCoordinator = new WorkspaceCoordinator({
      createEditorSession: (EditorSession, options) => new EditorSession({
        canComment: false,
        canEdit: options.canEdit,
        editorContainer: this.elements.editorContainer,
        getFileList: options.getFileList,
        getGovernanceSnapshot: options.getGovernanceSnapshot,
        governed: true,
        initialTheme: options.theme,
        lineWrappingEnabled: options.lineWrappingEnabled,
        localUser: options.localUser,
        onAwarenessChange: options.onAwarenessChange,
        onConnectionChange: options.onConnectionChange,
        onContentChange: options.onContentChange,
        onSelectionChange: options.onSelectionChange,
        preferredUserName: options.preferredUserName,
        vimModeEnabled: options.vimModeEnabled,
      }),
      getFileList: () => this.documentIndex.flatFiles.filter(
        (path) => !isImageAttachmentFilePath(path),
      ),
      getGovernanceSnapshot: () => this.governanceSnapshot,
      getLineWrappingEnabled: () => this.getStoredLineWrapping(),
      getLocalUser: () => this.localUser,
      getStoredUserName: () => this.getStoredUserName(),
      getTheme: () => this.themeController.getTheme(),
      getVaultFileList: () => this.documentIndex.flatFiles,
      getVimModeEnabled: () => this.getStoredVimMode(),
      hasGovernanceCapability,
      isTabActive: () => this.isTabActive,
      loadEditorSessionClass: () => this.loadEditorSessionClass(),
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: () => {
        void this.webMcpTools.refresh();
      },
      onFileOpenError: ({ code, filePath } = {}) => {
        const error = new Error(code === 'not-found' ? 'Document not found' : 'Failed to load document');
        this.currentFilePath = filePath ?? this.currentFilePath;
        this.governanceDocumentPath = null;
        this.governanceClient.destroy();
        if (this.elements.activeFileName && this.currentFilePath) {
          this.elements.activeFileName.textContent = this.currentFilePath.split('/').pop();
        }
        this.governanceLoad = {
          documentPath: this.currentFilePath,
          error,
          phase: 'error',
        };
        this.governanceSnapshot = null;
        this.renderGovernanceUi();
      },
      onFileOpenReady: (session) => {
        this.clearInitialFileBootstrap();
        this.bindGovernanceSession(session);
      },
      onGovernanceAccessChanged: ({ discarded, state }) => {
        if (discarded) {
          this.toastController.show(`Access changed (${state}). Unsynchronized local changes were discarded.`);
        }
      },
      onGovernanceDocumentCleared: () => {
        this.elements.editorContainer?.replaceChildren();
      },
      onSessionAssigned: (session) => {
        this.session = session;
        this.bindGovernanceSession(session);
      },
      onUpdateCurrentFile: (filePath) => {
        this.currentFilePath = filePath;
        this.renderGovernanceUi();
      },
      refreshGovernanceSnapshot: () => this.governanceClient.refresh(),
      stateStore: this,
    });

    this.workspaceRouteController = new WorkspaceRouteController({
      getIsDocumentIndexReady: () => this.workspaceSync.isInitialIndexReady(),
      getIsTabActive: () => this.isTabActive,
      hasIndexedDocument: (filePath) => this.documentIndex.flatFiles.includes(filePath),
      navigation: this.navigation,
      onDocumentRequested: async (filePath, { force = false } = {}) => {
        this.currentFilePath = filePath;
        if (this.elements.activeFileName) {
          this.elements.activeFileName.textContent = filePath
            ? filePath.split('/').pop()
            : 'Governed workspace';
        }
        if (!filePath) {
          this.governanceDocumentPath = null;
          this.governanceSnapshot = null;
          this.governanceLoad = { documentPath: null, error: null, phase: 'loading' };
          this.governanceClient.destroy();
          this.renderGovernanceUi();
          return;
        }
        await this.initializeGovernanceTabActivity(filePath, { force });
      },
      workspaceCoordinator: this.workspaceCoordinator,
    });

    this.createTabActivityLock = (scope) => new TabActivityLock({
      onActivated: ({ takeover }) => this.handleTabActivated({ takeover }),
      onBlocked: () => this.handleTabBlocked({ reason: 'active-elsewhere' }),
      onStolen: () => this.handleTabBlocked({ reason: 'taken-over' }),
      scope,
    });
  }

  get session() {
    return this._session;
  }

  set session(value) {
    this._session = value;
    void this.webMcpTools?.refresh();
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

  async handleIncomingWorkspaceEvent(event) {
    if (!this.isTabActive || !event || !this.currentFilePath) {
      return;
    }
    if (event.workspaceChange?.changedPaths?.includes(this.currentFilePath)) {
      const highlightRange = event.highlightRanges?.find?.((entry) => entry.path === this.currentFilePath);
      const didFlash = highlightRange ? this.session?.flashExternalUpdate?.(highlightRange) : false;
      if (!didFlash) {
        this.toastController.show(`${this.currentFilePath.split('/').pop()} updated from disk`);
      }
    }
  }
}
