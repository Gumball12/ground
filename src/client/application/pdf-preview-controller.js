import { resolveApiUrl } from '../domain/runtime-paths.js';

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;
const PAGE_RENDER_ROOT_MARGIN = '720px 0px';
const MAX_DEVICE_PIXEL_RATIO = 2;

function isRenderingCancellation(error) {
  return error?.name === 'RenderingCancelledException';
}

export class PdfPreviewController {
  constructor({ previewContainer }) {
    this.previewContainer = previewContainer;
    this.pdfJsPromise = null;
    this.loadingTask = null;
    this.pdfDocument = null;
    this.intersectionObserver = null;
    this.resizeObserver = null;
    this.pageStates = new Map();
    this.visiblePages = new Set();
    this.renderToken = 0;
    this.shell = null;
  }

  async loadPdfJs() {
    if (!this.pdfJsPromise) {
      this.pdfJsPromise = import('pdfjs-dist').then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).toString();
        return pdfjs;
      });
    }

    return this.pdfJsPromise;
  }

  async render({ filePath, renderHost, displayName }) {
    const token = this.renderToken;
    const url = resolveApiUrl(`/download/file?path=${encodeURIComponent(filePath)}`);
    const shell = this.createShell({ displayName, filePath, url });
    renderHost.replaceChildren(shell);
    this.shell = shell;

    try {
      const { getDocument } = await this.loadPdfJs();
      if (token !== this.renderToken) {
        return;
      }

      this.loadingTask = getDocument({ url });
      const pdfDocument = await this.loadingTask.promise;
      if (token !== this.renderToken) {
        await pdfDocument.destroy();
        return;
      }

      this.pdfDocument = pdfDocument;
      this.buildPageStates(pdfDocument.numPages, shell.querySelector('.pdf-file-preview-pages'));
      this.setStatus(`${pdfDocument.numPages} ${pdfDocument.numPages === 1 ? 'page' : 'pages'}`);
      this.observePages(token);
    } catch (error) {
      if (token === this.renderToken && !isRenderingCancellation(error)) {
        this.showError(shell);
      }
    } finally {
      if (token === this.renderToken) {
        this.loadingTask = null;
      }
    }
  }

  createShell({ displayName, filePath, url }) {
    const shell = document.createElement('section');
    shell.className = 'pdf-file-preview-shell';
    shell.setAttribute('aria-label', `${displayName} PDF preview`);

    const toolbar = document.createElement('div');
    toolbar.className = 'pdf-file-preview-toolbar';

    const status = document.createElement('span');
    status.className = 'pdf-file-preview-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Loading PDF preview…';

    const download = document.createElement('a');
    download.className = 'pdf-file-preview-download';
    download.href = url;
    download.download = String(filePath).split('/').pop() || displayName;
    download.textContent = 'Download';
    download.setAttribute('aria-label', `Download ${displayName}`);

    toolbar.append(status, download);

    const pages = document.createElement('div');
    pages.className = 'pdf-file-preview-pages';
    pages.setAttribute('aria-label', 'PDF pages');
    shell.append(toolbar, pages);
    return shell;
  }

  buildPageStates(pageCount, pagesElement) {
    this.pageStates.clear();
    this.visiblePages.clear();
    pagesElement.replaceChildren();

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const pageShell = document.createElement('article');
      pageShell.className = 'pdf-page';
      pageShell.dataset.pageNumber = String(pageNumber);
      pageShell.setAttribute('aria-label', `Page ${pageNumber} of ${pageCount}`);
      pageShell.style.aspectRatio = `${DEFAULT_PAGE_WIDTH} / ${DEFAULT_PAGE_HEIGHT}`;
      pagesElement.appendChild(pageShell);
      this.pageStates.set(pageNumber, {
        canvas: null,
        needsRender: false,
        page: null,
        pageShell,
        renderPromise: null,
        renderTask: null,
        renderedWidth: 0,
      });
    }
  }

  observePages(token) {
    const pagesElement = this.shell?.querySelector('.pdf-file-preview-pages');
    if (!pagesElement) {
      return;
    }

    if (typeof IntersectionObserver === 'function') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => this.handlePageIntersections(entries, token),
        {
          root: this.previewContainer,
          rootMargin: PAGE_RENDER_ROOT_MARGIN,
        },
      );
      this.pageStates.forEach(({ pageShell }) => this.intersectionObserver.observe(pageShell));
    } else {
      this.visiblePages.add(1);
      void this.renderPage(1, token);
    }

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => {
        this.visiblePages.forEach((pageNumber) => {
          void this.renderPage(pageNumber, token);
        });
      });
      this.resizeObserver.observe(pagesElement);
    }
  }

  handlePageIntersections(entries, token) {
    if (token !== this.renderToken) {
      return;
    }

    entries.forEach((entry) => {
      const pageNumber = Number(entry.target.dataset.pageNumber);
      if (entry.isIntersecting) {
        this.visiblePages.add(pageNumber);
        void this.renderPage(pageNumber, token);
        return;
      }

      this.visiblePages.delete(pageNumber);
      this.releasePage(pageNumber);
    });
  }

  async renderPage(pageNumber, token) {
    const state = this.pageStates.get(pageNumber);
    if (!state || !this.pdfDocument || token !== this.renderToken) {
      return;
    }

    const width = this.getPageWidth(state.pageShell);
    if (state.canvas && Math.abs(state.renderedWidth - width) < 1) {
      return;
    }
    if (state.renderPromise) {
      return state.renderPromise;
    }

    state.needsRender = false;
    state.renderPromise = (async () => {
      let renderTask = null;
      try {
        const page = state.page ?? await this.pdfDocument.getPage(pageNumber);
        if (token !== this.renderToken) {
          return;
        }

        state.page = page;
        const baseViewport = page.getViewport({ scale: 1 });
        state.pageShell.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
        const scale = width / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const outputScale = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.setAttribute('aria-label', `Rendered page ${pageNumber}`);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        state.canvas?.remove();
        state.canvas = canvas;
        state.renderedWidth = width;
        state.pageShell.replaceChildren(canvas);

        const context = canvas.getContext('2d', { alpha: false });
        renderTask = page.render({
          canvasContext: context,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        state.renderTask = renderTask;
        await renderTask.promise;
      } catch (error) {
        if (!isRenderingCancellation(error) && token === this.renderToken) {
          state.canvas?.remove();
          state.canvas = null;
          state.renderedWidth = 0;
          this.setStatus(`Unable to render page ${pageNumber}`);
        }
      } finally {
        if (state.renderTask === renderTask) {
          state.renderTask = null;
        }
      }
    })().finally(() => {
      state.renderPromise = null;
      const shouldRetry = state.needsRender;
      state.needsRender = false;
      if (shouldRetry && this.visiblePages.has(pageNumber) && token === this.renderToken) {
        void this.renderPage(pageNumber, token);
      }
    });

    return state.renderPromise;
  }

  getPageWidth(pageShell) {
    return pageShell.getBoundingClientRect().width
      || this.previewContainer?.clientWidth
      || DEFAULT_PAGE_WIDTH;
  }

  releasePage(pageNumber) {
    const state = this.pageStates.get(pageNumber);
    if (!state) {
      return;
    }

    state.needsRender = true;
    state.renderTask?.cancel();
    state.renderTask = null;
    state.canvas?.remove();
    state.canvas = null;
    state.renderedWidth = 0;
    state.pageShell.replaceChildren();
  }

  setStatus(text) {
    const status = this.shell?.querySelector('.pdf-file-preview-status');
    if (status) {
      status.textContent = text;
    }
  }

  showError(shell) {
    this.setStatus('Unable to render PDF');
    const pages = shell.querySelector('.pdf-file-preview-pages');
    if (!pages) {
      return;
    }

    const error = document.createElement('div');
    error.className = 'pdf-file-preview-error';
    error.textContent = 'This PDF could not be rendered in the browser.';

    pages.replaceChildren(error);
  }

  cancel() {
    this.renderToken += 1;
    this.intersectionObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.intersectionObserver = null;
    this.resizeObserver = null;
    this.pageStates.forEach((state) => {
      state.renderTask?.cancel();
      state.renderTask = null;
    });
    const loadingTaskDestroy = this.loadingTask?.destroy?.();
    loadingTaskDestroy?.catch?.(() => {});
    const pdfDocumentDestroy = this.pdfDocument?.destroy?.();
    pdfDocumentDestroy?.catch?.(() => {});
    this.loadingTask = null;
    this.pdfDocument = null;
    this.pageStates.clear();
    this.visiblePages.clear();
    this.shell = null;
  }

}
