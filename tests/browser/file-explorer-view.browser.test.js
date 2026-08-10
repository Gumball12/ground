import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileExplorerController } from '../../src/client/presentation/file-explorer-controller.js';
import { FileExplorerView } from '../../src/client/presentation/file-explorer-view.js';

function createView(overrides = {}) {
  document.body.innerHTML = `
    <input id="fileSearchInput">
    <button id="fileExplorerOptionsBtn" type="button"></button>
    <nav id="fileTree"></nav>
  `;

  return new FileExplorerView({
    mobileBreakpointQuery: { matches: true },
    onEntryDrop: vi.fn(),
    onDirectorySelect: vi.fn(),
    onDirectoryToggle: vi.fn(),
    onFileContextMenu: vi.fn(),
    onFileSelect: vi.fn(),
    onSearchChange: vi.fn(),
    onTreeContextMenu: vi.fn(),
    onValidateDrop: vi.fn(() => true),
    ...overrides,
  });
}

describe('FileExplorerView mobile interactions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens file actions after a mobile long press', () => {
    vi.useFakeTimers();
    const onFileContextMenu = vi.fn();
    const view = createView({ onFileContextMenu });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 24,
      clientY: 18,
      pointerId: 1,
      pointerType: 'touch',
    }));

    vi.advanceTimersByTime(421);

    expect(onFileContextMenu).toHaveBeenCalledTimes(1);
    expect(onFileContextMenu.mock.calls[0][1]).toEqual({ filePath: 'README.md', type: 'file' });
  });

  it('renders file-level open comment counts', () => {
    const view = createView();

    view.render({
      activeFilePath: null,
      threadCounts: new Map([['README.md', 2]]),
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    expect(item.classList.contains('has-comments')).toBe(true);
    expect(item.dataset.threadCount).toBe('2');
    expect(item.querySelector('.file-tree-comment-count').textContent).toBe('2');
  });

  it('shows file extensions when the explorer preference is enabled', () => {
    const view = createView();
    const render = (showFileExtensions) => view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      showFileExtensions,
      tree: [{ name: '3-drawio.drawio', path: '3-drawio.drawio', type: 'drawio' }],
    });

    render(false);
    expect(document.querySelector('.file-tree-name')?.textContent).toBe('3-drawio');

    render(true);
    expect(document.querySelector('.file-tree-name')?.textContent).toBe('3-drawio.drawio');
  });

  it('toggles file extensions from the sidebar options menu', () => {
    createView();
    const onShowFileExtensionsChange = vi.fn();
    const controller = new FileExplorerController({
      mobileBreakpointQuery: { matches: false },
      onFileDelete: vi.fn(),
      onFileSelect: vi.fn(),
      onShowFileExtensionsChange,
      toastController: { show: vi.fn() },
      vaultClient: { readTree: vi.fn() },
    });
    controller.initialize();
    controller.setTree([{ name: '3-drawio.drawio', path: '3-drawio.drawio', type: 'drawio' }], { reset: true });

    document.getElementById('fileExplorerOptionsBtn').click();

    const option = document.querySelector('.create-menu-item');
    expect(option?.textContent).toContain('Show file extensions');
    expect(option?.textContent).toContain('Off');
    option.click();

    expect(onShowFileExtensionsChange).toHaveBeenCalledWith(true);
    expect(document.querySelector('.file-tree-name')?.textContent).toBe('3-drawio.drawio');
  });

  it('cancels a long press when the pointer moves like a scroll gesture', () => {
    vi.useFakeTimers();
    const onFileContextMenu = vi.fn();
    const view = createView({ onFileContextMenu });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const item = document.querySelector('.file-tree-file');
    item.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 24,
      clientY: 18,
      pointerId: 2,
      pointerType: 'touch',
    }));
    item.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: 24,
      clientY: 36,
      pointerId: 2,
      pointerType: 'touch',
    }));

    vi.advanceTimersByTime(421);

    expect(onFileContextMenu).not.toHaveBeenCalled();
  });
});

describe('FileExplorerView drag and drop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('emits a drop payload for directory targets on desktop', () => {
    const onEntryDrop = vi.fn();
    const onValidateDrop = vi.fn(() => true);
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onEntryDrop,
      onValidateDrop,
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(['docs']),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [
        { name: 'README.md', path: 'README.md', type: 'file' },
        {
          children: [],
          name: 'docs',
          path: 'docs',
          type: 'directory',
        },
      ],
    });

    const transfer = new DataTransfer();
    const fileItem = document.querySelector('.file-tree-file');
    const directoryItem = document.querySelector('.file-tree-dir');

    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    directoryItem.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    directoryItem.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));

    expect(onValidateDrop).toHaveBeenCalledWith({
      destinationDirectory: 'docs',
      sourcePath: 'README.md',
      sourceType: 'file',
    });
    expect(onEntryDrop).toHaveBeenCalledWith({
      destinationDirectory: 'docs',
      sourcePath: 'README.md',
      sourceType: 'file',
    });
  });

  it('disables drag interactions while search results are shown', () => {
    const onEntryDrop = vi.fn();
    const onValidateDrop = vi.fn(() => true);
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onEntryDrop,
      onValidateDrop,
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [{ name: 'README.md', path: 'README.md', type: 'file' }],
      searchQuery: 'read',
      tree: [{ name: 'README.md', path: 'README.md', type: 'file' }],
    });

    const fileItem = document.querySelector('.file-tree-file');
    expect(fileItem.draggable).toBe(false);
    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));

    expect(onValidateDrop).not.toHaveBeenCalled();
    expect(onEntryDrop).not.toHaveBeenCalled();
  });

  it('marks invalid directory drop targets with a rejected state', () => {
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onValidateDrop: vi.fn(() => false),
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(['docs']),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [
        { name: 'README.md', path: 'README.md', type: 'file' },
        {
          children: [],
          name: 'docs',
          path: 'docs',
          type: 'directory',
        },
      ],
    });

    const transfer = new DataTransfer();
    const fileItem = document.querySelector('.file-tree-file');
    const directoryItem = document.querySelector('.file-tree-dir');

    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    directoryItem.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));

    expect(directoryItem.classList.contains('is-drop-invalid')).toBe(true);
    expect(directoryItem.classList.contains('is-drop-target')).toBe(false);
  });

  it('treats the empty tree surface as a root drop target', () => {
    const onEntryDrop = vi.fn();
    const view = createView({
      mobileBreakpointQuery: { matches: false },
      onEntryDrop,
      onValidateDrop: vi.fn(() => true),
    });

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{ name: 'notes.md', path: 'notes.md', type: 'file' }],
    });

    const transfer = new DataTransfer();
    const fileItem = document.querySelector('.file-tree-file');
    const tree = document.getElementById('fileTree');
    const rootZone = document.querySelector('.file-tree-root-drop-zone');

    fileItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    expect(tree.dataset.dragActive).toBe('true');
    view.handleRootZoneDragOver({
      dataTransfer: transfer,
      preventDefault() {},
      stopPropagation() {},
      target: rootZone,
    });
    view.handleRootZoneDrop({
      dataTransfer: transfer,
      preventDefault() {},
      stopPropagation() {},
      target: rootZone,
    });

    expect(tree.classList.contains('is-drop-target-root')).toBe(false);
    expect(rootZone.classList.contains('is-drop-target')).toBe(false);
    expect(onEntryDrop).toHaveBeenCalledWith({
      destinationDirectory: '',
      sourcePath: 'notes.md',
      sourceType: 'file',
    });
  });
});

describe('File explorer reveal behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('scrolls the matching file into view when revealed', () => {
    const view = createView();

    view.render({
      activeFilePath: null,
      expandedDirs: new Set(['docs']),
      reset: true,
      searchMatches: [],
      searchQuery: '',
      tree: [{
        children: [
          { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
        ],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      }],
    });

    const item = document.querySelector('[data-path="docs/guide.md"]');
    item.scrollIntoView = vi.fn();

    view.revealFile('docs/guide.md');

    expect(item.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('includes PDFs in file lists used by wiki links and file search', () => {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;

    const controller = new FileExplorerController({
      mobileBreakpointQuery: { matches: true },
      onFileDelete: vi.fn(),
      onFileSelect: vi.fn(),
      toastController: { show: vi.fn() },
      vaultClient: { readTree: vi.fn() },
    });

    controller.setTree([{ name: 'guide.pdf', path: 'docs/guide.pdf', type: 'pdf' }], { reset: true });

    expect(controller.flatFiles).toEqual(['docs/guide.pdf']);
    expect(controller.flatDocumentFiles).toEqual(['docs/guide.pdf']);
    controller.state.setSearchQuery('guide');
    expect(controller.state.getSearchMatches()).toEqual([
      { name: 'guide.pdf', path: 'docs/guide.pdf', type: 'pdf' },
    ]);
  });

  it('clears tree search before revealing a quick-switcher file', () => {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const controller = new FileExplorerController({
        mobileBreakpointQuery: { matches: true },
        onFileDelete: vi.fn(),
        onFileSelect: vi.fn(),
        toastController: { show: vi.fn() },
        vaultClient: { readTree: vi.fn() },
      });

      controller.setTree([{
        children: [{
          children: [
            { name: 'guide.md', path: 'docs/guides/guide.md', type: 'file' },
          ],
          name: 'guides',
          path: 'docs/guides',
          type: 'directory',
        }],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      }], { reset: true });

      controller.state.setSearchQuery('guide');
      controller.renderTree();
      expect(document.querySelectorAll('.file-tree-children')).toHaveLength(0);

      controller.revealFile('docs/guides/guide.md', { clearSearch: true });

      expect(document.getElementById('fileSearchInput').value).toBe('');
      expect(document.querySelectorAll('.file-tree-dir')).toHaveLength(2);
      expect(document.querySelector('.file-tree-file.active')?.dataset.path).toBe('docs/guides/guide.md');
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('does not auto-scroll for normal active-file updates', () => {
    document.body.innerHTML = `
      <input id="fileSearchInput">
      <nav id="fileTree"></nav>
    `;

    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const controller = new FileExplorerController({
        mobileBreakpointQuery: { matches: true },
        onFileDelete: vi.fn(),
        onFileSelect: vi.fn(),
        toastController: { show: vi.fn() },
        vaultClient: { readTree: vi.fn() },
      });

      controller.setTree([{
        children: [
          { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
          { name: 'notes.md', path: 'docs/notes.md', type: 'file' },
        ],
        name: 'docs',
        path: 'docs',
        type: 'directory',
      }], { reset: true });

      controller.setActiveFile('docs/guide.md');
      const guideItem = document.querySelector('[data-path="docs/guide.md"]');
      const directoryItem = document.querySelector('[data-path="docs"]');

      controller.setActiveFile('docs/notes.md');
      controller.setThreadCounts(new Map([['docs/notes.md', 2]]));

      expect(document.querySelector('[data-path="docs/guide.md"]')).toBe(guideItem);
      expect(document.querySelector('[data-path="docs"]')).toBe(directoryItem);
      expect(document.querySelector('.file-tree-file.active')?.dataset.path).toBe('docs/notes.md');
      expect(document.querySelector('[data-path="docs/notes.md"] .file-tree-comment-count')?.textContent).toBe('2');
      directoryItem.click();
      expect(document.querySelector('[data-path="docs"]')).toBe(directoryItem);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});
