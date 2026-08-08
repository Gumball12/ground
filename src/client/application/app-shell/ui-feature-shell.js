import { supportsBacklinksForFilePath } from '../../../domain/file-kind.js';
import { isPlainQuickSwitcherShortcut } from '../../domain/keyboard-shortcuts.js';
import { createFileRouteHash, isCollabMdHashRoute } from '../../domain/hash-routes.js';

const VERSION_RELOAD_TOAST_DURATION_MS = 0;
const PREVIEW_ROUTE_ANCHOR_STABILIZE_MS = 2000;
const PREVIEW_ROUTE_ANCHOR_MAX_APPLICATIONS = 8;
const PREVIEW_HEADING_LINK_ICON = `
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
    <path d="M10 13.5 14 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M9.35 7.55 10.6 6.3a4.2 4.2 0 0 1 5.95 5.95l-1.25 1.25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="m14.65 16.45-1.25 1.25a4.2 4.2 0 0 1-5.95-5.95L8.7 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`;

/**
 * @typedef {object} UiShellContext
 * @property {boolean} chatIsOpen
 * @property {boolean} gitRepoAvailable
 * @property {boolean} isTabActive
 * @property {boolean} presencePanelOpen
 * @property {string | null} currentFilePath
 * @property {number} lobbyChatMessageMaxLength
 * @property {any} runtimeConfig
 * @property {any} navigation
 * @property {any} session
 * @property {any} commentUi
 * @property {any} elements
 * @property {any} fileExplorer
 * @property {any} gitPanel
 * @property {any} gitDiffView
 * @property {any} fileHistoryView
 * @property {any} outlineController
 * @property {any} layoutController
 * @property {any} scrollSyncController
 * @property {any} themeController
 * @property {any} previewRenderer
 * @property {any} tabActivityLock
 * @property {any} notifications
 * @property {any} toastController
 * @property {any} versionMonitor
 */

/** @this {UiShellContext} */
function initialize() {
  this.initializeExportBridge?.();
  this.renderMarkdownToolbar?.();
  this.initializeVisualViewportBinding?.();
  this.themeController.initialize();
  this.previewRenderer.applyTheme(this.themeController.getTheme());
  this.previewRenderer.scheduleWorkerPrewarm();
  this.scheduleEditorSessionPrewarm?.();
  this.outlineController.initialize();
  this.layoutController.initialize();
  this.scrollSyncController.initialize();
  this.fileExplorer.initialize();
  this.commentsOverview?.initialize?.();
  this.initializePreviewLayoutObserver();
  this.syncIdentityManagementUi();
  this.syncCurrentUserName();
  this.syncWrapToggle();
  this.syncToolbarOverflowVisibility?.();
  this.syncFileHistoryButton({ mode: 'empty' });
  this.renderChat();
  this.elements.chatInput?.setAttribute('maxlength', String(this.lobbyChatMessageMaxLength));
  this.bindEvents();
  this.initializeSidebarResizer?.();
  this.restoreSidebarState();
  this.initializeVersionMonitoring();
  this.tabActivityLock.initialize();
  this.tabActivityLock.tryActivate();

  window.addEventListener('hashchange', () => this.handleHashChange());
  const handleResize = this.createResizeHandler();
  window.addEventListener('resize', () => {
    handleResize();
    this.syncToolbarOverflowVisibility?.();
  });

  this.fileExplorerReadyPromise = this.fileExplorer.refresh().then(() => {
    this.fileExplorerReady = true;
    void this.commentsOverview?.refresh?.();
    this.scheduleGitControllerPrewarm?.();
    if (this.isTabActive) {
      return this.handleHashChange();
    }
    return undefined;
  });
}

/** @this {UiShellContext} */
function initializeVersionMonitoring() {
  this.versionMonitor?.start();
}

/** @this {UiShellContext} */
function syncVisualViewportBounds() {
  const root = document.documentElement;
  const viewport = window.visualViewport;

  if (!root) {
    return;
  }

  if (!viewport) {
    root.style.setProperty('--app-viewport-height', '100dvh');
    root.style.setProperty('--app-viewport-offset-top', '0px');
    return;
  }

  root.style.setProperty('--app-viewport-height', `${Math.round(viewport.height)}px`);
  root.style.setProperty('--app-viewport-offset-top', `${Math.round(viewport.offsetTop)}px`);
}

/** @this {UiShellContext} */
function initializeVisualViewportBinding() {
  this.syncVisualViewportBounds?.();

  const viewport = window.visualViewport;
  if (!viewport) {
    return;
  }

  const handler = () => this.syncVisualViewportBounds?.();
  viewport.addEventListener('resize', handler, { passive: true });
  viewport.addEventListener('scroll', handler, { passive: true });
  window.addEventListener('orientationchange', handler);
}

/** @this {UiShellContext} */
function promptForVersionReload(payload = null) {
  if (this._reloadPromptShown) {
    return;
  }

  this._reloadPromptShown = true;
  const packageVersion = String(payload?.build?.packageVersion ?? this.runtimeConfig?.build?.packageVersion ?? '').trim();
  const message = packageVersion
    ? `Version ${packageVersion} is available. Reload to update.`
    : 'A new version is available. Reload to update.';

  this.toastController.show(message, {
    actionLabel: 'Reload',
    dismissible: true,
    duration: VERSION_RELOAD_TOAST_DURATION_MS,
    onAction: () => window.location.reload(),
  });
}

/** @this {UiShellContext} */
function bindToolbarEvents() {
  const openQuickSwitcher = () => {
    void this.toggleQuickSwitcher();
    this.closeToolbarOverflowMenu?.();
  };

  this.elements.shareButton?.addEventListener('click', () => {
    void this.copyCurrentLink();
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.toolbarSearchButton?.addEventListener('click', openQuickSwitcher);
  this.elements.searchFilesButton?.addEventListener('click', openQuickSwitcher);

  this.elements.exportDocxButton?.addEventListener('click', () => {
    void this.handleExportRequest?.('docx');
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.exportPdfButton?.addEventListener('click', () => {
    void this.handleExportRequest?.('pdf');
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.fileHistoryButton?.addEventListener('click', () => {
    const route = this.navigation.getHashRoute();
    if (route.type === 'git-file-preview') {
      this.handleGitFileHistorySelection(route.currentFilePath ?? route.filePath, { closeSidebarOnMobile: true });
      this.closeToolbarOverflowMenu?.();
      return;
    }

    this.handleGitFileHistorySelection(this.currentFilePath, { closeSidebarOnMobile: true });
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.editNameButton?.addEventListener('click', () => {
    this.openDisplayNameDialog();
    this.closeToolbarOverflowMenu?.();
  });
}

/** @this {UiShellContext} */
function bindDialogEvents() {
  this.elements.displayNameCancel?.addEventListener('click', () => {
    this.elements.displayNameDialog?.close();
  });

  this.elements.gitCommitCancel?.addEventListener('click', () => {
    this.elements.gitCommitDialog?.close();
  });

  this.elements.gitResetCancel?.addEventListener('click', () => {
    this.elements.gitResetDialog?.close();
  });

  this.elements.gitResetSubmit?.addEventListener('click', () => {
    void this.handleGitResetSubmit();
  });

  this.elements.gitCommitDialog?.addEventListener('close', () => {
    if (this.elements.gitCommitInput) {
      this.elements.gitCommitInput.value = '';
    }
    if (this.elements.gitCommitSubmit) {
      this.elements.gitCommitSubmit.textContent = 'Commit staged changes';
    }
  });

  this.elements.gitResetDialog?.addEventListener('close', () => {
    this.pendingGitResetPath = null;
    if (this.elements.gitResetFileName) {
      this.elements.gitResetFileName.value = '';
    }
    if (this.elements.gitResetSubmit) {
      this.elements.gitResetSubmit.textContent = 'Reset File';
    }
  });

  this.elements.displayNameForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleDisplayNameSubmit();
  });

  this.elements.gitCommitForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void this.handleGitCommitSubmit();
  });
}

/** @this {UiShellContext} */
function bindEvents() {
  this.elements.emptyStateNewFileBtn?.addEventListener('click', () => {
    this.fileExplorer.actionController.openRootCreateMenu({
      anchor: this.elements.emptyStateNewFileBtn,
    });
  });

  this.elements.emptyStateSearchBtn?.addEventListener('click', () => {
    void this.toggleQuickSwitcher();
  });

  this.elements.chatToggleButton?.addEventListener('click', () => {
    this.closePresencePanel?.();
    this.toggleChatPanel();
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.chatNotificationButton?.addEventListener('click', () => {
    void this.handleChatNotificationToggle();
  });

  this.elements.chatNotificationMuteButton?.addEventListener('click', () => {
    this.toggleChatNotificationMute();
  });

  this.elements.chatCloseButton?.addEventListener('click', () => {
    this.closeChatPanel({ restoreFocus: true });
  });

  this.elements.chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleChatSubmit();
  });

  bindToolbarEvents.call(this);
  bindDialogEvents.call(this);

  this.elements.markdownToolbar?.addEventListener('click', (event) => {
    this.handleMarkdownToolbarClick?.(event);
  });

  this.elements.markdownToolbar?.addEventListener('keydown', (event) => {
    this.handleMarkdownToolbarKeydown?.(event);
  });

  this.elements.tabLockTakeoverButton?.addEventListener('click', () => {
    this.handleTabTakeover();
  });

  this.elements.toggleWrapButton?.addEventListener('click', () => {
    this.toggleLineWrapping();
  });

  this.elements.userCount?.addEventListener('click', (event) => {
    event.preventDefault();
    this.togglePresencePanel?.();
  });

  this.elements.editorFindButton?.addEventListener('click', () => {
    this.runEditorCommand?.('openSearch');
  });

  this.elements.toolbarOverflowToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    this.closePresencePanel?.();
    this.toggleToolbarOverflowMenu();
  });

  this.elements.toolbarOverflowMenu?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) {
      this.closeToolbarOverflowMenu();
    }
  });

  this.elements.previewContent?.addEventListener('click', (event) => {
    this.handlePreviewContentClick?.(event);
  });

  this.elements.sidebarToggle?.addEventListener('click', () => {
    this.closeToolbarOverflowMenu();
    this.toggleSidebar();
  });

  this.elements.sidebarClose?.addEventListener('click', () => {
    this.closeSidebarOnMobile();
  });

  this.elements.sidebarBackdrop?.addEventListener('click', () => {
    this.closeSidebarOnMobile();
  });

  this.elements.filesSidebarTab?.addEventListener('click', () => {
    this.setSidebarTab('files');
  });

  this.elements.gitSidebarTab?.addEventListener('click', () => {
    if (!this.gitRepoAvailable) {
      return;
    }
    this.setSidebarTab('git');
  });

  this.elements.commentsSidebarTab?.addEventListener('click', () => {
    this.setSidebarTab('comments');
  });

  document.addEventListener('pointerdown', (event) => {
    this.handleDocumentPointerDown(event);
  });

  document.addEventListener('keydown', (event) => {
    this.handleDocumentKeydown(event);
  }, { capture: true });
}

/** @this {UiShellContext} */
function handleDocumentPointerDown(event) {
  this.handleMarkdownToolbarDocumentPointerDown?.(event);

  const target = event.target instanceof Element ? event.target : null;

  if (
    this.toolbarOverflowOpen
    && !this.elements.toolbarOverflowMenu?.contains(target)
    && !this.elements.toolbarOverflowToggle?.contains(target)
  ) {
    this.closeToolbarOverflowMenu();
  }

  if (
    this.presencePanelOpen
    && !this.elements.presencePanel?.contains(target)
    && !target?.closest?.('[data-presence-panel-trigger="true"]')
  ) {
    this.closePresencePanel?.();
  }

  if (!this.chatIsOpen) {
    return;
  }

  if (this.elements.chatContainer?.contains(target)) {
    return;
  }

  this.closeChatPanel({ restoreFocus: false });
}

/** @this {UiShellContext} */
function handleDocumentKeydown(event) {
  if (event.key === 'Escape' && this.toolbarOverflowOpen) {
    this.closeToolbarOverflowMenu();
    return;
  }

  if (event.key === 'Escape' && this.presencePanelOpen) {
    this.closePresencePanel?.();
    return;
  }

  if (event.key === 'Escape' && this.chatIsOpen) {
    this.closeChatPanel({ restoreFocus: true });
    return;
  }

  if (isPlainQuickSwitcherShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
    void this.toggleQuickSwitcher();
  }
}

function isNestedTaskListClickTarget(target, taskItem) {
  const nestedList = target.closest('ul, ol');
  return nestedList instanceof Element && nestedList.parentElement === taskItem;
}

function isInteractiveTaskListDescendant(target) {
  const taskCheckbox = target.closest('input[data-task-checkbox="true"]');
  if (taskCheckbox) {
    return false;
  }

  return Boolean(target.closest('a, button, input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"]'));
}

function hasTaskListTextSelection(taskItem) {
  const selection = window.getSelection();
  return Boolean(
    !selection?.isCollapsed
    && taskItem.contains(selection.anchorNode)
    && taskItem.contains(selection.focusNode)
  );
}

function normalizeFragmentTargetId(rawTarget = '') {
  const normalizedTarget = String(rawTarget ?? '').trim();
  if (!normalizedTarget) {
    return '';
  }

  try {
    return decodeURIComponent(normalizedTarget);
  } catch {
    return normalizedTarget;
  }
}

function scrollPreviewToTarget(previewContainer, target, { behavior = 'smooth' } = {}) {
  if (!previewContainer || !target) {
    return;
  }

  const previewRect = previewContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextScrollTop = previewContainer.scrollTop + (targetRect.top - previewRect.top);
  previewContainer.scrollTo({
    behavior,
    top: Math.max(nextScrollTop, 0),
  });
}

async function copyTextToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

function getHeadingLinkLabel(heading) {
  if (!(heading instanceof HTMLElement)) {
    return '';
  }

  const headingClone = heading.cloneNode(true);
  if (!(headingClone instanceof HTMLElement)) {
    return heading.textContent.trim();
  }

  headingClone.querySelectorAll('.preview-heading-link-button').forEach((button) => button.remove());
  return headingClone.textContent.replace(/\s+/g, ' ').trim();
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/** @this {UiShellContext} */
function navigatePreviewHeading(target, headingId, { behavior = 'auto' } = {}) {
  if (!(target instanceof HTMLElement) || !headingId) {
    return false;
  }

  const handledByOutlineNavigation = this.outlineController?.navigateToHeading?.(target, headingId, { behavior });
  if (handledByOutlineNavigation) {
    return true;
  }

  const previewContainer = this.elements.previewContainer ?? document.getElementById('previewContainer');
  if (!previewContainer) {
    return false;
  }

  this.scrollSyncController?.suspendSync?.(250);
  scrollPreviewToTarget(previewContainer, target, { behavior });

  const sourceLine = Number.parseInt(target.getAttribute('data-source-line') || '', 10);
  if (Number.isFinite(sourceLine)) {
    this.session?.scrollToLine?.(sourceLine, 0);
  }

  return true;
}

/** @this {UiShellContext} */
function createPreviewHeadingLinkUrl(anchorId) {
  if (!this.currentFilePath || !anchorId) {
    return '';
  }

  const url = new URL(window.location.href);
  url.hash = createFileRouteHash(this.currentFilePath, {
    anchor: anchorId,
    drawioMode: this.currentDrawioMode ?? null,
  });
  return url.toString();
}

/** @this {UiShellContext} */
async function copyPreviewHeadingLink(anchorId) {
  const url = this.createPreviewHeadingLinkUrl(anchorId);
  if (!url) {
    this.toastController.show('Failed to copy section link');
    return;
  }

  try {
    await copyTextToClipboard(url);
    this.toastController.show('Section link copied');
  } catch {
    this.toastController.show('Failed to copy section link');
  }
}

/** @this {UiShellContext} */
function syncPreviewHeadingLinkButtons() {
  const headings = this.elements.previewContent?.querySelectorAll?.('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]') ?? [];

  Array.from(headings).forEach((heading) => {
    if (!(heading instanceof HTMLElement) || !heading.id) {
      return;
    }

    const headingLabel = getHeadingLinkLabel(heading);
    let button = heading.querySelector(':scope > .preview-heading-link-button');
    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-icon-button preview-heading-link-button';
      button.innerHTML = PREVIEW_HEADING_LINK_ICON;
      heading.appendChild(button);
    }

    button.dataset.previewHeadingAnchor = heading.id;
    button.setAttribute('aria-label', `Copy link to ${headingLabel}`);
    button.setAttribute('title', 'Copy link to this section');
  });
}

/** @this {UiShellContext} */
function requestPreviewRouteAnchor(anchorId, filePath = this.currentFilePath) {
  const normalizedAnchor = String(anchorId ?? '').trim();
  this._pendingPreviewRouteAnchor = normalizedAnchor
    ? {
      applied: false,
      appliedCount: 0,
      anchorId: normalizedAnchor,
      filePath: filePath ?? this.currentFilePath ?? null,
      stabilizeUntil: nowMs() + PREVIEW_ROUTE_ANCHOR_STABILIZE_MS,
    }
    : null;

  if (!this._pendingPreviewRouteAnchor) {
    return false;
  }

  return this.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: false });
}

/** @this {UiShellContext} */
function applyPendingPreviewRouteAnchor({ allowExpired = false, behavior = 'auto', clearMissing = false } = {}) {
  const pendingAnchor = this._pendingPreviewRouteAnchor;
  if (!pendingAnchor) {
    return false;
  }

  if (!allowExpired && pendingAnchor.applied && pendingAnchor.stabilizeUntil <= nowMs()) {
    this._pendingPreviewRouteAnchor = null;
    return false;
  }

  if (pendingAnchor.filePath && this.currentFilePath && pendingAnchor.filePath !== this.currentFilePath) {
    return false;
  }

  const target = document.getElementById(pendingAnchor.anchorId);
  if (!(target instanceof HTMLElement) || !this.elements.previewContent?.contains(target)) {
    if (!pendingAnchor.applied && clearMissing && pendingAnchor.filePath && pendingAnchor.filePath === this.currentFilePath) {
      this._pendingPreviewRouteAnchor = null;
    }
    return false;
  }

  if (!this.navigatePreviewHeading(target, pendingAnchor.anchorId, { behavior })) {
    return false;
  }

  pendingAnchor.applied = true;
  pendingAnchor.appliedCount = (pendingAnchor.appliedCount ?? 0) + 1;
  pendingAnchor.stabilizeUntil = nowMs() + PREVIEW_ROUTE_ANCHOR_STABILIZE_MS;
  if (pendingAnchor.appliedCount >= PREVIEW_ROUTE_ANCHOR_MAX_APPLICATIONS) {
    this._pendingPreviewRouteAnchor = null;
  }
  return true;
}

/** @this {UiShellContext} */
function handlePreviewContentClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const headingLinkButton = event.target.closest('button.preview-heading-link-button[data-preview-heading-anchor]');
  if (headingLinkButton instanceof HTMLButtonElement) {
    event.preventDefault();
    void this.copyPreviewHeadingLink(headingLinkButton.dataset.previewHeadingAnchor || '');
    return;
  }

  const wikiLink = event.target.closest('a.wiki-link[data-wiki-target]');
  if (wikiLink) {
    event.preventDefault();
    this.handleWikiLinkClick(wikiLink.dataset.wikiTarget);
    return;
  }

  const anchorLink = event.target.closest('a[href]');
  const href = anchorLink?.getAttribute('href')?.trim() || '';
  if (anchorLink && href.startsWith('#') && !isCollabMdHashRoute(href)) {
    event.preventDefault();

    if (href === '#' || href.toLowerCase() === '#top') {
      this.scrollSyncController?.suspendSync?.(250);
      const previewContainer = this.elements.previewContainer ?? document.getElementById('previewContainer');
      previewContainer?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const targetId = normalizeFragmentTargetId(href.slice(1));
    if (!targetId) {
      return;
    }

    const target = document.getElementById(targetId);
    if (!target || !this.elements.previewContent?.contains(target)) {
      return;
    }

    this.navigatePreviewHeading(target, targetId, { behavior: 'smooth' });
    return;
  }

  const taskItem = event.target.closest('.task-list-item[data-source-line]');
  if (!taskItem || isNestedTaskListClickTarget(event.target, taskItem) || isInteractiveTaskListDescendant(event.target)) {
    return;
  }

  if (hasTaskListTextSelection(taskItem)) {
    return;
  }

  event.preventDefault();

  const sourceLine = Number.parseInt(taskItem.getAttribute('data-source-line') || '', 10);
  if (!Number.isFinite(sourceLine)) {
    return;
  }

  this.session?.toggleTaskListItem?.(sourceLine);
}

/** @this {UiShellContext} */
function setToolbarOverflowOpen(nextState) {
  this.toolbarOverflowOpen = Boolean(nextState);
  this.elements.toolbarOverflowToggle?.setAttribute('aria-expanded', String(this.toolbarOverflowOpen));
  this.elements.toolbarOverflowToggle?.classList.toggle('active', this.toolbarOverflowOpen);
  this.elements.toolbarOverflowToggle?.closest('.toolbar-right')?.classList.toggle('is-overflow-open', this.toolbarOverflowOpen);

  if (!this.toolbarOverflowOpen) {
    this.elements.toolbarOverflowMenu?.querySelectorAll('details[open]').forEach((detail) => {
      detail.removeAttribute('open');
    });
  }
}

/** @this {UiShellContext} */
function syncToolbarOverflowVisibility() {
  const toggle = this.elements.toolbarOverflowToggle;
  if (!toggle) {
    return;
  }

  toggle.classList.remove('hidden');
  toggle.hidden = false;
  toggle.setAttribute('aria-hidden', 'false');
}

/** @this {UiShellContext} */
function closeToolbarOverflowMenu() {
  this.setToolbarOverflowOpen(false);
}

/** @this {UiShellContext} */
function toggleToolbarOverflowMenu() {
  this.setToolbarOverflowOpen(!this.toolbarOverflowOpen);
}

/** @this {UiShellContext} */
function handleThemeChange(theme) {
  this.previewRenderer.applyTheme(theme);
  if (!this.isExcalidrawFile(this.currentFilePath) && !this.isImageFile?.(this.currentFilePath)) {
    this.previewRenderer.queueRender();
  }
  this.session?.applyTheme(theme);
  this.excalidrawEmbed.updateTheme(theme);
  this.drawioEmbed.updateTheme(theme);
}

/** @this {UiShellContext} */
function handleConnectionChange(state) {
  this.connectionState = state;
  if (state?.firstConnection) {
    this.recordFileOpenMetric?.('ws_connected', {
      status: state.status,
    });
  }
  this.renderPresence();
  this.renderChat({ messagesChanged: false });

  if (state.unreachable && !this.connectionHelpShown) {
    this.connectionHelpShown = true;
    this.toastController.show(`Cannot reach server at ${state.wsBaseUrl}`, 6000);
  }
}

/** @this {UiShellContext} */
function toggleLineWrapping() {
  const currentState = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
  const nextState = !currentState;

  this.session?.setLineWrapping(nextState);
  this.preferences.setLineWrappingEnabled(nextState);
  this.syncWrapToggle(nextState);
  this.session?.requestMeasure();
  this.scrollSyncController.syncPreviewToEditor();
}

/** @this {UiShellContext} */
function getStoredLineWrapping() {
  return this.preferences.getLineWrappingEnabled();
}

/** @this {UiShellContext} */
function syncWrapToggle(state) {
  const enabled = state ?? this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
  const label = this.elements.wrapToggleLabel;
  const button = this.elements.toggleWrapButton;
  const nextLabel = enabled ? 'Wrap on' : 'Wrap off';
  if (label) label.textContent = nextLabel;
  if (button) {
    button.setAttribute('aria-label', `${nextLabel}. ${enabled ? 'Disable line wrap' : 'Enable line wrap'}`);
  }
}

/** @this {UiShellContext} */
function scheduleBacklinkRefresh() {
  clearTimeout(this._backlinkRefreshTimer);
  this._backlinkRefreshTimer = setTimeout(() => {
    if (supportsBacklinksForFilePath(this.currentFilePath)) {
      this.backlinksPanel.load(this.currentFilePath);
    }
  }, 2000);
}

/** @this {UiShellContext} */
function showEditorLoading() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.add('is-loading-editor');
  this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading file...</span>
      </div>`;
}

/** @this {UiShellContext} */
function hideEditorLoading() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.remove('is-loading-editor');
  this.elements.editorContainer.querySelector('#editorLoading')?.remove();
}

/** @this {UiShellContext} */
function showEditorLoadError() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.remove('is-loading-editor');
  this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <span class="loading-text">Failed to load file</span>
      </div>`;
}

/** @this {UiShellContext} */
function clearInitialFileBootstrap() {
  document.documentElement.removeAttribute('data-initial-file-requested');
}

export const uiFeatureShellMethods = {
  applyPendingPreviewRouteAnchor,
  bindEvents,
  clearInitialFileBootstrap,
  closeToolbarOverflowMenu,
  copyPreviewHeadingLink,
  createPreviewHeadingLinkUrl,
  getStoredLineWrapping,
  handleConnectionChange,
  handleDocumentKeydown,
  handleDocumentPointerDown,
  handlePreviewContentClick,
  handleThemeChange,
  hideEditorLoading,
  initialize,
  initializeVisualViewportBinding,
  initializeVersionMonitoring,
  isPlainQuickSwitcherShortcut,
  navigatePreviewHeading,
  promptForVersionReload,
  requestPreviewRouteAnchor,
  scheduleBacklinkRefresh,
  setToolbarOverflowOpen,
  showEditorLoadError,
  showEditorLoading,
  syncPreviewHeadingLinkButtons,
  syncVisualViewportBounds,
  syncToolbarOverflowVisibility,
  syncWrapToggle,
  toggleToolbarOverflowMenu,
  toggleLineWrapping,
};
