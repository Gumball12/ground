import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickSwitcherController } from '../../src/client/presentation/quick-switcher-controller.js';

describe('QuickSwitcherController file results', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="launcher">Search</button>
      <div id="quickSwitcher" aria-hidden="true">
        <button data-qs-mode="files">Files</button>
        <button data-qs-mode="text">Text</button>
        <input id="quickSwitcherInput">
        <div id="quickSwitcherHint"></div>
        <div id="quickSwitcherScope"></div>
        <div id="quickSwitcherResults" aria-busy="false"></div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps search input active after mode switching and closes from a focused tab', () => {
    const controller = new QuickSwitcherController({
      getFileList: () => ['README.md'],
      onFileSelect: vi.fn(),
    });
    controller.isOpen = true;
    controller.overlay.classList.add('visible');

    document.querySelector('[data-qs-mode="text"]').click();
    expect(controller.input).toHaveFocus();

    document.querySelector('[data-qs-mode="text"]').focus();
    document.querySelector('[data-qs-mode="text"]').dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Escape',
    }));
    expect(controller.overlay).not.toHaveClass('visible');
  });

  it('maintains accessible combobox, tab, and loading state', () => {
    const controller = new QuickSwitcherController({
      getFileList: () => ['README.md'],
      getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
      onFileSelect: vi.fn(),
      searchText: () => new Promise(() => {}),
    });

    controller.open();
    expect(controller.input).toHaveAttribute('aria-expanded', 'true');
    expect(controller.modeTabs[0]).toHaveAttribute('tabindex', '0');
    expect(controller.modeTabs[1]).toHaveAttribute('tabindex', '-1');

    controller.input.value = 'needle';
    controller.modeTabs[1].click();
    expect(controller.resultsList).toHaveAttribute('aria-busy', 'true');

    controller.modeTabs[0].click();
    expect(controller.resultsList).toHaveAttribute('aria-busy', 'false');

    controller.modeTabs[0].focus();
    controller.modeTabs[0].dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'ArrowRight',
    }));
    expect(controller.mode).toBe('text');
    expect(controller.modeTabs[1]).toHaveFocus();

    controller.close();
    expect(controller.input).toHaveAttribute('aria-expanded', 'false');
  });

  it('disables unavailable text search before mode switching', () => {
    const controller = new QuickSwitcherController({
      getFileList: () => ['README.md', 'docs/guide.md'],
      getSearchConfig: () => ({
        available: false,
        unavailableReason: 'ripgrep is not installed on the server',
      }),
      onFileSelect: vi.fn(),
    });
    const textTab = document.querySelector('[data-qs-mode="text"]');

    expect(textTab).toBeDisabled();
    expect(textTab).toHaveAttribute('title', 'ripgrep is not installed on the server');
    textTab.click();
    expect(controller.mode).toBe('files');

    controller.filterFiles();
    controller.input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Tab',
    }));
    expect(controller.selectedIndex).toBe(1);
  });

  it('shows file extensions in the file list', () => {
    const controller = new QuickSwitcherController({
      getFileList: () => ['docs/guide.pdf', 'assets/photo.png', 'diagrams/flow.mmd'],
      onFileSelect: vi.fn(),
    });

    controller.filterFiles();

    expect(document.querySelector('.qs-result-name')).toHaveTextContent('guide.pdf');
    expect(document.querySelector('.qs-result-path')).toHaveAttribute('title', 'docs');
    controller.input.value = 'pdf';
    controller.filterFiles();
    expect(document.querySelector('.qs-result-name')).toHaveTextContent('guide.pdf');
    expect(document.querySelector('.qs-result-name mark')).toHaveTextContent('pdf');
  });
});
