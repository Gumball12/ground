import { isMarkdownFilePath } from '../../domain/file-kind.js';

export class WorkspaceRouteController {
  constructor({
    getIsDocumentIndexReady = () => true,
    getIsTabActive,
    hasIndexedDocument,
    navigation,
    onDocumentRequested,
    workspaceCoordinator,
  }) {
    this.getIsDocumentIndexReady = getIsDocumentIndexReady;
    this.getIsTabActive = getIsTabActive;
    this.hasIndexedDocument = hasIndexedDocument;
    this.navigation = navigation;
    this.onDocumentRequested = onDocumentRequested;
    this.workspaceCoordinator = workspaceCoordinator;
  }

  async handleHashChange({ forceGovernance = false } = {}) {
    if (!this.getIsTabActive()) {
      return false;
    }

    const route = this.navigation.getHashRoute();
    if (route.type !== 'file' || !isMarkdownFilePath(route.filePath)) {
      this.workspaceCoordinator.cleanupSession();
      await this.onDocumentRequested(null);
      return false;
    }

    if (!this.getIsDocumentIndexReady()) {
      return true;
    }

    if (!this.hasIndexedDocument(route.filePath)) {
      await this.workspaceCoordinator.openFile(route.filePath);
      return false;
    }
    const previousSession = this.workspaceCoordinator.getSession();
    await this.onDocumentRequested(route.filePath, { force: forceGovernance });
    const didOpen = await this.workspaceCoordinator.openFile(route.filePath);
    if (!didOpen) {
      return false;
    }
    if (previousSession === this.workspaceCoordinator.getSession()) {
      this.revealEditorMatch(route);
    }
    return true;
  }

  revealEditorMatch(route = {}, session = this.workspaceCoordinator.getSession()) {
    if (!Number.isFinite(route.line)) {
      return false;
    }
    return session?.revealSearchMatch?.({
      column: route.column,
      length: route.matchLength,
      line: route.line,
    }) ?? session?.scrollToLine?.(route.line, 0.2) ?? false;
  }
}
