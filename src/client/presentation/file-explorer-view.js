import {
  getVaultTreeNodeType,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';
import { escapeHtml } from '../domain/vault-utils.js';
import { getVaultPathLeaf, getVaultPathParent } from '../domain/vault-paths.js';
import { buttonClassNames } from './components/ui/button.js';

function findNodeByPath(nodes = [], pathValue = '') {
  for (const node of nodes) {
    if (node.path === pathValue) {
      return node;
    }

    if (node.type === 'directory' && Array.isArray(node.children)) {
      const nested = findNodeByPath(node.children, pathValue);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

const MOBILE_LONG_PRESS_DELAY_MS = 420;
const MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const DRAG_AUTO_EXPAND_DELAY_MS = 700;

export class FileExplorerView {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onEntryDrop,
    onDirectorySelect,
    onDirectoryToggle,
    onFileContextMenu,
    onFileSelect,
    onSearchChange,
    onTreeContextMenu,
    onValidateDrop,
  }) {
    this.onEntryDrop = onEntryDrop;
    this.onDirectorySelect = onDirectorySelect;
    this.onDirectoryToggle = onDirectoryToggle;
    this.onFileContextMenu = onFileContextMenu;
    this.onFileSelect = onFileSelect;
    this.onSearchChange = onSearchChange;
    this.onTreeContextMenu = onTreeContextMenu;
    this.onValidateDrop = onValidateDrop;
    this.mobileBreakpointQuery = mobileBreakpointQuery;
    this.treeContainer = document.getElementById('fileTree');
    this.searchInput = document.getElementById('fileSearchInput');
    this.renderedDirectoryWrappers = new Map();
    this.renderedChildContainers = new Map();
    this.lastRenderMode = 'tree';
    this.longPressTimer = 0;
    this.longPressContext = null;
    this.suppressedActivationTarget = null;
    this.contextMenuCloseHandler = null;
    this.actionSheetCloseHandler = null;
    this.dragSource = null;
    this.currentSearchQuery = '';
    this.activeDropTarget = null;
    this.invalidDropAttempt = null;
    this.autoExpandTimer = 0;
    this.autoExpandTargetPath = '';
    this.rootDropZone = null;
    this.threadCounts = new Map();
    this.showFileExtensions = false;
  }

  initialize() {
    this.searchInput?.addEventListener('input', (event) => {
      this.onSearchChange?.(event.target.value);
    });

    this.treeContainer?.addEventListener('contextmenu', (event) => {
      if (event.target.closest('.file-tree-item')) {
        return;
      }

      event.preventDefault();
      this.onTreeContextMenu?.(event);
    });

    this.treeContainer?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.file-tree-item')) {
        return;
      }

      this.startLongPress(event, () => {
        this.onTreeContextMenu?.({
          clientX: Number(event.clientX || 0),
          clientY: Number(event.clientY || 0),
          preventDefault() {},
          target: this.treeContainer,
        });
      }, this.treeContainer);
    });
    this.treeContainer?.addEventListener('pointermove', (event) => {
      this.handleLongPressPointerMove(event);
    }, { passive: true });
    this.treeContainer?.addEventListener('pointerup', () => {
      this.cancelLongPress();
    });
    this.treeContainer?.addEventListener('pointercancel', () => {
      this.cancelLongPress();
    });
    this.treeContainer?.addEventListener('scroll', () => {
      this.cancelLongPress();
    }, { passive: true });
    this.treeContainer?.addEventListener('dragover', (event) => {
      this.handleTreeDragOver(event);
    });
    this.treeContainer?.addEventListener('drop', (event) => {
      this.handleTreeDrop(event);
    });
    this.treeContainer?.addEventListener('dragleave', (event) => {
      this.handleTreeDragLeave(event);
    });
  }

  revealFile(filePath) {
    const fileItem = Array.from(this.treeContainer?.querySelectorAll('.file-tree-file') ?? [])
      .find((element) => element.dataset.path === filePath);
    fileItem?.scrollIntoView({ block: 'nearest' });
  }

  render({ activeFilePath, changedPaths = null, expandedDirs, reset = false, searchMatches, searchQuery, showFileExtensions = false, threadCounts = new Map(), tree }) {
    if (!this.treeContainer) {
      return;
    }

    this.threadCounts = threadCounts instanceof Map ? threadCounts : new Map();
    this.showFileExtensions = Boolean(showFileExtensions);
    this.currentSearchQuery = String(searchQuery ?? '');
    if (this.currentSearchQuery) {
      this.clearDragFeedback();
    }

    if (this.searchInput && this.searchInput.value !== searchQuery) {
      this.searchInput.value = searchQuery;
    }

    if (searchQuery) {
      this.lastRenderMode = 'search';
      this.renderSearchResults(searchMatches, activeFilePath);
      return;
    }

    if (
      reset
      || this.lastRenderMode !== 'tree'
      || !Array.isArray(changedPaths)
      || changedPaths.length === 0
    ) {
      this.renderFullTree(tree, {
        activeFilePath,
        expandedDirs,
      });
      this.lastRenderMode = 'tree';
      return;
    }

    const affectedParentPaths = Array.from(new Set(
      changedPaths.map((pathValue) => getVaultPathParent(pathValue)),
    ))
      .sort((left, right) => left.split('/').length - right.split('/').length)
      .filter((pathValue, index, values) => (
        !values.slice(0, index).some((ancestorPath) => ancestorPath && pathValue.startsWith(`${ancestorPath}/`))
      ));
    if (affectedParentPaths.includes('')) {
      this.renderFullTree(tree, {
        activeFilePath,
        expandedDirs,
      });
      this.lastRenderMode = 'tree';
      return;
    }

    for (const parentPath of affectedParentPaths) {
      if (!this.rerenderDirectoryBranch(parentPath, tree, {
        activeFilePath,
        expandedDirs,
      })) {
        this.renderFullTree(tree, {
          activeFilePath,
          expandedDirs,
        });
        this.lastRenderMode = 'tree';
        return;
      }
    }

    this.lastRenderMode = 'tree';
  }

  renderSearchResults(matches, activeFilePath) {
    if (!this.treeContainer) {
      return;
    }

    this.resetTreeIndexes();
    this.treeContainer.innerHTML = '';
    this.rootDropZone = null;

    if (matches.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No matches</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const match of matches) {
      if (match.type === 'directory') {
        fragment.appendChild(this.createSearchDirectoryItem(match));
        continue;
      }

      fragment.appendChild(this.createFileItem({
        activeFilePath,
        depth: 0,
        filePath: match.path,
        fileType: match.type || (getVaultTreeNodeType(match.path) ?? 'file'),
        name: match.name || getVaultPathLeaf(match.path),
      }));
    }
    this.treeContainer.appendChild(fragment);
  }

  renderFullTree(tree, { activeFilePath, expandedDirs }) {
    this.resetTreeIndexes();
    this.treeContainer.innerHTML = '';
    this.rootDropZone = null;

    if (tree.length === 0) {
      this.treeContainer.innerHTML = '<div class="file-tree-empty">No vault files found</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.createRootDropZone());
    this.renderNodes(tree, fragment, {
      activeFilePath,
      depth: 0,
      expandedDirs,
    });
    this.treeContainer.appendChild(fragment);
  }

  resetTreeIndexes() {
    this.renderedDirectoryWrappers.clear();
    this.renderedChildContainers.clear();
  }

  renderNodes(nodes, container, { activeFilePath, depth, expandedDirs }) {
    for (const node of nodes) {
      if (node.type === 'directory') {
        container.appendChild(this.createDirectoryItem(node, {
          activeFilePath,
          depth,
          expandedDirs,
        }));
        continue;
      }

      container.appendChild(this.createFileItem({
        activeFilePath,
        depth,
        filePath: node.path,
        fileType: node.type,
        name: node.name,
      }));
    }
  }

  createDirectoryItem(node, { activeFilePath, depth, expandedDirs }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-tree-group';

    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-dir';
    button.style.setProperty('--depth', depth);
    button.dataset.depth = depth;

    const isExpanded = expandedDirs.has(node.path);
    button.setAttribute('aria-expanded', String(isExpanded));
    button.dataset.path = node.path;
    button.dataset.entryType = 'directory';
    button.innerHTML = `
      <svg class="file-tree-chevron${isExpanded ? ' expanded' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="file-tree-name">${escapeHtml(node.name)}</span>
    `;
    this.configureDragSource(button, { path: node.path, type: 'directory' });
    this.bindDirectoryDropTarget(button, node.path);

    button.addEventListener('click', (event) => {
      if (this.consumeSuppressedActivation(button, event)) {
        return;
      }
      this.onDirectoryToggle?.(node.path);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onFileContextMenu?.(event, { directoryPath: node.path, type: 'directory' });
    });
    this.bindLongPress(button, () => {
      this.onFileContextMenu?.(this.createLongPressEvent(button), { directoryPath: node.path, type: 'directory' });
    });

    wrapper.appendChild(button);
    this.renderedDirectoryWrappers.set(node.path, wrapper);

    if (isExpanded && Array.isArray(node.children)) {
      const childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      this.renderedChildContainers.set(node.path, childContainer);
      this.renderNodes(node.children, childContainer, {
        activeFilePath,
        depth: depth + 1,
        expandedDirs,
      });
      wrapper.appendChild(childContainer);
    } else {
      this.renderedChildContainers.delete(node.path);
    }

    return wrapper;
  }

  createSearchDirectoryItem(node) {
    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-dir';
    button.style.setProperty('--depth', 0);
    button.dataset.depth = 0;
    button.dataset.path = node.path;
    button.dataset.entryType = 'directory';
    button.innerHTML = `
      <svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="file-tree-name">${escapeHtml(node.name || getVaultPathLeaf(node.path))}</span>
    `;

    button.addEventListener('click', (event) => {
      if (this.consumeSuppressedActivation(button, event)) {
        return;
      }
      this.onDirectorySelect?.(node.path);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onFileContextMenu?.(event, { directoryPath: node.path, type: 'directory' });
    });
    this.bindLongPress(button, () => {
      this.onFileContextMenu?.(this.createLongPressEvent(button), { directoryPath: node.path, type: 'directory' });
    });

    return button;
  }

  rerenderDirectoryBranch(parentPath, tree, { activeFilePath, expandedDirs }) {
    const wrapper = this.renderedDirectoryWrappers.get(parentPath);
    const parentNode = findNodeByPath(tree, parentPath);
    if (!wrapper || parentNode?.type !== 'directory') {
      return false;
    }

    const button = wrapper.querySelector('.file-tree-dir');
    const isExpanded = expandedDirs.has(parentPath);
    button?.setAttribute('aria-expanded', String(isExpanded));
    button?.querySelector('.file-tree-chevron')?.classList.toggle('expanded', isExpanded);

    const depth = Number(button?.dataset.depth ?? 0);
    let childContainer = this.renderedChildContainers.get(parentPath) ?? wrapper.querySelector('.file-tree-children');

    this.clearRenderedDescendants(parentPath);

    if (!isExpanded) {
      childContainer?.remove();
      this.renderedChildContainers.delete(parentPath);
      return true;
    }

    if (!childContainer) {
      childContainer = document.createElement('div');
      childContainer.className = 'file-tree-children';
      wrapper.appendChild(childContainer);
    } else {
      childContainer.innerHTML = '';
    }
    this.renderedChildContainers.set(parentPath, childContainer);

    this.renderNodes(parentNode.children ?? [], childContainer, {
      activeFilePath,
      depth: depth + 1,
      expandedDirs,
    });

    return true;
  }

  clearRenderedDescendants(parentPath) {
    const prefix = `${parentPath}/`;
    Array.from(this.renderedDirectoryWrappers.keys()).forEach((pathValue) => {
      if (pathValue.startsWith(prefix)) {
        this.renderedDirectoryWrappers.delete(pathValue);
      }
    });
    Array.from(this.renderedChildContainers.keys()).forEach((pathValue) => {
      if (pathValue.startsWith(prefix)) {
        this.renderedChildContainers.delete(pathValue);
      }
    });
  }

  createFileItem({ activeFilePath, depth, filePath, fileType = 'file', name }) {
    const button = document.createElement('button');
    button.className = 'file-tree-item file-tree-file';
    const threadCount = Number(this.threadCounts.get(filePath) ?? 0);
    const isDrawio = fileType === 'drawio';
    const isExcalidraw = fileType === 'excalidraw';
    const isBase = fileType === 'base';
    const isImage = fileType === 'image';
    const isMermaid = fileType === 'mermaid';
    const isPlantUml = fileType === 'plantuml';

    if (isBase) {
      button.classList.add('is-base');
    }
    if (isDrawio) {
      button.classList.add('is-drawio');
    }
    if (isExcalidraw) {
      button.classList.add('is-excalidraw');
    }
    if (isImage) {
      button.classList.add('is-image');
    }
    if (isMermaid) {
      button.classList.add('is-mermaid');
    }
    if (isPlantUml) {
      button.classList.add('is-plantuml');
    }
    if (filePath === activeFilePath) {
      button.classList.add('active');
    }
    if (threadCount > 0) {
      button.classList.add('has-comments');
    }

    button.style.setProperty('--depth', depth);
    button.dataset.depth = depth;
    button.dataset.path = filePath;
    button.dataset.entryType = 'file';
    if (threadCount > 0) {
      button.dataset.threadCount = String(threadCount);
    }
    const displayName = this.showFileExtensions ? String(name ?? '') : stripVaultFileExtension(name);
    button.innerHTML = `
      ${this.getFileIconSvg({ isBase, isDrawio, isExcalidraw, isImage, isMermaid, isPlantUml })}
      <span class="file-tree-name">${escapeHtml(displayName)}</span>
      ${threadCount > 0 ? `<span class="file-tree-comment-count" aria-label="${threadCount} open comment thread${threadCount === 1 ? '' : 's'}">${threadCount}</span>` : ''}
    `;
    this.configureDragSource(button, { path: filePath, type: 'file' });

    button.addEventListener('click', (event) => {
      if (this.consumeSuppressedActivation(button, event)) {
        return;
      }
      this.onFileSelect?.(filePath);
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.onFileContextMenu?.(event, { filePath, type: 'file' });
    });
    this.bindLongPress(button, () => {
      this.onFileContextMenu?.(this.createLongPressEvent(button), { filePath, type: 'file' });
    });

    return button;
  }

  isMobileViewport() {
    return Boolean(this.mobileBreakpointQuery?.matches);
  }

  isDragAndDropEnabled() {
    return !this.isMobileViewport() && !this.currentSearchQuery;
  }

  configureDragSource(element, payload) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const isEnabled = this.isDragAndDropEnabled();
    element.draggable = isEnabled;
    if (!isEnabled) {
      return;
    }

    element.addEventListener('dragstart', (event) => {
      this.dragSource = {
        path: payload.path,
        type: payload.type,
      };
      document.body?.classList.add('is-file-tree-dragging');
      if (this.treeContainer) {
        this.treeContainer.dataset.dragActive = 'true';
      }
      element.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', payload.path);
      }
    });
    element.addEventListener('dragend', () => {
      element.classList.remove('is-dragging');
      const dragSource = this.dragSource;
      if (this.invalidDropAttempt && dragSource) {
        void this.onEntryDrop?.(this.invalidDropAttempt);
      }
      this.dragSource = null;
      this.invalidDropAttempt = null;
      this.clearDragFeedback();
    });

    if (payload.type === 'file') {
      element.addEventListener('dragenter', (event) => {
        this.handleNonDropTargetDragOver(event);
      });
      element.addEventListener('dragover', (event) => {
        this.handleNonDropTargetDragOver(event);
      });
    }
  }

  bindDirectoryDropTarget(element, directoryPath) {
    if (!(element instanceof HTMLElement) || this.isMobileViewport()) {
      return;
    }

    element.addEventListener('dragenter', (event) => {
      this.handleDirectoryDragEnter(event, element, directoryPath);
    });
    element.addEventListener('dragover', (event) => {
      this.handleDirectoryDragOver(event, element, directoryPath);
    });
    element.addEventListener('drop', (event) => {
      this.handleDirectoryDrop(event, directoryPath);
    });
  }

  createRootDropZone() {
    const zone = document.createElement('div');
    zone.className = 'file-tree-root-drop-zone';
    zone.textContent = 'Drop here to move to vault root';
    zone.addEventListener('dragenter', (event) => {
      this.handleRootZoneDragEnter(event);
    });
    zone.addEventListener('dragover', (event) => {
      this.handleRootZoneDragOver(event);
    });
    zone.addEventListener('drop', (event) => {
      this.handleRootZoneDrop(event);
    });
    this.rootDropZone = zone;
    return zone;
  }

  validateDrop(destinationDirectory) {
    if (!this.dragSource || this.currentSearchQuery) {
      return false;
    }

    return this.onValidateDrop?.({
      destinationDirectory,
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    }) === true;
  }

  setDropTarget(target) {
    if (this.activeDropTarget?.element && this.activeDropTarget.element !== target?.element) {
      this.activeDropTarget.element.classList.remove('is-drop-target', 'is-drop-invalid');
    }

    if (this.activeDropTarget?.root && !target?.root) {
      this.treeContainer?.classList.remove('is-drop-target-root', 'is-drop-invalid');
    }
    if (this.activeDropTarget?.rootZone && !target?.rootZone) {
      this.rootDropZone?.classList.remove('is-drop-target', 'is-drop-invalid');
    }

    this.activeDropTarget = target;
    if (!target || target.isValid) {
      this.invalidDropAttempt = null;
    } else if (this.dragSource) {
      this.invalidDropAttempt = {
        destinationDirectory: target.destinationDirectory || '',
        sourcePath: this.dragSource.path,
        sourceType: this.dragSource.type,
      };
    }

    if (!target) {
      return;
    }

    if (target.root) {
      this.treeContainer?.classList.toggle('is-drop-target-root', target.isValid);
      this.treeContainer?.classList.toggle('is-drop-invalid', !target.isValid);
      return;
    }

    if (target.rootZone) {
      this.rootDropZone?.classList.toggle('is-drop-target', target.isValid);
      this.rootDropZone?.classList.toggle('is-drop-invalid', !target.isValid);
      return;
    }

    target.element.classList.toggle('is-drop-target', target.isValid);
    target.element.classList.toggle('is-drop-invalid', !target.isValid);
  }

  scheduleAutoExpand(element, directoryPath) {
    const isExpanded = element.getAttribute('aria-expanded') === 'true';
    if (isExpanded || this.autoExpandTargetPath === directoryPath) {
      return;
    }

    this.cancelAutoExpand();
    this.autoExpandTargetPath = directoryPath;
    this.autoExpandTimer = window.setTimeout(() => {
      this.autoExpandTimer = 0;
      this.autoExpandTargetPath = '';
      if (element.isConnected && element.getAttribute('aria-expanded') !== 'true') {
        this.onDirectoryToggle?.(directoryPath);
      }
    }, DRAG_AUTO_EXPAND_DELAY_MS);
  }

  cancelAutoExpand() {
    if (this.autoExpandTimer) {
      window.clearTimeout(this.autoExpandTimer);
      this.autoExpandTimer = 0;
    }
    this.autoExpandTargetPath = '';
  }

  clearDragFeedback() {
    this.cancelAutoExpand();
    this.setDropTarget(null);
    document.body?.classList.remove('is-file-tree-dragging');
    if (this.treeContainer) {
      delete this.treeContainer.dataset.dragActive;
    }
  }

  handleDirectoryDragEnter(event, element, directoryPath) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop(directoryPath);
    this.setDropTarget({ destinationDirectory: directoryPath, element, isValid, root: false });
    if (isValid) {
      this.scheduleAutoExpand(element, directoryPath);
    } else {
      this.cancelAutoExpand();
    }
  }

  handleDirectoryDragOver(event, element, directoryPath) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop(directoryPath);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    }
    this.setDropTarget({ destinationDirectory: directoryPath, element, isValid, root: false });
    if (isValid) {
      this.scheduleAutoExpand(element, directoryPath);
    } else {
      this.cancelAutoExpand();
    }
  }

  handleDirectoryDrop(event, directoryPath) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const payload = {
      destinationDirectory: directoryPath,
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    };
    this.clearDragFeedback();
    void this.onEntryDrop?.(payload);
  }

  handleTreeDragOver(event) {
    if (!this.dragSource || !this.treeContainer) {
      return;
    }

    if (event.target.closest('.file-tree-dir') || event.target.closest('.file-tree-item')) {
      return;
    }

    event.preventDefault();
    this.cancelAutoExpand();
    const isValid = this.validateDrop('');
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    }
    this.setDropTarget({ destinationDirectory: '', element: this.treeContainer, isValid, root: true });
  }

  handleTreeDrop(event) {
    if (!this.dragSource || !this.treeContainer) {
      return;
    }

    if (event.target.closest('.file-tree-dir') || event.target.closest('.file-tree-item')) {
      return;
    }

    event.preventDefault();
    const payload = {
      destinationDirectory: '',
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    };
    this.clearDragFeedback();
    void this.onEntryDrop?.(payload);
  }

  handleTreeDragLeave(event) {
    if (!this.dragSource || !this.treeContainer) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget && this.treeContainer.contains(nextTarget)) {
      return;
    }

    this.clearDragFeedback();
  }

  handleRootZoneDragEnter(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop('');
    this.cancelAutoExpand();
    this.setDropTarget({ destinationDirectory: '', element: this.rootDropZone, isValid, rootZone: true });
  }

  handleRootZoneDragOver(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const isValid = this.validateDrop('');
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = isValid ? 'move' : 'none';
    }
    this.cancelAutoExpand();
    this.setDropTarget({ destinationDirectory: '', element: this.rootDropZone, isValid, rootZone: true });
  }

  handleRootZoneDrop(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const payload = {
      destinationDirectory: '',
      sourcePath: this.dragSource.path,
      sourceType: this.dragSource.type,
    };
    this.clearDragFeedback();
    void this.onEntryDrop?.(payload);
  }

  handleNonDropTargetDragOver(event) {
    if (!this.dragSource) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
    }
    this.clearDragFeedback();
  }

  bindLongPress(element, callback) {
    if (!(element instanceof HTMLElement) || typeof callback !== 'function') {
      return;
    }

    element.addEventListener('pointerdown', (event) => {
      this.startLongPress(event, callback, element);
    });
    element.addEventListener('pointermove', (event) => {
      this.handleLongPressPointerMove(event);
    }, { passive: true });
    element.addEventListener('pointerup', () => {
      this.cancelLongPress();
    });
    element.addEventListener('pointercancel', () => {
      this.cancelLongPress();
    });
    element.addEventListener('pointerleave', () => {
      this.cancelLongPress();
    });
  }

  startLongPress(event, callback, target = null) {
    if (!this.isMobileViewport()) {
      return;
    }

    if (!['touch', 'pen'].includes(String(event.pointerType || ''))) {
      return;
    }

    if (Number(event.button ?? 0) !== 0) {
      return;
    }

    this.cancelLongPress();
    this.longPressContext = {
      callback,
      pointerId: event.pointerId,
      startX: Number(event.clientX || 0),
      startY: Number(event.clientY || 0),
      target: target ?? event.currentTarget ?? event.target ?? null,
    };
    this.longPressTimer = window.setTimeout(() => {
      const activeContext = this.longPressContext;
      this.longPressTimer = 0;
      if (!activeContext) {
        return;
      }

      this.suppressedActivationTarget = activeContext.target;
      activeContext.callback();
      this.longPressContext = null;
    }, MOBILE_LONG_PRESS_DELAY_MS);
  }

  handleLongPressPointerMove(event) {
    if (!this.longPressContext || event.pointerId !== this.longPressContext.pointerId) {
      return;
    }

    const deltaX = Math.abs(Number(event.clientX || 0) - this.longPressContext.startX);
    const deltaY = Math.abs(Number(event.clientY || 0) - this.longPressContext.startY);
    if (deltaX > MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX || deltaY > MOBILE_LONG_PRESS_MOVE_TOLERANCE_PX) {
      this.cancelLongPress();
    }
  }

  cancelLongPress() {
    if (this.longPressTimer) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = 0;
    }
    this.longPressContext = null;
  }

  createLongPressEvent(target) {
    return {
      clientX: this.longPressContext?.startX ?? 0,
      clientY: this.longPressContext?.startY ?? 0,
      preventDefault() {},
      stopPropagation() {},
      target,
    };
  }

  consumeSuppressedActivation(target, event) {
    if (this.suppressedActivationTarget !== target) {
      return false;
    }

    this.suppressedActivationTarget = null;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    return true;
  }

  getFileIconSvg({ isBase, isDrawio, isExcalidraw, isImage, isMermaid, isPlantUml }) {
    if (isBase) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M14 4v5h5"/><path d="M8 13h8"/><path d="M8 17h6"/><path d="M8 9h3"/></svg>';
    }

    if (isDrawio) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';
    }

    if (isExcalidraw) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>';
    }

    if (isImage) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5L7 20"/><path d="m14 14 2 2"/></svg>';
    }

    if (isMermaid) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5c0-1.38 1.12-2.5 2.5-2.5 1.04 0 1.93.64 2.3 1.56A2.5 2.5 0 0 1 14 8.5v1"/><path d="M19 16.5c0 1.38-1.12 2.5-2.5 2.5-1.04 0-1.93-.64-2.3-1.56A2.5 2.5 0 0 1 10 15.5v-1"/><path d="M8 10.5h8"/><path d="M8 13.5h8"/><path d="M10 8.5v7"/><path d="M14 8.5v7"/></svg>';
    }

    if (isPlantUml) {
      return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';
    }

    return '<svg class="file-tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  showContextMenu(event, items) {
    this.removeContextMenu();

    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    if (this.isMobileViewport()) {
      this.showActionSheet(items);
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'file-context-menu';

    for (const item of items) {
      const button = document.createElement('button');
      button.className = `file-context-item${item.danger ? ' file-context-danger' : ''}`;
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.removeContextMenu();
        item.onSelect?.();
      });
      menu.appendChild(button);
    }

    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - menuRect.height - 8);
    menu.style.left = `${Math.max(8, Math.min(event.clientX, maxLeft))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY, maxTop))}px`;

    const close = (closeEvent) => {
      if (!menu.contains(closeEvent.target)) {
        this.removeContextMenu();
      }
    };
    this.contextMenuCloseHandler = close;
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  showActionSheet(items) {
    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'file-action-sheet-backdrop';
    backdrop.setAttribute('aria-label', 'Close file actions');

    const sheet = document.createElement('div');
    sheet.className = 'file-action-sheet';

    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = buttonClassNames({
        variant: 'secondary',
        extra: ['file-action-sheet-item', item.danger ? 'file-context-danger' : ''],
      });
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.removeContextMenu();
        item.onSelect?.();
      });
      sheet.appendChild(button);
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = buttonClassNames({
      variant: 'ghost',
      extra: 'file-action-sheet-item',
    });
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      this.removeContextMenu();
    });
    sheet.appendChild(cancelButton);

    backdrop.addEventListener('click', () => {
      this.removeContextMenu();
    });

    document.body.append(backdrop, sheet);
    this.actionSheetCloseHandler = () => {
      backdrop.remove();
      sheet.remove();
      this.actionSheetCloseHandler = null;
    };
  }

  removeContextMenu() {
    this.cancelLongPress();
    this.clearDragFeedback();
    document.querySelectorAll('.file-context-menu').forEach((menu) => menu.remove());
    if (this.contextMenuCloseHandler) {
      document.removeEventListener('click', this.contextMenuCloseHandler);
      this.contextMenuCloseHandler = null;
    }
    this.actionSheetCloseHandler?.();
  }
}
