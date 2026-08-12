import { resolveApiUrl } from '../domain/runtime-paths.js';

const READ_ONLY_CATEGORIES = Object.freeze([
  'annotation',
  'document-capture',
  'document-close',
  'document-open',
  'document-print',
  'document-protect',
  'form',
  'history',
  'insert',
  'panel-comment',
  'redaction',
  'rotate',
]);

export class PdfPreviewController {
  constructor({ getTheme = () => 'dark', loadEmbedPdf } = {}) {
    this.getTheme = getTheme;
    this.loadEmbedPdf = loadEmbedPdf ?? (() => import('@embedpdf/snippet'));
    this.renderToken = 0;
    this.viewer = null;
  }

  async render({ filePath, renderHost }) {
    this.cancel();
    const token = this.renderToken;
    const viewerHost = document.createElement('div');
    viewerHost.className = 'pdf-file-preview-viewer';
    viewerHost.setAttribute('aria-label', `${String(filePath).split('/').pop() || filePath} PDF preview`);
    renderHost.replaceChildren(viewerHost);

    try {
      const { default: EmbedPDF, LockModeType, ZoomMode } = await this.loadEmbedPdf();
      if (token !== this.renderToken || !viewerHost.isConnected) return;

      const viewer = EmbedPDF.init({
        type: 'container',
        target: viewerHost,
        src: resolveApiUrl(`/download/file?path=${encodeURIComponent(filePath)}`),
        annotations: { locked: { type: LockModeType.All } },
        disabledCategories: READ_ONLY_CATEGORIES,
        fontFallback: null,
        fonts: { signature: null, ui: null },
        stamp: { defaultLibrary: false, manifests: [] },
        tabBar: 'never',
        theme: { preference: this.getTheme() },
        wasmUrl: new URL('@embedpdf/pdfium/pdfium.wasm', import.meta.url).toString(),
        zoom: {
          defaultZoomLevel: ZoomMode.FitWidth,
          maxZoom: 2,
          minZoom: 0.5,
          zoomStep: 0.25,
        },
      });

      this.viewer = viewer;
    } catch {
      if (token !== this.renderToken) return;
      viewerHost.classList.add('pdf-file-preview-error');
      viewerHost.textContent = 'This PDF could not be rendered in the browser.';
    }
  }

  setTheme(theme) {
    this.viewer?.setTheme?.(theme);
  }

  cancel() {
    this.renderToken += 1;
    this.viewer?.remove();
    this.viewer = null;
  }
}
