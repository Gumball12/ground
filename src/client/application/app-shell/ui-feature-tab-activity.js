import { isMarkdownFilePath } from '../../../domain/file-kind.js';

/**
 * @typedef {object} UiTabActivityContext
 * @property {boolean} isTabActive
 * @property {string | null} currentFilePath
 * @property {Set<string>} chatMessageIds
 * @property {boolean} chatInitialSyncComplete
 * @property {number} chatUnreadCount
 * @property {Array<unknown>} chatMessages
 * @property {Array<unknown>} globalUsers
 * @property {string | null} followedUserClientId
 * @property {string} followedCursorSignature
 * @property {{ status: string, unreachable: boolean }} connectionState
 * @property {{ tabLockOverlay?: HTMLDialogElement | null, tabLockTitle?: HTMLElement | null, tabLockCopy?: HTMLElement | null }} elements
 * @property {{ connect(): void, disconnect(): void, provider?: unknown }} lobby
 * @property {{ connect(): void, disconnect(): void, provider?: unknown }} workspaceSync
 * @property {{ show(message: string): void }} toastController
 * @property {{ tryActivate(options?: { takeover?: boolean }): void }} tabActivityLock
 * @property {{ destroy?(): void, restoreOrCreate(input: { documentPath: string, displayName: string, kind: string }): Promise<{ participantSessionId: string }> }} governanceClient
 * @property {{ participantKind?: 'ai' | 'human' }} runtimeConfig
 * @property {(scope?: string) => UiTabActivityContext['tabActivityLock']} createTabActivityLock
 * @property {() => string} getStoredUserName
 * @property {{ refresh(): Promise<boolean> }} webMcpTools
 * @property {{ prepareFileDisconnect(filePath: string): Promise<void> }} excalidrawEmbed
 * @property {{ handleHashChange(): Promise<void> }} workspaceRouteController
 * @property {() => boolean} isExcalidrawFile
 * @property {() => void} promptForDisplayNameIfNeeded
 * @property {() => void} renderChat
 * @property {() => void} showEmptyState
 * @property {({ reason }: { reason?: string }) => void} showTabLockOverlay
 * @property {() => void} hideTabLockOverlay
 */

/** @this {UiTabActivityContext} */
async function initializeGovernanceTabActivity(documentPath = null) {
  const hadTabActivityLock = Boolean(this.tabActivityLock);
  if (!this.tabActivityLock) {
    this.tabActivityLock = this.createTabActivityLock('');
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();
  }

  if (!isMarkdownFilePath(documentPath)) {
    this.governanceDocumentPath = null;
    this.governanceClient.destroy?.();
    if (!hadTabActivityLock) {
      return;
    }
    this.tabActivityLock.destroy();
    this.tabActivityLock = this.createTabActivityLock('');
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();
    return;
  }

  if (this.governanceDocumentPath === documentPath) {
    return;
  }

  this.governanceDocumentPath = documentPath;
  try {
    const snapshot = await this.governanceClient.restoreOrCreate({
      displayName: this.getStoredUserName() || 'Guest',
      documentPath,
      kind: this.runtimeConfig?.participantKind ?? 'human',
    });
    if (this.governanceDocumentPath !== documentPath) {
      return;
    }

    if (!snapshot) {
      return;
    }

    this.tabActivityLock.destroy();
    this.tabActivityLock = this.createTabActivityLock(snapshot.participantSessionId);
    this.tabActivityLock.initialize();
    this.tabActivityLock.tryActivate();
  } catch {
    this.governanceDocumentPath = null;
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

  if (!this.lobby.provider) {
    this.lobby.connect();
  }
  if (!this.workspaceSync.provider) {
    this.workspaceSync.connect();
  }

  if (wasInactive) {
    if (this.fileExplorerReady) {
      void this.workspaceRouteController.handleHashChange();
    }
    this.promptForDisplayNameIfNeeded();
  }

  if (takeover) {
    this.toastController.show('This tab is now active');
  }
}

/** @this {UiTabActivityContext} */
async function handleTabBlocked({ reason } = {}) {
  const wasActive = this.isTabActive;
  const blockedFilePath = this.currentFilePath;
  const shouldPrepareExcalidrawDisconnect = Boolean(
    blockedFilePath
    && this.isExcalidrawFile?.(blockedFilePath),
  );

  this.isTabActive = false;
  void this.webMcpTools?.refresh();
  this.lobby.disconnect();
  this.workspaceSync.disconnect();
  this.globalUsers = [];
  this.chatMessages = [];
  this.chatMessageIds.clear();
  this.chatUnreadCount = 0;
  this.chatInitialSyncComplete = false;
  this.presencePanelOpen = false;
  this.followedUserClientId = null;
  this.followedCursorSignature = '';
  this.connectionState = { status: 'disconnected', unreachable: false };
  this.showTabLockOverlay({ reason });

  if (shouldPrepareExcalidrawDisconnect) {
    await this.excalidrawEmbed.prepareFileDisconnect(blockedFilePath);
  }

  this.showEmptyState();
  this.renderChat();

  if (wasActive && reason === 'taken-over') {
    this.toastController.show('Another tab took over this session');
  }
}

/** @this {UiTabActivityContext} */
function showTabLockOverlay({ reason } = {}) {
  const overlay = this.elements.tabLockOverlay;
  const title = this.elements.tabLockTitle;
  const copy = this.elements.tabLockCopy;
  if (!overlay) return;

  document.dispatchEvent(new Event('collabmd:close-custom-modals'));
  document.querySelectorAll('dialog[open]').forEach((dialog) => {
    if (dialog !== overlay) dialog.close();
  });

  if (title) {
    title.textContent = reason === 'taken-over'
      ? 'This tab is no longer active'
      : 'This vault is active in another tab';
  }

  if (copy) {
    copy.textContent = reason === 'taken-over'
      ? 'Another tab took over the live session. This tab is now disconnected until you explicitly take over here again.'
      : 'To avoid duplicate presence and chat, only one tab can stay connected at a time. Use the other tab, or take over the session here.';
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
  if (this.elements.tabLockOverlay?.open) this.elements.tabLockOverlay.close();
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
