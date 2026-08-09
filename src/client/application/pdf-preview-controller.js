import { clamp } from '../domain/vault-utils.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;
const MAX_PAGE_WIDTH = 960;
const PAGE_RENDER_ROOT_MARGIN = '720px 0px';
const MAX_DEVICE_PIXEL_RATIO = 2;
const PDF_ZOOM = Object.freeze({
  default: 1,
  max: 2,
  min: 0.5,
  renderDebounceMs: 100,
  step: 0.25,
  wheelSensitivity: 0.01,
});

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
    this.zoom = PDF_ZOOM.default;
    this.zoomControls = null;
    this.zoomRenderTimerId = 0;
    this.pageFitWidth = DEFAULT_PAGE_WIDTH;
    this.pageLayoutZoom = PDF_ZOOM.default;
    this.pinchStartDistance = 0;
    this.pinchStartZoom = PDF_ZOOM.default;
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
    this.zoom = PDF_ZOOM.default;
    this.pageLayoutZoom = PDF_ZOOM.default;
    this.pinchStartDistance = 0;
    this.pinchStartZoom = PDF_ZOOM.default;
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

    const zoomControls = document.createElement('div');
    zoomControls.className = 'pdf-file-preview-zoom-controls';

    const zoomOutButton = document.createElement('button');
    zoomOutButton.type = 'button';
    zoomOutButton.className = 'pdf-file-preview-zoom-button ui-preview-action';
    zoomOutButton.setAttribute('aria-label', 'Zoom out');
    zoomOutButton.title = 'Zoom out';
    zoomOutButton.textContent = '−';
    zoomOutButton.addEventListener('click', () => this.setZoom(this.zoom - PDF_ZOOM.step));

    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'pdf-file-preview-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    const zoomInButton = document.createElement('button');
    zoomInButton.type = 'button';
    zoomInButton.className = 'pdf-file-preview-zoom-button ui-preview-action';
    zoomInButton.setAttribute('aria-label', 'Zoom in');
    zoomInButton.title = 'Zoom in';
    zoomInButton.textContent = '+';
    zoomInButton.addEventListener('click', () => this.setZoom(this.zoom + PDF_ZOOM.step));

    zoomControls.append(zoomOutButton, zoomLabel, zoomInButton);
    this.zoomControls = { zoomInButton, zoomLabel, zoomOutButton };
    this.updateZoomControls();

    const download = document.createElement('a');
    download.className = 'pdf-file-preview-download';
    download.href = url;
    download.download = String(filePath).split('/').pop() || displayName;
    download.textContent = 'Download';
    download.setAttribute('aria-label', `Download ${displayName}`);

    const toolbarStart = document.createElement('div');
    toolbarStart.className = 'pdf-file-preview-toolbar-start';
    toolbarStart.append(status, zoomControls);
    toolbar.append(toolbarStart, download);

    const pages = document.createElement('div');
    pages.className = 'pdf-file-preview-pages';
    pages.setAttribute('aria-label', 'PDF pages');
    pages.addEventListener('wheel', (event) => this.handleWheelZoom(event), { passive: false });
    pages.addEventListener('touchstart', (event) => this.handleTouchStart(event), { passive: true });
    pages.addEventListener('touchmove', (event) => this.handleTouchMove(event), { passive: false });
    const finishPinch = (event) => this.handleTouchEnd(event);
    pages.addEventListener('touchend', finishPinch, { passive: true });
    pages.addEventListener('touchcancel', finishPinch, { passive: true });
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

    this.commitPageZoom();
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
        this.commitPageZoom();
        this.scheduleVisiblePageRender();
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
      state.needsRender = false;
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

        const context = canvas.getContext('2d', { alpha: false });
        renderTask = page.render({
          canvasContext: context,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        state.renderTask = renderTask;
        await renderTask.promise;

        const isCurrentRender = token === this.renderToken
          && this.visiblePages.has(pageNumber)
          && Math.abs(this.getPageWidth(state.pageShell) - width) < 1;
        if (!isCurrentRender) {
          if (token === this.renderToken && this.visiblePages.has(pageNumber)) {
            this.scheduleVisiblePageRender();
          }
          return;
        }

        state.canvas?.remove();
        state.canvas = canvas;
        state.renderedWidth = width;
        state.pageShell.replaceChildren(canvas);
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

  handleWheelZoom(event) {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;
    const wheelDelta = clamp(
      -deltaY * PDF_ZOOM.wheelSensitivity,
      -PDF_ZOOM.step / 2,
      PDF_ZOOM.step / 2,
    );
    if (wheelDelta !== 0) {
      this.setZoom(this.zoom + wheelDelta);
    }
  }

  getPinchDistance(touches) {
    if (!touches || touches.length !== 2) {
      return 0;
    }

    const [first, second] = touches;
    const distance = Math.hypot(
      second.clientX - first.clientX,
      second.clientY - first.clientY,
    );
    return Number.isFinite(distance) && distance > 0 ? distance : 0;
  }

  handleTouchStart(event) {
    if (event.touches?.length !== 2) {
      return;
    }

    const distance = this.getPinchDistance(event.touches);
    if (distance > 0) {
      this.pinchStartDistance = distance;
      this.pinchStartZoom = this.zoom;
    }
  }

  handleTouchMove(event) {
    if (event.touches?.length !== 2) {
      return;
    }

    if (!this.pinchStartDistance) {
      this.handleTouchStart(event);
    }

    const distance = this.getPinchDistance(event.touches);
    if (!distance || !this.pinchStartDistance) {
      return;
    }

    this.setZoom(this.pinchStartZoom * (distance / this.pinchStartDistance));
    event.preventDefault();
  }

  handleTouchEnd(event) {
    if (event.touches?.length === 2) {
      return;
    }

    this.pinchStartDistance = 0;
    this.pinchStartZoom = this.zoom;
  }

  cancelVisiblePageRenders() {
    this.visiblePages.forEach((pageNumber) => {
      const state = this.pageStates.get(pageNumber);
      if (!state) {
        return;
      }

      state.needsRender = false;
      state.renderTask?.cancel();
    });
  }

  scheduleVisiblePageRender() {
    if (this.zoomRenderTimerId) {
      window.clearTimeout(this.zoomRenderTimerId);
    }

    this.zoomRenderTimerId = window.setTimeout(() => {
      this.zoomRenderTimerId = 0;
      this.commitPageZoom({ measure: false });
      this.visiblePages.forEach((pageNumber) => {
        const state = this.pageStates.get(pageNumber);
        if (state) {
          state.needsRender = true;
        }
        void this.renderPage(pageNumber, this.renderToken);
      });
    }, PDF_ZOOM.renderDebounceMs);
  }

  setZoom(zoom) {
    const nextZoom = clamp(zoom, PDF_ZOOM.min, PDF_ZOOM.max);
    if (nextZoom === this.zoom) {
      return;
    }

    this.cancelVisiblePageRenders();
    this.zoom = nextZoom;
    this.updateZoomControls();
    this.applyLivePageZoom();
    this.scheduleVisiblePageRender();
  }

  updateZoomControls() {
    if (!this.zoomControls) {
      return;
    }

    const percentage = `${Math.round(this.zoom * 100)}%`;
    this.zoomControls.zoomLabel.textContent = percentage;
    this.zoomControls.zoomLabel.setAttribute('aria-label', `Zoom ${percentage}`);
    this.zoomControls.zoomOutButton.disabled = this.zoom <= PDF_ZOOM.min;
    this.zoomControls.zoomInButton.disabled = this.zoom >= PDF_ZOOM.max;
  }

  applyLivePageZoom() {
    const pagesElement = this.shell?.querySelector('.pdf-file-preview-pages');
    if (!pagesElement) {
      return;
    }

    const scale = this.pageLayoutZoom > 0 ? this.zoom / this.pageLayoutZoom : 1;
    if (Math.abs(scale - 1) < 0.001) {
      pagesElement.style.removeProperty('transform');
      pagesElement.style.removeProperty('transform-origin');
      pagesElement.style.removeProperty('will-change');
      return;
    }

    pagesElement.style.transformOrigin = 'top center';
    pagesElement.style.transform = `scale(${scale})`;
    pagesElement.style.willChange = 'transform';
  }

  commitPageZoom({ measure = true } = {}) {
    const pagesElement = this.shell?.querySelector('.pdf-file-preview-pages');
    if (!pagesElement) {
      return;
    }

    if (measure) {
      const styles = window.getComputedStyle(pagesElement);
      const horizontalPadding = Number.parseFloat(styles.paddingLeft || '0')
        + Number.parseFloat(styles.paddingRight || '0');
      const availableWidth = pagesElement.clientWidth - horizontalPadding;
      this.pageFitWidth = Math.min(
        MAX_PAGE_WIDTH,
        availableWidth > 0 ? availableWidth : (this.previewContainer?.clientWidth || DEFAULT_PAGE_WIDTH),
      );
    }

    pagesElement.style.setProperty(
      '--pdf-page-width',
      `${Math.max(1, this.pageFitWidth * this.zoom)}px`,
    );
    this.pageLayoutZoom = this.zoom;
    pagesElement.style.removeProperty('transform');
    pagesElement.style.removeProperty('transform-origin');
    pagesElement.style.removeProperty('will-change');
  }

  getPageWidth(pageShell) {
    return pageShell.offsetWidth
      || pageShell.getBoundingClientRect().width
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
    if (this.zoomRenderTimerId) {
      window.clearTimeout(this.zoomRenderTimerId);
      this.zoomRenderTimerId = 0;
    }
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
    this.zoomControls = null;
    this.zoom = PDF_ZOOM.default;
    this.pageFitWidth = DEFAULT_PAGE_WIDTH;
    this.pageLayoutZoom = PDF_ZOOM.default;
    this.pinchStartDistance = 0;
    this.pinchStartZoom = PDF_ZOOM.default;
    this.shell = null;
  }

}
