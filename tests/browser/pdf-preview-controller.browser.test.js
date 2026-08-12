import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfPreviewController } from '../../src/client/application/pdf-preview-controller.js';

function createEmbedPdfModule(init = vi.fn(({ target }) => {
  const viewer = document.createElement('embedpdf-container');
  viewer.setTheme = vi.fn();
  target.appendChild(viewer);
  return viewer;
})) {
  return {
    default: { init },
    LockModeType: { All: 'all' },
    ZoomMode: { FitWidth: 'fit-width' },
  };
}

describe('PdfPreviewController', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('mounts a self-hosted read-only EmbedPDF viewer', async () => {
    const module = createEmbedPdfModule();
    const init = module.default.init;
    const controller = new PdfPreviewController({
      getTheme: () => 'light',
      loadEmbedPdf: async () => module,
    });
    const renderHost = document.createElement('div');
    document.body.appendChild(renderHost);

    await controller.render({ filePath: 'docs/guide.pdf', renderHost });

    expect(init).toHaveBeenCalledTimes(1);
    const config = init.mock.calls[0][0];
    expect(config.src).toContain('/api/download/file?path=docs%2Fguide.pdf');
    expect(config.theme).toEqual({ preference: 'light' });
    expect(config.zoom.defaultZoomLevel).toBe('fit-width');
    expect(config.annotations).toEqual({ locked: { type: 'all' } });
    expect(config.disabledCategories).toContain('annotation');
    expect(config.disabledCategories).toContain('document-open');
    expect(config.fontFallback).toBeNull();
    expect(config.fonts).toEqual({ signature: null, ui: null });
    expect(config.wasmUrl).toMatch(/pdfium.*\.wasm/i);
    expect(renderHost.querySelector('embedpdf-container')).not.toBeNull();
  });

  it('removes the viewer on cancel and ignores stale imports', async () => {
    let resolveModule;
    const controller = new PdfPreviewController({
      loadEmbedPdf: () => new Promise((resolve) => {
        resolveModule = resolve;
      }),
    });
    const renderHost = document.createElement('div');
    document.body.appendChild(renderHost);

    const renderPromise = controller.render({ filePath: 'first.pdf', renderHost });
    controller.cancel();
    resolveModule(createEmbedPdfModule());
    await renderPromise;

    expect(renderHost.querySelector('embedpdf-container')).toBeNull();

    controller.loadEmbedPdf = async () => createEmbedPdfModule();
    await controller.render({ filePath: 'second.pdf', renderHost });
    const viewer = renderHost.querySelector('embedpdf-container');
    expect(viewer).not.toBeNull();
    controller.setTheme('dark');
    expect(viewer.setTheme).toHaveBeenCalledWith('dark');
    controller.cancel();
    expect(viewer.isConnected).toBe(false);
  });

  it('shows a fallback when EmbedPDF fails to load', async () => {
    const controller = new PdfPreviewController({
      loadEmbedPdf: async () => {
        throw new Error('failed');
      },
    });
    const renderHost = document.createElement('div');
    document.body.appendChild(renderHost);

    await controller.render({ filePath: 'broken.pdf', renderHost });

    expect(renderHost.querySelector('.pdf-file-preview-error')).toHaveTextContent(
      'This PDF could not be rendered in the browser.',
    );
  });
});
