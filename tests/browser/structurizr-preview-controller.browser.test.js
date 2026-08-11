import { afterEach, describe, expect, it, vi } from 'vitest';

import { StructurizrPreviewController } from '../../src/client/application/structurizr-preview-controller.js';

describe('StructurizrPreviewController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
  });

  it('prepares a loaded iframe without adding inline styles', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const stylesheet = iframe.contentDocument.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/api/structurizr/embed.css';
    iframe.contentDocument.head.append(stylesheet);
    const controller = new StructurizrPreviewController({
      enabled: true,
      syncWorkspace: vi.fn(),
    });
    const scheduleFrameFit = vi.spyOn(controller, 'scheduleFrameFit').mockImplementation(() => {});

    controller.prepareFrame(iframe);

    expect(iframe.contentDocument.querySelector('style')).toBeNull();
    expect(iframe.contentDocument.querySelector('link[rel="stylesheet"]')).toBe(stylesheet);
    expect(scheduleFrameFit).toHaveBeenCalledWith(iframe, null);

    controller.reset();
  });

  it('restores zoom and scroll state on the replacement iframe', () => {
    const frameStyle = document.createElement('style');
    frameStyle.textContent = 'iframe { width: 200px; height: 120px; }';
    document.body.append(frameStyle);

    const createFrame = (canvasWidth, canvasHeight, scale) => {
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      iframe.contentDocument.body.innerHTML = '<div id="diagram-viewport"><div id="diagram-canvas"><svg><g class="joint-layers"></g></svg></div></div>';
      const viewport = iframe.contentDocument.querySelector('#diagram-viewport');
      const canvas = iframe.contentDocument.querySelector('#diagram-canvas');
      const layer = iframe.contentDocument.querySelector('.joint-layers');
      viewport.style.width = '200px';
      viewport.style.height = '120px';
      viewport.style.overflow = 'auto';
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      layer.style.transform = `matrix(${scale}, 0, 0, ${scale}, 0, 0)`;
      return { iframe, layer, viewport };
    };

    const current = createFrame(800, 600, 0.8);
    current.viewport.scrollLeft = 150;
    current.viewport.scrollTop = 90;
    const replacement = createFrame(200, 120, 0.2);
    const controller = new StructurizrPreviewController({
      enabled: true,
      syncWorkspace: vi.fn(),
    });

    const state = controller.captureFrameState(current.iframe);
    controller.restoreFrameState(replacement.iframe, state);

    expect(getComputedStyle(replacement.layer).transform).toBe('matrix(0.8, 0, 0, 0.8, 0, 0)');
    expect(replacement.viewport.scrollLeft).toBe(150);
    expect(replacement.viewport.scrollTop).toBe(90);
  });

  it('keeps the current iframe mounted while a newer version loads', async () => {
    const renderHost = document.createElement('div');
    document.body.append(renderHost);
    const controller = new StructurizrPreviewController({
      enabled: true,
      syncWorkspace: vi.fn(async () => ({ version: 'v2' })),
    });
    controller.mount(renderHost, 'workspace.dsl');

    const currentIframe = document.createElement('iframe');
    currentIframe.className = 'structurizr-preview-iframe';
    controller.iframe = currentIframe;
    controller.lastVersion = 'v1';
    controller.shell.append(currentIframe);

    await controller.syncNow({ filePath: 'workspace.dsl', source: 'updated' });

    const iframes = renderHost.querySelectorAll('iframe');
    expect(iframes).toHaveLength(2);
    expect(Array.from(iframes)).toContain(currentIframe);
    expect(currentIframe.isConnected).toBe(true);
    const replacementIframe = Array.from(iframes).find((iframe) => iframe !== currentIframe);
    expect(replacementIframe?.style.visibility).toBe('hidden');
    expect(controller.iframe).toBe(currentIframe);

    controller.reset();
  });
});
