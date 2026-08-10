import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickSwitcherController } from '../../src/client/presentation/quick-switcher-controller.js';

describe('QuickSwitcherController file results', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('shows file extensions in the file list', () => {
    document.body.innerHTML = `
      <div id="quickSwitcher">
        <input id="quickSwitcherInput">
        <div id="quickSwitcherHint"></div>
        <div id="quickSwitcherScope"></div>
        <div id="quickSwitcherResults"></div>
      </div>
    `;

    const controller = new QuickSwitcherController({
      getFileList: () => ['docs/guide.pdf', 'assets/photo.png', 'diagrams/flow.mmd'],
      onFileSelect: vi.fn(),
    });

    controller.filterFiles();

    expect(document.querySelector('.qs-result-name')).toHaveTextContent('guide.pdf');
    controller.input.value = 'pdf';
    controller.filterFiles();
    expect(document.querySelector('.qs-result-name')).toHaveTextContent('guide.pdf');
    expect(document.querySelector('.qs-result-name mark')).toHaveTextContent('pdf');
  });
});
