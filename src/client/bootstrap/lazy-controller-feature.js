import { getVaultPathLeaf } from '../domain/vault-paths.js';

function createLazyControllerProxy({
  createController,
  fallback = {},
  loadController,
  onControllerReady = null,
  shouldLoad = () => true,
}) {
  let controller = null;
  let controllerPromise = null;

  const ensure = async () => {
    if (controller) {
      return controller;
    }
    if (!controllerPromise) {
      controllerPromise = loadController()
        .then((ControllerClass) => {
          controller = createController(ControllerClass);
          onControllerReady?.(controller);
          return controller;
        })
        .catch((error) => {
          controllerPromise = null;
          throw error;
        });
    }
    return controllerPromise;
  };

  const proxy = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop !== 'string') {
        return undefined;
      }
      if (prop === 'ensure') {
        return ensure;
      }
      if (prop === 'current') {
        return controller;
      }
      if (controller && prop in controller) {
        const value = controller[prop];
        return typeof value === 'function' ? value.bind(controller) : value;
      }
      if (Object.hasOwn(fallback, prop)) {
        const value = fallback[prop];
        return typeof value === 'function' ? value.bind(proxy) : value;
      }
      return (...args) => {
        if (!shouldLoad(prop, args)) {
          return undefined;
        }
        return ensure().then((resolvedController) => {
          const value = resolvedController[prop];
          return typeof value === 'function' ? value.apply(resolvedController, args) : value;
        });
      };
    },
  });

  return proxy;
}

function hasPreviewSelector(previewElement, selector) {
  return Boolean(previewElement?.querySelector?.(selector));
}

export const lazyControllerFeature = {
  reportLazyControllerError(label, error) {
    console.error(`[lazy-controller] Failed to load ${label}.`, error);
    this.toastController?.show?.(`Failed to load ${label}. Try again.`, {
      dismissible: true,
    });
  },

  loadBasesPreviewController() {
    return import('../presentation/bases-preview-controller.js')
      .then((module) => module.BasesPreviewController);
  },

  loadDrawioEmbedController() {
    return import('../presentation/drawio-embed-controller.js')
      .then((module) => module.DrawioEmbedController);
  },

  loadExcalidrawEmbedController() {
    return import('../presentation/excalidraw-embed-controller.js')
      .then((module) => module.ExcalidrawEmbedController);
  },

  loadGitPanelController() {
    return import('../presentation/git-panel-controller.js')
      .then((module) => module.GitPanelController);
  },

  loadGitDiffViewController() {
    return import('../presentation/git-diff-view-controller.js')
      .then((module) => module.GitDiffViewController);
  },

  loadFileHistoryViewController() {
    return import('../presentation/file-history-view-controller.js')
      .then((module) => module.FileHistoryViewController);
  },

  createLazyBasesPreviewController() {
    let proxy;
    proxy = createLazyControllerProxy({
      createController: (BasesPreviewController) => new BasesPreviewController({
        getActiveFilePath: () => this.currentFilePath,
        getSession: () => this.session,
        onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
        previewElement: this.elements.previewContent,
        replaceBaseSource: ({ path, source }) => {
          if (path && path === this.currentFilePath) {
            this.session?.replaceText?.(source);
          }
        },
        toastController: this.toastController,
        vaultApiClient: this.vaultApiClient,
      }),
      fallback: {
        destroy: () => { },
        reconcileEmbeds: (previewElement = this.elements.previewContent) => {
          if (!hasPreviewSelector(previewElement, '.bases-embed-placeholder[data-base-key]')) {
            return;
          }
          void proxy.ensure()
            .then((controller) => controller.reconcileEmbeds(previewElement))
            .catch((error) => this.reportLazyControllerError('Bases preview', error));
        },
        renderStandalone: async (payload) => {
          const controller = await proxy.ensure();
          return controller.renderStandalone(payload);
        },
      },
      loadController: () => this.loadBasesPreviewController(),
      shouldLoad: (methodName) => methodName === 'renderStandalone',
    });
    return proxy;
  },

  createLazyDrawioEmbedController() {
    const state = {
      hydrationPaused: false,
      theme: null,
    };
    let proxy;
    proxy = createLazyControllerProxy({
      createController: (DrawioEmbedController) => new DrawioEmbedController({
        getLocalUser: () => this.lobby.getLocalUser(),
        getTheme: () => this.themeController.getTheme(),
        onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
        onOpenTextFile: (filePath) => filePath && this.navigation.navigateToFile(filePath, { drawioMode: 'text' }),
        onToggleQuickSwitcher: () => {
          void this.toggleQuickSwitcher();
        },
        previewContainer: this.elements.previewContainer,
        previewElement: this.elements.previewContent,
        toastController: this.toastController,
        vaultApiClient: this.vaultApiClient,
      }),
      fallback: {
        destroy: () => { },
        detachForCommit: () => { },
        hydrateVisibleEmbeds: () => { },
        reconcileEmbeds: (previewElement = this.elements.previewContent) => {
          if (!hasPreviewSelector(previewElement, '.drawio-embed-placeholder[data-drawio-key]')) {
            return;
          }
          void proxy.ensure()
            .then((controller) => {
              controller.reconcileEmbeds(previewElement);
              controller.hydrateVisibleEmbeds();
              controller.syncLayout();
            })
            .catch((error) => this.reportLazyControllerError('Draw.io preview', error));
        },
        setHydrationPaused: (paused) => {
          state.hydrationPaused = Boolean(paused);
        },
        syncLayout: () => { },
        updateLocalUser: () => { },
        updateTheme: (theme) => {
          state.theme = theme;
        },
      },
      loadController: () => this.loadDrawioEmbedController(),
      onControllerReady: (controller) => {
        controller.setHydrationPaused(state.hydrationPaused);
        if (state.theme) {
          controller.updateTheme(state.theme);
        }
      },
    });
    return proxy;
  },

  createLazyExcalidrawEmbedController() {
    const state = {
      hydrationPaused: false,
      localUser: null,
      theme: null,
    };
    let proxy;
    proxy = createLazyControllerProxy({
      createController: (ExcalidrawEmbedController) => new ExcalidrawEmbedController({
        getLocalUser: () => this.lobby.getLocalUser(),
        getTheme: () => this.themeController.getTheme(),
        onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
        onToggleQuickSwitcher: () => {
          void this.toggleQuickSwitcher();
        },
        previewContainer: this.elements.previewContainer,
        previewElement: this.elements.previewContent,
        toastController: this.toastController,
      }),
      fallback: {
        destroy: () => { },
        detachForCommit: () => { },
        hydrateVisibleEmbeds: () => { },
        prepareFileDisconnect: async () => false,
        reconcileEmbeds: (previewElement = this.elements.previewContent, options = {}) => {
          if (!hasPreviewSelector(previewElement, '.excalidraw-embed-placeholder[data-embed-key]')) {
            return;
          }
          void proxy.ensure()
            .then((controller) => {
              controller.reconcileEmbeds(previewElement, options);
              controller.hydrateVisibleEmbeds();
              controller.syncLayout();
            })
            .catch((error) => this.reportLazyControllerError('Excalidraw preview', error));
        },
        setHydrationPaused: (paused) => {
          state.hydrationPaused = Boolean(paused);
        },
        syncLayout: () => { },
        updateLocalUser: (user) => {
          state.localUser = user;
        },
        updateTheme: (theme) => {
          state.theme = theme;
        },
      },
      loadController: () => this.loadExcalidrawEmbedController(),
      onControllerReady: (controller) => {
        controller.setHydrationPaused(state.hydrationPaused);
        if (state.theme) {
          controller.updateTheme(state.theme);
        }
        if (state.localUser) {
          controller.updateLocalUser(state.localUser);
        }
      },
    });
    return proxy;
  },

  createLazyGitPanelController() {
    const state = {
      active: false,
      mode: 'changes',
      selection: {},
    };
    let proxy;
    proxy = createLazyControllerProxy({
      createController: (GitPanelController) => new GitPanelController({
        enabled: this.runtimeConfig.gitEnabled !== false,
        gitApiClient: this.gitApiClient,
        onCommitStaged: () => this.openGitCommitDialog(),
        onOpenPullBackup: (filePath) => filePath && this.navigation.navigateToFile(filePath),
        onPullBranch: () => this.pullGitBranch(),
        onPushBranch: () => this.pushGitBranch(),
        onRepoChange: (isGitRepo, status) => this.handleGitRepoChange(isGitRepo, status),
        onResetFile: (filePath, { scope }) => this.openGitResetDialog(filePath, { scope }),
        onSelectCommit: (hash, { path }) => this.handleGitCommitSelection(hash, { closeSidebarOnMobile: true, path }),
        onSelectDiff: (filePath, { scope }) => this.handleGitDiffSelection(filePath, { closeSidebarOnMobile: true, scope }),
        onStageFile: (filePath, { scope }) => this.stageGitFile(filePath, { scope }),
        onUnstageFile: (filePath, { scope }) => this.unstageGitFile(filePath, { scope }),
        onViewAllDiff: () => this.handleGitDiffSelection(null, { closeSidebarOnMobile: true, scope: 'all' }),
        searchInput: this.elements.gitSearchInput,
        toastController: this.toastController,
      }),
      fallback: {
        initialize: () => { },
        refresh: async (options) => {
          const controller = await proxy.ensure();
          return controller.refresh(options);
        },
        setActive: (active) => {
          state.active = Boolean(active);
          if (state.active) {
            void proxy.ensure().catch((error) => this.reportLazyControllerError('Git panel', error));
          }
        },
        setMode: (mode) => {
          state.mode = mode;
          if (state.active) {
            void proxy.ensure().catch((error) => this.reportLazyControllerError('Git panel', error));
          }
        },
        setSelection: (selection = {}) => {
          state.selection = selection;
          if (state.active) {
            void proxy.ensure().catch((error) => this.reportLazyControllerError('Git panel', error));
          }
        },
        status: null,
      },
      loadController: () => this.loadGitPanelController(),
      onControllerReady: (controller) => {
        controller.initialize();
        void controller.setMode(state.mode);
        controller.setSelection(state.selection);
        controller.setActive(state.active);
        if (state.active) {
          void controller.refresh({ force: true });
        }
      },
    });
    return proxy;
  },

  createLazyGitDiffViewController() {
    const state = {
      repoStatus: null,
    };
    let proxy;
    proxy = createLazyControllerProxy({
      createController: (GitDiffViewController) => new GitDiffViewController({
        gitApiClient: this.gitApiClient,
        onBackToHistory: ({ historyFilePath } = {}) => {
          if (historyFilePath) {
            this.navigation.navigateToGitFileHistory({ filePath: historyFilePath });
            return;
          }
          this.navigation.navigateToGitHistory();
        },
        onCommitStaged: () => this.openGitCommitDialog(),
        onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
        onStageFile: (filePath, { scope }) => this.stageGitFile(filePath, { scope }),
        onUnstageFile: (filePath, { scope }) => this.unstageGitFile(filePath, { scope }),
        toastController: this.toastController,
      }),
      fallback: {
        getToolbarTitle: ({ commitHash = null, filePath = null, path = null, scope = 'all', source = 'workspace' } = {}) => {
          if (source === 'commit') {
            if (path) return getVaultPathLeaf(path) || String(path ?? '') || 'File';
            return commitHash ? `Commit ${String(commitHash).slice(0, 7)}` : 'Commit Diff';
          }
          if (filePath) return getVaultPathLeaf(filePath) || String(filePath ?? '') || 'File';
          if (scope === 'staged') return 'Staged Changes';
          if (scope === 'working-tree') return 'Working Tree Changes';
          return 'All Changes';
        },
        hide: () => { },
        initialize: () => { },
        setRepoStatus: (status) => {
          state.repoStatus = status;
        },
      },
      loadController: () => this.loadGitDiffViewController(),
      onControllerReady: (controller) => {
        controller.initialize();
        controller.setRepoStatus(state.repoStatus);
      },
    });
    return proxy;
  },

  createLazyFileHistoryViewController() {
    let proxy;
    proxy = createLazyControllerProxy({
      createController: (FileHistoryViewController) => new FileHistoryViewController({
        diffRenderer: this.gitDiffView,
        gitApiClient: this.gitApiClient,
        onOpenCommitDiff: (hash, { historyFilePath, path }) => this.handleGitCommitSelection(hash, {
          closeSidebarOnMobile: false,
          historyFilePath,
          path,
        }),
        onOpenFile: (filePath) => filePath && this.navigation.navigateToFile(filePath),
        onOpenPreview: ({ hash, path, currentFilePath }) => this.handleGitFilePreviewSelection({
          hash,
          path,
          currentFilePath,
        }),
        onOpenWorkspaceDiff: (filePath) => this.handleGitDiffSelection(filePath, { closeSidebarOnMobile: false, scope: 'all' }),
        toastController: this.toastController,
      }),
      fallback: {
        hide: () => { },
        initialize: () => { },
      },
      loadController: () => this.loadFileHistoryViewController(),
      onControllerReady: (controller) => {
        controller.initialize();
      },
    });
    return proxy;
  },

  async ensureGitControllers() {
    await Promise.all([
      this.gitPanel.ensure(),
      this.gitDiffView.ensure(),
      this.fileHistoryView.ensure(),
    ]);
  },

  scheduleGitControllerPrewarm({ timeout = 2500 } = {}) {
    if (this.runtimeConfig.gitEnabled === false || this._gitControllerPrewarmHandle) {
      return;
    }

    const runPrewarm = () => {
      this._gitControllerPrewarmHandle = null;
      void this.gitPanel.ensure()
        .then((controller) => controller.refresh({ force: true }))
        .catch((error) => this.reportLazyControllerError('Git tools', error));
    };

    if (typeof window.requestIdleCallback === 'function') {
      this._gitControllerPrewarmHandle = window.requestIdleCallback(runPrewarm, { timeout });
      return;
    }

    this._gitControllerPrewarmHandle = window.setTimeout(runPrewarm, 0);
  },
};
