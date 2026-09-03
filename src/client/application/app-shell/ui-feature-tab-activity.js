import { isMarkdownFilePath } from '../../../domain/file-kind.js';

/**
 * @typedef {object} UiTabActivityContext
 * @property {boolean} isTabActive
 * @property {string | null} currentFilePath
 * @property {{ status: string, unreachable: boolean }} connectionState
 * @property {{ tabLockOverlay?: HTMLDialogElement | null, tabLockTitle?: HTMLElement | null, tabLockCopy?: HTMLElement | null }} elements
 * @property {{ connect(): void, disconnect(): void, provider?: unknown }} workspaceSync
 * @property {{ show(message: string): void }} toastController
 * @property {{ tryActivate(options?: { takeover?: boolean }): void }} tabActivityLock
 * @property {{ destroy?(): void, restoreOrCreate(input: { documentPath: string, displayName: string, kind: string }): Promise<object> }} governanceClient
 * @property {{ participantKind?: 'ai' | 'human' }} runtimeConfig
 * @property {(scope?: string) => UiTabActivityContext['tabActivityLock']} createTabActivityLock
 * @property {() => string} getStoredUserName
 * @property {{ refresh(): Promise<boolean> }} webMcpTools
 * @property {{ handleHashChange(options?: { forceGovernance?: boolean }): Promise<void> }} workspaceRouteController
 * @property {{ cleanupSession(): void }} workspaceCoordinator
 * @property {() => void} promptForDisplayNameIfNeeded
 * @property {() => void} renderGovernanceUi
 */

/** @this {UiTabActivityContext} */
async function initializeGovernanceTabActivity(documentPath, { force = false } = {}) {
  const hadTabActivityLock = Boolean(this.tabActivityLock);
  if (!this.tabActivityLock) {
    this.tabActivityLock = this.createTabActivityLock('');
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();
  }

  if (!isMarkdownFilePath(documentPath)) {
    this.governanceDocumentPath = null;
    this.governanceSnapshot = null;
    this.governanceClient.destroy?.();
    this.workspaceCoordinator?.cleanupSession?.();
    this.renderGovernanceUi?.();
    if (!hadTabActivityLock) {
      return null;
    }
    this.tabActivityLock.destroy();
    this.tabActivityLock = this.createTabActivityLock('');
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();
    return null;
  }

  if (!force && this.governanceDocumentPath === documentPath) {
    return this.governanceSnapshot;
  }

  this.governanceDocumentPath = documentPath;
  this.governanceLoad = {
    documentPath,
    error: null,
    phase: 'loading',
  };
  this.governanceSnapshot = null;
  this.workspaceCoordinator?.cleanupSession?.();
  this.renderGovernanceUi?.();

  try {
    const snapshot = await this.governanceClient.restoreOrCreate({
      displayName: this.getStoredUserName() || 'Guest',
      documentPath,
      kind: this.runtimeConfig?.participantKind ?? 'human',
    });
    if (this.governanceDocumentPath !== documentPath || !snapshot) {
      return null;
    }

    this.governanceSnapshot = snapshot;
    this.governanceLoad = {
      documentPath,
      error: null,
      phase: 'ready',
    };
    this.tabActivityLock.destroy();
    this.tabActivityLock = this.createTabActivityLock(snapshot.participantSessionId);
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();
    this.renderGovernanceUi?.();
    await this.applyGovernanceSnapshotTransition?.(null, snapshot);
    return snapshot;
  } catch (error) {
    if (this.governanceDocumentPath !== documentPath) {
      return null;
    }
    this.governanceClient.destroy?.();
    this.governanceSnapshot = null;
    this.governanceLoad = {
      documentPath,
      error,
      phase: 'error',
    };
    this.workspaceCoordinator?.cleanupSession?.();
    this.renderGovernanceUi?.();
    return null;
  }
}

/** @this {UiTabActivityContext} */
function handleTabTakeover() {
  this.tabActivityLock.tryActivate({ takeover: true });
}

/** @this {UiTabActivityContext} */
function handleTabActivated({ takeover = false } = {}) {
  const wasInactive = !this.isTabActive;
  this.isTabActive = true;
  this.hideTabLockOverlay();
  void this.webMcpTools?.refresh();

  if (!this.workspaceSync.provider) {
    this.workspaceSync.connect();
  }

  if (wasInactive) {
    void this.workspaceRouteController.handleHashChange({ forceGovernance: true });
    this.promptForDisplayNameIfNeeded();
  }

  if (takeover) {
    this.toastController.show('This tab is now active');
  }
}

/** @this {UiTabActivityContext} */
function handleTabBlocked({ reason } = {}) {
  const wasActive = this.isTabActive;
  this.isTabActive = false;
  void this.webMcpTools?.refresh();
  this.workspaceSync.disconnect();
  this.connectionState = { status: 'disconnected', unreachable: false };
  this.workspaceCoordinator?.cleanupSession?.();
  this.renderGovernanceUi?.();
  this.showTabLockOverlay({ reason });

  if (wasActive && reason === 'taken-over') {
    this.toastController.show('Another tab took over this session');
  }
}

/** @this {UiTabActivityContext} */
function showTabLockOverlay({ reason } = {}) {
  const overlay = this.elements.tabLockOverlay;
  const title = this.elements.tabLockTitle;
  const copy = this.elements.tabLockCopy;
  if (!overlay) {
    return;
  }

  document.dispatchEvent(new Event('collabmd:close-custom-modals'));
  document.querySelectorAll('dialog[open]').forEach((dialog) => {
    if (dialog !== overlay) {
      dialog.close();
    }
  });

  if (title) {
    title.textContent = reason === 'taken-over'
      ? 'This tab is no longer active'
      : 'This workspace is active in another tab';
  }
  if (copy) {
    copy.textContent = reason === 'taken-over'
      ? 'Another tab took over the live session. Take over here to reconnect this tab.'
      : 'Only one tab can keep this live session connected. Use the other tab, or take over here.';
  }

  if (!overlay.open) {
    this.tabLockPreviouslyFocusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    overlay.showModal();
  }
  this.elements.tabLockTakeoverButton?.focus();
}

/** @this {UiTabActivityContext} */
function hideTabLockOverlay() {
  if (this.elements.tabLockOverlay?.open) {
    this.elements.tabLockOverlay.close();
  }
  this.tabLockPreviouslyFocusedElement?.focus?.();
  this.tabLockPreviouslyFocusedElement = null;
}

export const uiFeatureTabActivityMethods = {
  handleTabActivated,
  handleTabBlocked,
  handleTabTakeover,
  hideTabLockOverlay,
  initializeGovernanceTabActivity,
  showTabLockOverlay,
};
