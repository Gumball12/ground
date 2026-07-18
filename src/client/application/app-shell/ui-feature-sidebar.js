/**
 * @typedef {object} UiSidebarContext
 * @property {string} activeSidebarTab
 * @property {{ sidebar?: HTMLElement | null, sidebarBackdrop?: HTMLElement | null, filesSidebarTab?: HTMLElement | null, commentsSidebarTab?: HTMLElement | null, gitSidebarTab?: HTMLElement | null, fileSearch?: HTMLElement | null, gitSearch?: HTMLElement | null, commentOverviewPanel?: HTMLElement | null }} elements
 * @property {{ setSidebarVisible(showSidebar: boolean): void, getSidebarVisible(): string | null | undefined }} preferences
 * @property {{ setActive(active: boolean): void }} gitPanel
 * @property {boolean} gitRepoAvailable
 * @property {() => boolean} isMobileViewport
 * @property {() => void} toggleSidebar
 * @property {(showSidebar: boolean) => void} applySidebarVisibility
 * @property {(showSidebar: boolean) => void} setSidebarVisibility
 */

/** @this {UiSidebarContext} */
function isMobileViewport() {
  return this.mobileBreakpointQuery.matches;
}

/** @this {UiSidebarContext} */
function closeSidebarOnMobile() {
  const sidebar = this.elements.sidebar;
  if (!sidebar || !this.isMobileViewport()) return;
  if (sidebar.classList.contains('collapsed')) return;

  this.setSidebarVisibility(false);
}

/** @this {UiSidebarContext} */
function toggleSidebar() {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;
  const isHidden = sidebar.classList.contains('collapsed');
  this.setSidebarVisibility(isHidden);
}

/** @this {UiSidebarContext} */
function restoreSidebarState() {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;

  const isMobile = this.isMobileViewport();
  const stored = this.preferences.getSidebarVisible();
  let showSidebar = true;
  if (stored === 'true') {
    showSidebar = true;
  } else if (stored === 'false') {
    showSidebar = false;
  } else if (isMobile) {
    showSidebar = false;
  }

  this.applySidebarVisibility(showSidebar);
}

/** @this {UiSidebarContext} */
function setSidebarVisibility(showSidebar) {
  this.applySidebarVisibility(showSidebar);
  this.preferences.setSidebarVisible(showSidebar);
}

/** @this {UiSidebarContext} */
function applySidebarVisibility(showSidebar) {
  const sidebar = this.elements.sidebar;
  if (!sidebar) return;

  const isMobile = this.isMobileViewport();
  const isCollapsed = !showSidebar;
  const hideForMobile = isCollapsed && isMobile;
  const showBackdrop = showSidebar && isMobile;

  sidebar.classList.toggle('collapsed', isCollapsed);
  sidebar.toggleAttribute('hidden', hideForMobile);
  sidebar.setAttribute('aria-hidden', isCollapsed ? 'true' : 'false');
  sidebar.inert = isCollapsed;

  const backdrop = this.elements.sidebarBackdrop;
  backdrop?.toggleAttribute('hidden', !showBackdrop);
  backdrop?.setAttribute('aria-hidden', showBackdrop ? 'false' : 'true');
  if (backdrop) {
    backdrop.inert = !showBackdrop;
  }
}

/** @this {UiSidebarContext} */
function setSidebarTab(tab) {
  const nextTab = tab === 'git' && this.gitRepoAvailable
    ? 'git'
    : tab === 'comments'
      ? 'comments'
      : 'files';
  this.activeSidebarTab = nextTab;

  this.elements.filesSidebarTab?.classList.toggle('active', nextTab === 'files');
  this.elements.commentsSidebarTab?.classList.toggle('active', nextTab === 'comments');
  this.elements.gitSidebarTab?.classList.toggle('active', nextTab === 'git');
  document.getElementById('fileTree')?.classList.toggle('hidden', nextTab !== 'files');
  this.elements.fileSearch?.classList.toggle('hidden', nextTab !== 'files');
  this.elements.commentOverviewPanel?.classList.toggle('hidden', nextTab !== 'comments');
  this.elements.gitSearch?.classList.toggle('hidden', nextTab !== 'git');
  document.getElementById('gitPanel')?.classList.toggle('active', nextTab === 'git');
  document.getElementById('gitPanel')?.classList.toggle('hidden', nextTab !== 'git');
  this.gitPanel.setActive(nextTab === 'git');
  if (nextTab === 'comments') {
    this.refreshCommentOverviewForSidebarOpen?.();
  }
}

export const uiFeatureSidebarMethods = {
  applySidebarVisibility,
  closeSidebarOnMobile,
  isMobileViewport,
  restoreSidebarState,
  setSidebarTab,
  setSidebarVisibility,
  toggleSidebar,
};
