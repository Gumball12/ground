import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiagramChrome } from '../../src/client/application/diagram-chrome.js';

function createSvg({ height = 80, label = 'Diagram', width = 120 } = {}) {
  const shell = document.createElement('div');
  shell.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><text x="4" y="20">${label}</text></svg>`;
  return shell.querySelector('svg');
}

function mountDiagram(chrome, kind, {
  baseHeight = 80,
  baseWidth = 120,
  label = kind,
} = {}) {
  const shell = document.createElement('div');
  shell.className = `${kind}-shell diagram-preview-shell`;
  const source = document.createElement('span');
  source.className = `${kind}-source`;
  source.hidden = true;
  source.textContent = `${kind} source`;
  shell.append(source);
  document.body.append(shell);

  chrome.mount(shell, {
    baseHeight,
    baseWidth,
    diagramElement: createSvg({ height: baseHeight, label, width: baseWidth }),
    exportFileNames: () => ({ pngFileName: `${kind}.png`, svgFileName: `${kind}.svg` }),
    exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    kind,
    sourceSelector: `.${kind}-source`,
  });

  return shell;
}

describe('DiagramChrome', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('mounts Mermaid chrome with existing diagram-specific classes', () => {
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { label: 'Start' });

    expect(shell.querySelector('.mermaid-toolbar.diagram-preview-toolbar')).not.toBeNull();
    expect(shell.querySelector('.mermaid-frame.diagram-preview-frame svg')).not.toBeNull();
    expect(shell.querySelector('.mermaid-zoom-btn[aria-label="Zoom in"]')).not.toBeNull();
    expect(shell.querySelector('.mermaid-zoom-btn[aria-label="Download SVG"]')).not.toBeNull();
    expect(shell.querySelector('.mermaid-source')?.textContent).toBe('mermaid source');
  });

  it('sizes a replacement SVG before swapping mounted diagram output', () => {
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { label: 'Start' });
    const replacement = createSvg({ height: 180, label: 'Updated', width: 240 });

    chrome.mount(shell, {
      baseHeight: 180,
      baseWidth: 240,
      diagramElement: replacement,
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });

    expect(replacement.style.width).not.toBe('');
    expect(replacement.style.height).not.toBe('');
    expect(shell.querySelector('.mermaid-frame svg')).toBe(replacement);
  });

  it('does not queue a second fit pass when replacing visible diagram output', () => {
    const scheduledFrames = [];
    const windowRef = {
      addEventListener: () => {},
      cancelAnimationFrame: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: (callback) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      },
    };
    const chrome = new DiagramChrome({ windowRef });
    const shell = mountDiagram(chrome, 'mermaid');
    shell.querySelector('.mermaid-frame').style.width = '640px';
    scheduledFrames.length = 0;

    chrome.mount(shell, {
      baseHeight: 120,
      baseWidth: 180,
      diagramElement: createSvg({ height: 120, width: 180 }),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });

    expect(scheduledFrames).toHaveLength(0);
  });

  it('preserves zoom and scroll position when replacing diagram output', async () => {
    const frameStyle = document.createElement('style');
    frameStyle.textContent = '.diagram-preview-frame { width: 240px; height: 120px; overflow: auto; }';
    document.body.append(frameStyle);
    const chrome = new DiagramChrome();
    const shell = mountDiagram(chrome, 'mermaid', { baseHeight: 600, baseWidth: 1200 });
    const frame = shell.querySelector('.mermaid-frame');

    shell.querySelector('.mermaid-zoom-btn[aria-label="Zoom in"]').click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    frame.scrollLeft = 90;
    frame.scrollTop = 70;
    expect(frame.scrollLeft).toBe(90);
    expect(frame.scrollTop).toBe(70);
    expect(chrome.shellControllers.get(shell)?.getViewState?.().scrollLeft).toBe(90);
    expect(chrome.shellControllers.get(shell)?.getViewState?.().scrollTop).toBe(70);
    const previousZoom = shell.querySelector('.mermaid-zoom-label')?.textContent;
    chrome.captureShellViewState(shell);
    const parent = shell.parentElement;
    parent.removeChild(shell);
    parent.append(shell);

    chrome.mount(shell, {
      baseHeight: 600,
      baseWidth: 1200,
      diagramElement: createSvg({ height: 600, label: 'Updated', width: 1200 }),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'mermaid',
      sourceSelector: '.mermaid-source',
    });

    const framesDuringSwap = shell.querySelectorAll('.mermaid-frame');
    expect(framesDuringSwap).toHaveLength(2);
    expect(framesDuringSwap[0]).toBe(frame);
    expect(framesDuringSwap[0].style.visibility).toBe('');
    expect(framesDuringSwap[1].style.visibility).toBe('hidden');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const nextFrame = shell.querySelector('.mermaid-frame');
    expect(nextFrame).not.toBe(frame);
    expect(shell.querySelectorAll('.mermaid-frame')).toHaveLength(1);
    expect(shell.querySelector('.mermaid-zoom-label')?.textContent).toBe(previousZoom);
    expect(nextFrame.scrollLeft).toBe(90);
    expect(nextFrame.scrollTop).toBe(70);
    expect(nextFrame.style.visibility).toBe('');
  });

  it('maximizes one diagram at a time across Mermaid and PlantUML', () => {
    const chrome = new DiagramChrome();
    const mermaidShell = mountDiagram(chrome, 'mermaid');
    const plantUmlShell = mountDiagram(chrome, 'plantuml');

    mermaidShell.querySelector('.mermaid-maximize-btn')?.click();

    expect(document.body.classList.contains('mermaid-maximized-open')).toBe(true);
    expect(document.querySelector('[data-mermaid-maximized-root="true"] .mermaid-shell.is-maximized')).toBe(mermaidShell);
    expect(mermaidShell.querySelector('.mermaid-maximize-btn')?.getAttribute('aria-label')).toBe('Restore diagram size');

    plantUmlShell.querySelector('.plantuml-maximize-btn')?.click();

    expect(mermaidShell.classList.contains('is-maximized')).toBe(false);
    expect(document.body.classList.contains('mermaid-maximized-open')).toBe(false);
    expect(document.body.classList.contains('plantuml-maximized-open')).toBe(true);
    expect(document.querySelector('[data-plantuml-maximized-root="true"] .plantuml-shell.is-maximized')).toBe(plantUmlShell);
    expect(mermaidShell.querySelector('.mermaid-maximize-btn')?.getAttribute('aria-label')).toBe('Maximize diagram');

    plantUmlShell.querySelector('.plantuml-maximize-btn')?.click();

    expect(plantUmlShell.classList.contains('is-maximized')).toBe(false);
    expect(document.body.classList.contains('plantuml-maximized-open')).toBe(false);
    expect(plantUmlShell.querySelector('.plantuml-maximize-btn')?.getAttribute('aria-label')).toBe('Maximize diagram');
  });

  it('renders a PlantUML reload action when supplied by the adapter', () => {
    const onReload = vi.fn();
    const chrome = new DiagramChrome();
    const shell = document.createElement('div');
    shell.className = 'plantuml-shell diagram-preview-shell';
    document.body.append(shell);

    chrome.mount(shell, {
      baseHeight: 80,
      baseWidth: 120,
      diagramElement: createSvg(),
      exportFileNames: () => ({ pngFileName: 'diagram.png', svgFileName: 'diagram.svg' }),
      exportSvgMarkup: () => '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      kind: 'plantuml',
      onReload,
    });

    shell.querySelector('.plantuml-tool-btn[aria-label="Reload diagram"]')?.click();

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
