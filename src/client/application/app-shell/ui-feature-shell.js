import { USER_NAME_MAX_LENGTH, normalizeUserName } from '../../domain/room.js';

/**
 * @typedef {object} UiShellContext
 * @property {boolean} isTabActive
 * @property {string | null} currentFilePath
 * @property {any} elements
 * @property {any} session
 * @property {any} themeController
 * @property {any} tabActivityLock
 * @property {any} toastController
 * @property {any} workspaceRouteController
 */

/** @this {UiShellContext} */
function initialize() {
  this.initializeVisualViewportBinding();
  this.themeController.initialize();
  this.scheduleEditorSessionPrewarm?.();
  this.bindEvents();

  window.addEventListener('hashchange', () => {
    void this.workspaceRouteController.handleHashChange();
  });

  this.tabActivityLock = this.createTabActivityLock('');
  this.tabActivityLock.initialize();
  this.tabActivityLock.tryActivate();
}

/** @this {UiShellContext} */
function bindEvents() {
  this.elements.skipToEditor?.addEventListener('click', (event) => this.focusEditor(event));
  this.elements.displayNameCancel?.addEventListener('click', () => {
    this.handleDisplayNameCancel();
  });
  this.elements.displayNameForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleDisplayNameSubmit();
  });
  this.elements.tabLockTakeoverButton?.addEventListener('click', () => {
    this.handleTabTakeover();
  });
}

/** @this {UiShellContext} */
function focusEditor(event) {
  event?.preventDefault?.();
  const container = this.elements.editorContainer;
  if (!container) {
    return;
  }

  const target = container.querySelector('.cm-content, [contenteditable="true"]') ?? container;
  if (target === container && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  target.focus();
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
  this.syncVisualViewportBounds();
  const viewport = window.visualViewport;
  if (!viewport) {
    return;
  }
  const handler = () => this.syncVisualViewportBounds();
  viewport.addEventListener('resize', handler, { passive: true });
  viewport.addEventListener('scroll', handler, { passive: true });
  window.addEventListener('orientationchange', handler);
}

/** @this {UiShellContext} */
function handleThemeChange(theme) {
  this.session?.applyTheme(theme);
}

/** @this {UiShellContext} */
function handleConnectionChange(state) {
  this.connectionState = state;
  void this.webMcpTools?.refresh();
  this.renderGovernanceUi?.();
  if (state?.unreachable && !this.connectionHelpShown) {
    this.connectionHelpShown = true;
    this.toastController.show(`Cannot reach server at ${state.wsBaseUrl}`, 6000);
  }
}

/** @this {UiShellContext} */
function getStoredLineWrapping() {
  return this.preferences.getLineWrappingEnabled();
}

/** @this {UiShellContext} */
function getStoredVimMode() {
  return this.preferences.getVimModeEnabled();
}

/** @this {UiShellContext} */
function clearInitialFileBootstrap() {
  document.documentElement.removeAttribute('data-initial-file-requested');
}

/** @this {UiShellContext} */
function isIdentityManagedByAuth() {
  return this.runtimeConfig?.auth?.strategy === 'oidc'
    && this.runtimeConfig?.auth?.provider === 'google';
}

/** @this {UiShellContext} */
function getStoredUserName() {
  return this.preferences.getUserName();
}

/** @this {UiShellContext} */
function openDisplayNameDialog({ mode = 'onboarding' } = {}) {
  if (!this.isTabActive || this.isIdentityManagedByAuth()) {
    return;
  }
  const dialog = this.elements.displayNameDialog;
  const input = this.elements.displayNameInput;
  if (!dialog || !input || dialog.open) {
    return;
  }
  this._displayNameDialogMode = mode;
  if (this.elements.displayNameTitle) {
    this.elements.displayNameTitle.textContent = 'Choose your display name';
  }
  if (this.elements.displayNameCopy) {
    this.elements.displayNameCopy.textContent = 'Pick a name collaborators will see. You can continue as a guest.';
  }
  if (this.elements.displayNameCancel) {
    this.elements.displayNameCancel.textContent = 'Skip for now';
  }
  if (this.elements.displayNameSubmit) {
    this.elements.displayNameSubmit.textContent = 'Continue';
  }
  input.value = '';
  dialog.showModal();
  requestAnimationFrame(() => input.focus());
}

/** @this {UiShellContext} */
function promptForDisplayNameIfNeeded() {
  if (this._hasPromptedForDisplayName || this.getStoredUserName() || this.isIdentityManagedByAuth()) {
    return;
  }
  this._hasPromptedForDisplayName = true;
  requestAnimationFrame(() => this.openDisplayNameDialog());
}

/** @this {UiShellContext} */
function handleDisplayNameCancel() {
  this.elements.displayNameDialog?.close();
}

/** @this {UiShellContext} */
function handleDisplayNameSubmit() {
  if (this.isIdentityManagedByAuth()) {
    return;
  }
  const input = this.elements.displayNameInput;
  if (!input) {
    return;
  }
  const normalizedName = this.session
    ? this.session.setUserName(input.value)
    : normalizeUserName(input.value);
  if (!normalizedName) {
    input.focus();
    this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
    return;
  }
  this.preferences.setUserName(normalizedName);
  this.localUser = {
    ...this.localUser,
    name: normalizedName,
  };
  this.elements.displayNameDialog?.close();
}

export const uiFeatureShellMethods = {
  bindEvents,
  clearInitialFileBootstrap,
  focusEditor,
  getStoredUserName,
  getStoredLineWrapping,
  getStoredVimMode,
  handleDisplayNameCancel,
  handleDisplayNameSubmit,
  handleConnectionChange,
  handleThemeChange,
  initialize,
  initializeVisualViewportBinding,
  isIdentityManagedByAuth,
  openDisplayNameDialog,
  promptForDisplayNameIfNeeded,
  syncVisualViewportBounds,
};
