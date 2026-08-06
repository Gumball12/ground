import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import {
  rasterizeSvgMarkupToPngBlob,
  writeBlobToClipboard,
} from './diagram-preview-export.js';
import {
  easeOutCubic,
  getFrameViewportSize,
} from './preview-diagram-utils.js';
import { clamp } from '../domain/vault-utils.js';
import { downloadBlob } from '../browser-utils.js';

export const DIAGRAM_CHROME_ZOOM = Object.freeze({
  animationDurationMs: 160,
  default: 1,
  max: 3,
  min: 0.1,
  step: 0.1,
});

const DIAGRAM_CHROME_ZOOM_POLICY = Object.freeze({
  mermaid: {
    ...DIAGRAM_CHROME_ZOOM,
    fitMax: DIAGRAM_CHROME_ZOOM.max,
    min: 0.5,
  },
  plantuml: {
    ...DIAGRAM_CHROME_ZOOM,
    fitMax: DIAGRAM_CHROME_ZOOM.default,
  },
});

const DIAGRAM_CHROME_KIND_CONFIG = Object.freeze({
  mermaid: {
    bodyClassName: 'mermaid-maximized-open',
    buttonClassName: 'mermaid-zoom-btn ui-preview-action',
    frameClassName: 'mermaid-frame diagram-preview-frame',
    maximizeButtonClassName: 'mermaid-maximize-btn',
    maximizedRootClassName: 'mermaid-maximized-root',
    maximizedRootDatasetKey: 'mermaidMaximizedRoot',
    toolbarClassName: 'mermaid-toolbar diagram-preview-toolbar',
    zoomLabelClassName: 'mermaid-zoom-label diagram-preview-zoom-label',
  },
  plantuml: {
    bodyClassName: 'plantuml-maximized-open',
    buttonClassName: 'plantuml-tool-btn ui-preview-action',
    frameClassName: 'plantuml-frame diagram-preview-frame',
    maximizeButtonClassName: 'plantuml-maximize-btn',
    maximizedRootClassName: 'plantuml-maximized-root',
    maximizedRootDatasetKey: 'plantumlMaximizedRoot',
    toolbarClassName: 'plantuml-toolbar diagram-preview-toolbar',
    zoomLabelClassName: 'plantuml-zoom-label diagram-preview-zoom-label',
  },
});

function getKindConfig(kind) {
  return DIAGRAM_CHROME_KIND_CONFIG[kind] ?? DIAGRAM_CHROME_KIND_CONFIG.mermaid;
}

function getKindZoomPolicy(kind) {
  return DIAGRAM_CHROME_ZOOM_POLICY[kind] ?? DIAGRAM_CHROME_ZOOM_POLICY.mermaid;
}

function isSvgElement(value) {
  return value instanceof SVGSVGElement;
}

export class DiagramChrome {
  constructor({
    documentRef = document,
    toastController = null,
    windowRef = window,
  } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.toastController = toastController;
    this.activeMaximizedShell = null;
    this.maximizedRoots = new Map();
    this.resizeObservers = new Set();
    this.shellControllers = new WeakMap();
    this.shellViewStates = new WeakMap();
    this.shellRefits = new WeakMap();
    this.resizeFrameId = null;
  }

  destroy() {
    this.destroyAllShells();
    this.resizeObservers.forEach((observer) => observer.disconnect());
    this.resizeObservers.clear();
    this.maximizedRoots.forEach((root) => root.remove());
    this.maximizedRoots.clear();
    if (this.resizeFrameId) {
      this.window.cancelAnimationFrame(this.resizeFrameId);
      this.resizeFrameId = null;
    }
    this.activeMaximizedShell = null;
  }

  destroyAllShells() {
    this.resizeObservers.forEach((observer) => observer.disconnect());
    this.resizeObservers.clear();
    this.activeMaximizedShell = null;
    this.document.body.classList.remove('mermaid-maximized-open', 'plantuml-maximized-open');
  }

  destroyShell(shell) {
    this.shellControllers.get(shell)?.destroy?.();
    this.shellControllers.delete(shell);
    this.shellViewStates.delete(shell);
    this.shellRefits.delete(shell);
    if (this.activeMaximizedShell === shell) {
      this.restoreShellMount(shell);
      this.activeMaximizedShell = null;
    }
    this.syncBodyMaximizedClasses();
  }

  captureShellViewState(shell) {
    const viewState = this.shellControllers.get(shell)?.getViewState?.() ?? null;
    if (viewState) {
      this.shellViewStates.set(shell, viewState);
    }
    return viewState;
  }

  getShellViewState(shell) {
    return this.shellViewStates.get(shell)
      ?? this.shellControllers.get(shell)?.getViewState?.()
      ?? null;
  }

  cancelActiveShell(kind) {
    const activeShell = this.syncActiveShell();
    if (!activeShell?.classList?.contains(`${kind}-shell`)) {
      return;
    }

    const controller = this.shellControllers.get(activeShell);
    this.restoreShellMount(activeShell);
    activeShell.classList.remove('is-maximized');
    this.activeMaximizedShell = null;
    controller?.syncMaximizeButtonState?.();
    controller?.scheduleResetZoomToFit?.({ force: true });
    this.syncBodyMaximizedClasses();
  }

  clearActiveShell() {
    this.activeMaximizedShell = null;
    this.maximizedRoots.forEach((root) => {
      if (root.childElementCount === 0) {
        root.hidden = true;
      }
    });
    this.document.body.classList.remove('mermaid-maximized-open', 'plantuml-maximized-open');
  }

  syncActiveShell() {
    if (
      this.activeMaximizedShell?.isConnected
      && this.activeMaximizedShell.classList.contains('is-maximized')
    ) {
      return this.activeMaximizedShell;
    }

    this.activeMaximizedShell = null;
    this.maximizedRoots.forEach((root) => {
      if (root.childElementCount === 0) {
        root.hidden = true;
      }
    });
    return null;
  }

  scheduleActiveRefit({ kind = null, root = null } = {}) {
    const activeShell = this.syncActiveShell();
    if (activeShell) {
      this.shellRefits.get(activeShell)?.({ force: true });
      return;
    }

    const selector = kind
      ? `.${kind}-shell[data-${kind}-hydrated="true"]`
      : '.mermaid-shell[data-mermaid-hydrated="true"], .plantuml-shell[data-plantuml-hydrated="true"]';
    Array.from(root?.querySelectorAll?.(selector) ?? []).forEach((shell) => {
      this.shellRefits.get(shell)?.();
    });
  }

  scheduleActiveRefitOnNextFrame() {
    if (this.resizeFrameId) {
      this.window.cancelAnimationFrame(this.resizeFrameId);
    }

    this.resizeFrameId = this.window.requestAnimationFrame(() => {
      this.resizeFrameId = null;
      this.scheduleActiveRefit();
    });
  }

  ensureMaximizedRoot(kind) {
    const config = getKindConfig(kind);
    const existing = this.maximizedRoots.get(kind);
    if (existing?.isConnected && existing.parentElement === this.document.body) {
      return existing;
    }

    let root = this.document.body.querySelector(`[data-${kind}-maximized-root="true"]`);
    if (!root) {
      root = this.document.createElement('div');
      root.dataset[config.maximizedRootDatasetKey] = 'true';
      root.className = config.maximizedRootClassName;
      this.document.body.appendChild(root);
    }

    this.maximizedRoots.set(kind, root);
    return root;
  }

  mountShellInMaximizedRoot(shell, kind) {
    const root = this.ensureMaximizedRoot(kind);
    root.hidden = false;
    shell._diagramChromeRestoreParent = shell.parentElement || null;
    shell._diagramChromeRestoreNextSibling = shell.nextSibling || null;
    root.appendChild(shell);
  }

  restoreShellMount(shell) {
    if (!shell) {
      return;
    }

    const restoreParent = shell._diagramChromeRestoreParent;
    const restoreNextSibling = shell._diagramChromeRestoreNextSibling;
    if (restoreParent?.isConnected) {
      if (restoreNextSibling?.parentElement === restoreParent) {
        restoreParent.insertBefore(shell, restoreNextSibling);
      } else {
        restoreParent.appendChild(shell);
      }
    }

    shell._diagramChromeRestoreParent = null;
    shell._diagramChromeRestoreNextSibling = null;

    this.maximizedRoots.forEach((root) => {
      if (root.childElementCount === 0) {
        root.hidden = true;
      }
    });
  }

  syncBodyMaximizedClasses() {
    const activeShell = this.syncActiveShell();
    for (const [kind, config] of Object.entries(DIAGRAM_CHROME_KIND_CONFIG)) {
      this.document.body.classList.toggle(
        config.bodyClassName,
        Boolean(activeShell?.classList?.contains(`${kind}-shell`)),
      );
    }
  }

  createButton(kind, label, ariaLabel, { icon = '' } = {}) {
    const config = getKindConfig(kind);
    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = config.buttonClassName;
    button.setAttribute('aria-label', ariaLabel);
    button.title = ariaLabel;
    if (icon) {
      setDiagramActionButtonIcon(button, icon);
    } else {
      button.textContent = label;
    }
    return button;
  }

  createToolbar({
    kind,
    includeReload = false,
  }) {
    const config = getKindConfig(kind);
    const toolbar = this.document.createElement('div');
    toolbar.className = config.toolbarClassName;
    const leftGroup = this.document.createElement('div');
    leftGroup.className = 'diagram-preview-toolbar-group diagram-preview-toolbar-group--zoom';
    const rightGroup = this.document.createElement('div');
    rightGroup.className = 'diagram-preview-toolbar-group diagram-preview-toolbar-group--actions';

    const decreaseButton = this.createButton(kind, '-', 'Zoom out');
    decreaseButton.textContent = '−';
    const increaseButton = this.createButton(kind, '+', 'Zoom in');
    const resetButton = this.createButton(kind, '', 'Reset zoom', { icon: 'fit' });
    const copyButton = this.createButton(kind, '', 'Copy image', { icon: 'copy' });
    const downloadButton = this.createButton(kind, '', 'Download SVG', { icon: 'download' });
    const reloadButton = includeReload
      ? this.createButton(kind, '', 'Reload diagram', { icon: 'refresh' })
      : null;
    const maximizeButton = this.createButton(kind, '', 'Maximize diagram', { icon: 'maximize' });
    maximizeButton.classList.add(config.maximizeButtonClassName);
    const zoomLabel = this.document.createElement('span');
    zoomLabel.className = config.zoomLabelClassName;
    zoomLabel.setAttribute('aria-live', 'polite');

    leftGroup.append(decreaseButton, zoomLabel, resetButton, increaseButton);
    rightGroup.append(copyButton, downloadButton);
    if (reloadButton) {
      rightGroup.append(reloadButton);
    }
    rightGroup.append(maximizeButton);
    toolbar.append(leftGroup, rightGroup);

    return {
      copyButton,
      decreaseButton,
      downloadButton,
      increaseButton,
      maximizeButton,
      reloadButton,
      resetButton,
      toolbar,
      zoomLabel,
    };
  }

  attachShellResizeObserver(shell, frame, onResize) {
    if (typeof ResizeObserver !== 'function' || !shell?.isConnected || !(frame instanceof HTMLElement)) {
      return null;
    }

    const observer = new ResizeObserver(() => onResize());
    observer.observe(frame);
    observer.observe(shell);
    this.resizeObservers.add(observer);
    return observer;
  }

  async copyExportImage(exportSvgMarkup, exportFileNames) {
    try {
      const { pngFileName } = exportFileNames();
      const pngBlob = await rasterizeSvgMarkupToPngBlob(await exportSvgMarkup());
      try {
        await writeBlobToClipboard(pngBlob);
        this.toastController?.show?.('Diagram copied');
      } catch {
        downloadBlob(pngBlob, pngFileName);
        this.toastController?.show?.('Clipboard image copy is unavailable here. Downloaded PNG instead.');
      }
    } catch {
      this.toastController?.show?.('Failed to copy diagram');
    }
  }

  async downloadExportSvg(exportSvgMarkup, exportFileNames) {
    try {
      const { svgFileName } = exportFileNames();
      const svgBlob = new Blob([await exportSvgMarkup()], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(svgBlob, svgFileName);
      this.toastController?.show?.('Diagram download started');
    } catch {
      this.toastController?.show?.('Failed to download diagram');
    }
  }

  syncMaximizeButtonState(shell, maximizeButton) {
    const isMaximized = shell.classList.contains('is-maximized');
    setDiagramActionButtonIcon(maximizeButton, isMaximized ? 'restore' : 'maximize');
    const label = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
    maximizeButton.setAttribute('aria-label', label);
    maximizeButton.title = label;
  }

  setMaximizedState(shell, kind, maximizeButton, scheduleResetZoomToFit, shouldMaximize) {
    if (shouldMaximize) {
      const activeShell = this.syncActiveShell();
      if (activeShell && activeShell !== shell) {
        const activeController = this.shellControllers.get(activeShell);
        this.restoreShellMount(activeShell);
        activeShell.classList.remove('is-maximized');
        this.activeMaximizedShell = null;
        activeController?.scheduleResetZoomToFit?.({ force: true });
        activeController?.syncMaximizeButtonState?.();
      }

      this.mountShellInMaximizedRoot(shell, kind);
      shell.classList.add('is-maximized');
      this.activeMaximizedShell = shell;
      this.syncMaximizeButtonState(shell, maximizeButton);
      this.syncBodyMaximizedClasses();
      scheduleResetZoomToFit({ force: true });
      return;
    }

    this.restoreShellMount(shell);
    shell.classList.remove('is-maximized');
    if (this.activeMaximizedShell === shell) {
      this.activeMaximizedShell = null;
    }
    this.syncMaximizeButtonState(shell, maximizeButton);
    this.syncBodyMaximizedClasses();
    scheduleResetZoomToFit({ force: true });
  }

  mount(shell, {
    baseHeight,
    baseWidth,
    diagramElement,
    exportFileNames,
    exportSvgMarkup,
    kind,
    onReload = null,
    sourceSelector,
  } = {}) {
    if (!shell?.isConnected || !isSvgElement(diagramElement)) {
      return null;
    }

    const config = getKindConfig(kind);
    const zoomPolicy = getKindZoomPolicy(kind);
    const previousFrame = shell.querySelector(config.frameClassName.split(' ').map((name) => `.${name}`).join(''));
    const previousViewportWidth = previousFrame ? getFrameViewportSize(previousFrame).width : 0;
    const previousViewState = this.getShellViewState(shell);
    this.destroyShell(shell);
    const {
      copyButton,
      decreaseButton,
      downloadButton,
      increaseButton,
      maximizeButton,
      reloadButton,
      resetButton,
      toolbar,
      zoomLabel,
    } = this.createToolbar({
      includeReload: typeof onReload === 'function',
      kind,
    });
    const frame = this.document.createElement('div');
    frame.className = config.frameClassName;
    const shouldRestoreScrollPosition = Boolean(
      previousViewState
      && (previousViewState.scrollLeft > 0 || previousViewState.scrollTop > 0)
    );
    const shouldStageReplacement = Boolean(
      shouldRestoreScrollPosition
      && previousFrame?.isConnected
      && previousFrame.clientWidth > 0
      && previousFrame.clientHeight > 0
    );
    const shouldRestoreShellPosition = Boolean(
      shouldStageReplacement
      && !shell.classList.contains('is-maximized')
      && !shell.style.position
    );
    if (shouldRestoreShellPosition) {
      shell.style.position = 'relative';
    }
    if (shouldRestoreScrollPosition && !shouldStageReplacement) {
      frame.style.visibility = 'hidden';
    }
    if (shouldStageReplacement) {
      Object.assign(frame.style, {
        height: `${previousFrame.clientHeight}px`,
        left: '0',
        pointerEvents: 'none',
        position: 'absolute',
        top: '0',
        visibility: 'hidden',
        width: `${previousFrame.clientWidth}px`,
      });
    }

    let currentZoom = zoomPolicy.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let resetZoomFrameId = null;
    let layoutFrameId = null;
    let replacementFrameId = null;
    let hasManualZoom = Boolean(
      previousViewState?.hasManualZoom
      || previousViewState?.scrollLeft > 0
      || previousViewState?.scrollTop > 0,
    );
    const hasInitialViewport = previousViewportWidth > 0 && Number.isFinite(baseWidth) && baseWidth > 0;
    const hasRestorableViewState = Number.isFinite(previousViewState?.zoom);
    let lastAutoFitViewportWidth = hasInitialViewport ? previousViewportWidth : 0;
    let shouldForceScheduledReset = false;
    let isPanning = false;
    let activePointerId = null;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    diagramElement.style.display = 'block';
    diagramElement.style.margin = '0 auto';
    diagramElement.style.maxWidth = 'none';

    const calculateDefaultZoom = () => {
      const viewport = getFrameViewportSize(frame);
      if (!Number.isFinite(baseWidth) || baseWidth <= 0 || viewport.width <= 0) {
        return zoomPolicy.default;
      }

      const fittedZoom = viewport.width / baseWidth;
      if (!Number.isFinite(fittedZoom) || fittedZoom <= 0) {
        return zoomPolicy.default;
      }

      return clamp(fittedZoom, zoomPolicy.min, zoomPolicy.fitMax);
    };

    const applyZoom = (nextZoom) => {
      currentZoom = clamp(nextZoom, zoomPolicy.min, zoomPolicy.max);
      diagramElement.style.width = `${baseWidth * currentZoom}px`;
      diagramElement.style.height = `${baseHeight * currentZoom}px`;

      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
      decreaseButton.disabled = currentZoom <= zoomPolicy.min;
      increaseButton.disabled = currentZoom >= zoomPolicy.max;

      const viewport = getFrameViewportSize(frame);
      const isPannable = (baseWidth * currentZoom) > viewport.width || (baseHeight * currentZoom) > viewport.height;
      frame.classList.toggle('is-pannable', isPannable);
      diagramElement.style.margin = isPannable ? '0' : '0 auto';
    };

    // ponytail: size from the current viewport for the first paint; hidden shells refit later.
    const initialZoom = hasRestorableViewState
      ? clamp(previousViewState.zoom, zoomPolicy.min, zoomPolicy.max)
      : hasInitialViewport
      ? clamp(previousViewportWidth / baseWidth, zoomPolicy.min, zoomPolicy.fitMax)
      : zoomPolicy.default;
    applyZoom(initialZoom);

    const getViewportCenter = () => ({
      x: frame.scrollLeft + (frame.clientWidth / 2),
      y: frame.scrollTop + (frame.clientHeight / 2),
    });

    const restoreViewportCenter = (previousZoom, nextZoom, center) => {
      if (previousZoom === 0) {
        return;
      }

      const scale = nextZoom / previousZoom;
      frame.scrollLeft = (center.x * scale) - (frame.clientWidth / 2);
      frame.scrollTop = (center.y * scale) - (frame.clientHeight / 2);
    };

    const animateZoomTo = (nextZoom) => {
      const targetZoom = clamp(nextZoom, zoomPolicy.min, zoomPolicy.max);
      const startZoom = currentZoom;
      if (targetZoom === startZoom) {
        return;
      }

      const center = getViewportCenter();
      const startedAt = performance.now();
      if (zoomAnimationFrameId) {
        this.window.cancelAnimationFrame(zoomAnimationFrameId);
      }

      const tick = (now) => {
        const progress = clamp((now - startedAt) / zoomPolicy.animationDurationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        const animatedZoom = startZoom + ((targetZoom - startZoom) * easedProgress);
        applyZoom(animatedZoom);
        restoreViewportCenter(startZoom, animatedZoom, center);

        if (progress < 1) {
          zoomAnimationFrameId = this.window.requestAnimationFrame(tick);
          return;
        }

        zoomAnimationFrameId = null;
        applyZoom(targetZoom);
        restoreViewportCenter(startZoom, targetZoom, center);
      };

      zoomAnimationFrameId = this.window.requestAnimationFrame(tick);
    };

    const zoomBy = (delta) => {
      hasManualZoom = true;
      animateZoomTo(currentZoom + delta);
    };

    const resetZoomToFit = ({ animate = false } = {}) => {
      defaultZoom = calculateDefaultZoom();
      hasManualZoom = false;
      lastAutoFitViewportWidth = getFrameViewportSize(frame).width;

      if (animate && Math.abs(defaultZoom - currentZoom) > 0.001) {
        animateZoomTo(defaultZoom);
        return;
      }

      if (zoomAnimationFrameId) {
        this.window.cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      applyZoom(defaultZoom);
      frame.scrollLeft = 0;
      frame.scrollTop = 0;
    };

    const scheduleResetZoomToFit = ({ force = false } = {}) => {
      shouldForceScheduledReset = shouldForceScheduledReset || force;
      if (resetZoomFrameId) {
        this.window.cancelAnimationFrame(resetZoomFrameId);
      }
      if (layoutFrameId) {
        this.window.cancelAnimationFrame(layoutFrameId);
      }

      resetZoomFrameId = this.window.requestAnimationFrame(() => {
        layoutFrameId = this.window.requestAnimationFrame(() => {
          layoutFrameId = this.window.requestAnimationFrame(() => {
            layoutFrameId = null;
            resetZoomFrameId = null;
            if (!shell.isConnected) {
              return;
            }

            const shouldForce = shouldForceScheduledReset;
            shouldForceScheduledReset = false;
            const viewportWidth = getFrameViewportSize(frame).width;
            const viewportChanged = Math.abs(viewportWidth - lastAutoFitViewportWidth) > 1;
            if (!shouldForce && hasManualZoom) {
              return;
            }
            if (!shouldForce && viewportWidth > 0 && lastAutoFitViewportWidth > 0 && !viewportChanged) {
              return;
            }

            resetZoomToFit();
          });
        });
      });
    };

    const resizeObserver = this.attachShellResizeObserver(shell, frame, () => scheduleResetZoomToFit());

    decreaseButton.addEventListener('click', () => zoomBy(-zoomPolicy.step));
    increaseButton.addEventListener('click', () => zoomBy(zoomPolicy.step));
    resetButton.addEventListener('click', () => {
      scheduleResetZoomToFit({ force: true });
    });
    copyButton.addEventListener('click', () => this.copyExportImage(exportSvgMarkup, exportFileNames));
    downloadButton.addEventListener('click', () => this.downloadExportSvg(exportSvgMarkup, exportFileNames));
    reloadButton?.addEventListener('click', () => onReload());
    maximizeButton.addEventListener('click', () => {
      this.setMaximizedState(
        shell,
        kind,
        maximizeButton,
        scheduleResetZoomToFit,
        !shell.classList.contains('is-maximized'),
      );
    });

    const stopPanning = () => {
      if (!isPanning) {
        return;
      }

      isPanning = false;
      frame.classList.remove('is-dragging');
      this.window.removeEventListener('pointerup', stopPanning, true);
      this.window.removeEventListener('pointercancel', stopPanning, true);
      this.window.removeEventListener('mouseup', stopPanning, true);
      this.window.removeEventListener('touchend', stopPanning, true);
      this.window.removeEventListener('touchcancel', stopPanning, true);
      this.window.removeEventListener('blur', stopPanning, true);

      if (activePointerId !== null && typeof frame.releasePointerCapture === 'function') {
        try {
          frame.releasePointerCapture(activePointerId);
        } catch {
          // Ignore capture release issues during drag end.
        }
      }

      activePointerId = null;
    };

    frame.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !frame.classList.contains('is-pannable')) {
        return;
      }

      if (zoomAnimationFrameId) {
        this.window.cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      isPanning = true;
      activePointerId = event.pointerId;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartScrollLeft = frame.scrollLeft;
      panStartScrollTop = frame.scrollTop;

      frame.classList.add('is-dragging');
      this.window.addEventListener('pointerup', stopPanning, true);
      this.window.addEventListener('pointercancel', stopPanning, true);
      this.window.addEventListener('mouseup', stopPanning, true);
      this.window.addEventListener('touchend', stopPanning, true);
      this.window.addEventListener('touchcancel', stopPanning, true);
      this.window.addEventListener('blur', stopPanning, true);
      if (typeof frame.setPointerCapture === 'function') {
        try {
          frame.setPointerCapture(event.pointerId);
        } catch {
          // Safari can reject pointer capture during rapid layout transitions.
        }
      }
      event.preventDefault();
    });

    frame.addEventListener('pointermove', (event) => {
      if (!isPanning) {
        return;
      }

      frame.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
      frame.scrollTop = panStartScrollTop - (event.clientY - panStartY);
    });

    frame.addEventListener('pointerup', stopPanning);
    frame.addEventListener('pointercancel', stopPanning);
    frame.addEventListener('lostpointercapture', stopPanning);
    frame.addEventListener('mouseleave', stopPanning);
    frame.addEventListener('mouseup', stopPanning);
    frame.addEventListener('touchend', stopPanning);
    frame.addEventListener('touchcancel', stopPanning);

    frame.appendChild(diagramElement);
    const sourceNode = sourceSelector ? shell.querySelector(sourceSelector) : null;
    const nextChildren = sourceNode ? [sourceNode, toolbar, frame] : [toolbar, frame];
    if (sourceNode) {
      sourceNode.hidden = true;
    }
    if (shouldStageReplacement) {
      shell.append(frame);
    } else {
      shell.replaceChildren(...nextChildren);
    }
    applyZoom(initialZoom);

    const restoreScrollPosition = () => {
      const maxScrollLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
      const maxScrollTop = Math.max(0, frame.scrollHeight - frame.clientHeight);
      const scrollLeft = clamp(previousViewState.scrollLeft ?? 0, 0, maxScrollLeft);
      const scrollTop = clamp(previousViewState.scrollTop ?? 0, 0, maxScrollTop);
      frame.scrollLeft = scrollLeft;
      frame.scrollTop = scrollTop;
      return frame.clientWidth > 0
        && frame.clientHeight > 0
        && frame.scrollLeft === scrollLeft
        && frame.scrollTop === scrollTop;
    };

    if (shouldStageReplacement) {
      restoreScrollPosition();
      replacementFrameId = this.window.requestAnimationFrame(() => {
        replacementFrameId = null;
        shell.replaceChildren(...nextChildren);
        frame.removeAttribute('style');
        if (shouldRestoreShellPosition) {
          shell.style.position = '';
        }
        applyZoom(initialZoom);
        restoreScrollPosition();
      });
    } else if (shouldRestoreScrollPosition) {
      if (!restoreScrollPosition()) {
        this.window.requestAnimationFrame(() => {
          if (frame.isConnected) {
            restoreScrollPosition();
            frame.style.visibility = '';
          }
        });
      } else {
        frame.style.visibility = '';
      }
    }

    const controller = {
      destroy: () => {
        stopPanning();
        if (zoomAnimationFrameId) {
          this.window.cancelAnimationFrame(zoomAnimationFrameId);
        }
        if (resetZoomFrameId) {
          this.window.cancelAnimationFrame(resetZoomFrameId);
        }
        if (layoutFrameId) {
          this.window.cancelAnimationFrame(layoutFrameId);
        }
        if (replacementFrameId) {
          this.window.cancelAnimationFrame(replacementFrameId);
        }
        resizeObserver?.disconnect?.();
        this.resizeObservers.delete(resizeObserver);
      },
      getViewState: () => ({
        hasManualZoom,
        scrollLeft: frame.scrollLeft,
        scrollTop: frame.scrollTop,
        zoom: currentZoom,
      }),
      scheduleResetZoomToFit,
      syncMaximizeButtonState: () => this.syncMaximizeButtonState(shell, maximizeButton),
    };

    this.shellControllers.set(shell, controller);
    this.shellRefits.set(shell, scheduleResetZoomToFit);
    this.syncMaximizeButtonState(shell, maximizeButton);
    if (!hasInitialViewport && !hasRestorableViewState) {
      scheduleResetZoomToFit({ force: true });
    }
    return controller;
  }
}
