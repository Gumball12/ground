import {
  cancelIdleRender,
  IDLE_RENDER_TIMEOUT_MS,
  isNearViewport,
  requestIdleRender,
  shouldPreserveHydratedDiagram,
  syncAttribute,
  getDiagramErrorLocation,
  normalizeDiagramError,
} from './preview-diagram-utils.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

function datasetKeyToAttributeName(datasetKey) {
  return `data-${datasetKey.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

export class DiagramPreviewHydrator {
  constructor(renderer, {
    batchSize,
    datasetKeys,
    fetchFn = null,
    loadFileSource = null,
    filePathLabel,
    requestIdleRenderFn = requestIdleRender,
    cancelIdleRenderFn = cancelIdleRender,
    intersectionObserverFactory = (callback, options) => new IntersectionObserver(callback, options),
    isNearViewportFn = isNearViewport,
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    shellClassName,
    sourceClassName,
  }) {
    this.renderer = renderer;
    this.batchSize = batchSize;
    this.datasetKeys = datasetKeys;
    this.loadFileSource = loadFileSource ?? this.createLegacyFileSourceLoader(fetchFn);
    this.filePathLabel = filePathLabel;
    this.requestIdleRenderFn = requestIdleRenderFn;
    this.cancelIdleRenderFn = cancelIdleRenderFn;
    this.intersectionObserverFactory = intersectionObserverFactory;
    this.isNearViewportFn = isNearViewportFn;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.shellClassName = shellClassName;
    this.sourceClassName = sourceClassName;
    this.shellSelector = `.${shellClassName}`;
    this.sourceSelector = `.${sourceClassName}`;
    this.attributeNames = Object.fromEntries(
      Object.entries(datasetKeys).map(([name, datasetKey]) => [name, datasetKeyToAttributeName(datasetKey)]),
    );

    this.observer = null;
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
    this.hydrationToken = 0;
    this.hydrationRenderVersion = null;
    this.instanceCounter = 0;
    this.preservedShells = new Map();
    this.preservedShellsByLocation = new Map();
    this.fileInflightRequests = new Map();
  }

  createLegacyFileSourceLoader(fetchFn) {
    if (typeof fetchFn !== 'function') {
      return null;
    }

    return async (filePath) => {
      const response = await fetchFn(resolveApiUrl(`/file?path=${encodeURIComponent(filePath)}`));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Failed to load ${this.filePathLabel.toLowerCase()} source`);
      }

      return String(payload?.content ?? '');
    };
  }

  destroy() {
    this.cancelHydration();
    this.clearPreservedShells();
  }

  cancelHydration() {
    this.hydrationToken += 1;
    this.hydrationRenderVersion = null;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
  }

  invalidateHydration() {
    this.hydrationToken += 1;
    this.hydrationRenderVersion = null;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
  }

  cancelPendingIdleWork() {
    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
  }

  clearPreservedShells() {
    this.preservedShells.forEach(({ shell }) => {
      this.renderer.diagramChrome?.destroyShell?.(shell);
    });
    this.preservedShells.clear();
    this.preservedShellsByLocation.clear();
  }

  getPreviewShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return [];
    }

    const documentShells = previewElement.ownerDocument?.querySelectorAll?.(this.shellSelector);
    if (documentShells) {
      return Array.from(documentShells);
    }

    return Array.from(previewElement.querySelectorAll(this.shellSelector));
  }

  getPreservationIdentity(shell) {
    const sourceLine = shell?.getAttribute?.(this.attributeNames.sourceLine);
    // ponytail: source-line identity can miss blocks shifted by earlier edits.
    // Upgrade to persistent block IDs if structural tracking becomes necessary.
    return sourceLine ? `${this.shellClassName}:${sourceLine}` : null;
  }

  isShellRenderable(shell) {
    return this.isShellHydrated(shell) || shell?.getAttribute?.('data-diagram-output') === 'true';
  }

  isShellError(shell) {
    return shell?.getAttribute?.('data-diagram-state') === 'error';
  }

  preserveEntry(entry) {
    this.preservedShells.set(entry.key, entry);
    if (entry.identity) {
      this.preservedShellsByLocation.set(entry.identity, entry);
    }
  }

  removePreservedEntry(entry) {
    if (!entry) {
      return;
    }

    if (this.preservedShells.get(entry.key) === entry) {
      this.preservedShells.delete(entry.key);
    }
    if (entry.identity && this.preservedShellsByLocation.get(entry.identity) === entry) {
      this.preservedShellsByLocation.delete(entry.identity);
    }
  }

  hasPendingWork() {
    return this.hydrationInProgress || this.pendingShells.length > 0;
  }

  preserveHydratedShellsForCommit() {
    this.preservedShells.clear();
    this.preservedShellsByLocation.clear();
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    this.getPreviewShells().filter((shell) => this.isShellRenderable(shell)).forEach((shell) => {
      const key = shell.dataset[this.datasetKeys.key];
      const source = shell.querySelector(this.sourceSelector)?.textContent ?? '';
      const target = shell.dataset[this.datasetKeys.target] ?? '';
      if (!key || (!source && !target)) {
        return;
      }

      if (shell.isConnected) {
        this.renderer.diagramChrome?.captureShellViewState?.(shell);
        shell.remove();
      }

      this.preserveEntry({
        key,
        identity: this.getPreservationIdentity(shell),
        shell,
        source,
        target,
      });
    });
  }

  reconcileHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement || this.preservedShells.size === 0) {
      this.clearPreservedShells();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(previewElement.querySelectorAll(`${this.shellSelector}[${this.attributeNames.key}]`)).forEach((nextShell) => {
      const key = nextShell.dataset[this.datasetKeys.key];
      const preservedEntry = (key ? this.preservedShells.get(key) : null)
        ?? this.preservedShellsByLocation.get(this.getPreservationIdentity(nextShell));
      if (!preservedEntry) {
        return;
      }

      const nextSource = nextShell.querySelector(this.sourceSelector)?.textContent ?? '';
      const nextTarget = nextShell.dataset[this.datasetKeys.target] ?? '';
      const canPreserveCurrentOutput = this.isShellRenderable(preservedEntry.shell)
        && nextSource !== preservedEntry.source
        && !nextTarget;
      if (!shouldPreserveHydratedDiagram({
        nextSource,
        nextTarget,
        preservedSource: preservedEntry.source,
        preservedTarget: preservedEntry.target,
      }) && !canPreserveCurrentOutput) {
        return;
      }

      this.syncPreservedShell(preservedEntry.shell, nextShell, {
        sourceChanged: canPreserveCurrentOutput,
      });
      nextShell.replaceWith(preservedEntry.shell);
      const viewState = this.renderer.diagramChrome?.getShellViewState?.(preservedEntry.shell);
      const frame = preservedEntry.shell.querySelector('.diagram-preview-frame');
      if (viewState && frame) {
        frame.scrollLeft = viewState.scrollLeft ?? 0;
        frame.scrollTop = viewState.scrollTop ?? 0;
      }
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.removePreservedEntry(preservedEntry);
    });

    this.preservedShells.forEach(({ shell }) => {
      this.renderer.diagramChrome?.destroyShell?.(shell);
    });
    this.preservedShells.clear();
    this.preservedShellsByLocation.clear();
    this.handleReconcile({ restoredMaximizedShell });
  }

  handleReconcile() {}

  syncPreservedShell(preservedShell, nextShell, { sourceChanged = false } = {}) {
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceLine);
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceLineEnd);
    syncAttribute(preservedShell, nextShell, this.attributeNames.key);
    syncAttribute(preservedShell, nextShell, this.attributeNames.target);
    syncAttribute(preservedShell, nextShell, this.attributeNames.label);
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceHash);

    preservedShell.classList.add(this.shellClassName);
    this.removeDatasetValue(preservedShell, 'queued');

    const nextSourceNode = nextShell.querySelector(this.sourceSelector);
    let preservedSourceNode = preservedShell.querySelector(this.sourceSelector);

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      const nextSource = nextSourceNode.textContent ?? '';
      if (nextSource || !nextShell.dataset[this.datasetKeys.target]) {
        preservedSourceNode.textContent = nextSource;
      }
      preservedSourceNode.hidden = true;
    }

    if (sourceChanged) {
      this.markShellPending(preservedShell);
      return;
    }

    if (this.isShellError(preservedShell)) {
      preservedShell.dataset[this.datasetKeys.hydrated] = 'true';
      return;
    }

    this.markShellHydrated(preservedShell);
  }

  getShellStatus(shell) {
    const directChildren = Array.from(shell?.children ?? []);
    return directChildren.find((child) => child.classList?.contains('diagram-preview-status'))
      ?? shell?.querySelector?.(':scope > .diagram-preview-status')
      ?? null;
  }

  notifyShellLayoutChange() {
    this.renderer.onPreviewLayoutChange?.({
      renderVersion: this.renderer.activeRenderVersion,
    });
  }

  setShellStatus(shell, state, message = '') {
    if (!shell) {
      return;
    }

    this.getShellStatus(shell)?.remove?.();
    if (state === 'ready') {
      this.notifyShellLayoutChange();
      return;
    }

    const documentRef = shell.ownerDocument ?? globalThis.document;
    if (!documentRef?.createElement) {
      return;
    }

    const status = documentRef.createElement('div');
    status.className = `diagram-preview-status diagram-preview-status--${state}`;
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    status.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');

    const copy = documentRef.createElement('div');
    copy.className = 'diagram-preview-status-copy';

    const title = documentRef.createElement('strong');
    title.textContent = `${this.getShellLabel(shell)} could not render`;
    copy.append(title);

    const subtitle = documentRef.createElement('span');
    subtitle.textContent = 'Showing the last valid result.';
    copy.append(subtitle);

    const location = getDiagramErrorLocation(message);
    if (location) {
      const locationNode = documentRef.createElement('span');
      locationNode.textContent = location;
      copy.append(locationNode);
    }

    const details = documentRef.createElement('details');
    const summary = documentRef.createElement('summary');
    summary.textContent = 'Details';
    const detailMessage = documentRef.createElement('code');
    detailMessage.textContent = message;
    details.append(summary, detailMessage);
    copy.append(details);

    status.append(copy);

    if (state === 'error') {
      const retry = documentRef.createElement('button');
      retry.type = 'button';
      retry.className = 'diagram-preview-retry diagram-preview-placeholder-btn';
      retry.textContent = 'Retry';
      status.append(retry);
    }

    shell.append(status);
    this.notifyShellLayoutChange();
  }

  getShellLabel(shell) {
    return shell?.dataset?.[this.datasetKeys.label] || `${this.filePathLabel} diagram`;
  }

  markShellRendered(shell) {
    if (!shell) {
      return;
    }

    shell.setAttribute('data-diagram-output', 'true');
    shell.removeAttribute('data-diagram-state');
    shell.removeAttribute('aria-busy');
    this.setShellStatus(shell, 'ready');
  }

  markShellPending(shell) {
    if (!this.isShellRenderable(shell)) {
      return false;
    }

    this.removeDatasetValue(shell, 'hydrated');
    shell.setAttribute('data-diagram-output', 'true');
    shell.setAttribute('data-diagram-state', 'pending');
    shell.setAttribute('aria-busy', 'true');
    if (this.getShellStatus(shell)) {
      this.setShellStatus(shell, 'ready');
    }
    return true;
  }

  markShellError(shell, error) {
    if (!this.isShellRenderable(shell)) {
      return false;
    }

    const message = normalizeDiagramError(error);
    shell.dataset[this.datasetKeys.hydrated] = 'true';
    shell.setAttribute('data-diagram-output', 'true');
    shell.setAttribute('data-diagram-state', 'error');
    shell.removeAttribute('aria-busy');
    this.setShellStatus(shell, 'error', message);
    return true;
  }

  clearShellOutput(shell) {
    this.removeDatasetValue(shell, 'hydrated');
    shell?.removeAttribute?.('data-diagram-output');
    shell?.removeAttribute?.('data-diagram-state');
    shell?.removeAttribute?.('aria-busy');
    this.setShellStatus(shell, 'ready');
  }

  markPending() {
    this.invalidateHydration();
    this.getPreviewShells().filter((shell) => this.isShellRenderable(shell)).forEach((shell) => {
      this.markShellPending(shell);
    });
  }

  retryShell(shell) {
    if (!shell?.isConnected) {
      return;
    }

    this.removeDatasetValue(shell, 'hydrated');
    this.markShellPending(shell);
    this.enqueueShell(shell, { prioritize: true });
  }

  isHydrationCurrent(renderVersion, shell, hydrationToken = this.hydrationToken) {
    return Boolean(
      shell?.isConnected
      && hydrationToken === this.hydrationToken
      && (renderVersion == null
        || (renderVersion === this.hydrationRenderVersion
          && renderVersion === this.renderer.activeRenderVersion)),
    );
  }

  setupHydration(renderVersion) {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (!previewElement || !previewContainer) {
      return 0;
    }

    const shells = Array.from(previewElement.querySelectorAll(this.shellSelector));
    if (shells.length === 0) {
      return 0;
    }

    this.hydrationToken += 1;
    const hydrationToken = this.hydrationToken;
    this.hydrationRenderVersion = renderVersion;

    this.observer = this.intersectionObserverFactory((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueueShell(entry.target);
      });
    }, {
      root: previewContainer,
      rootMargin: this.renderer.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.observer.observe(shell));

    this.requestAnimationFrameFn(() => {
      if (!this.isHydrationCurrent(renderVersion, previewElement, hydrationToken)) {
        return;
      }

      this.hydrateVisibleShells();
      this.renderer.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisibleShells() {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (this.renderer.hydrationPaused || !previewElement || !previewContainer) {
      return;
    }

    const margin = this.renderer.isLargeDocument ? 180 : 420;
    Array.from(previewElement.querySelectorAll(this.shellSelector)).forEach((shell) => {
      if (this.isNearViewportFn(shell, previewContainer, margin)) {
        this.enqueueShell(shell, { prioritize: true });
      }
    });
  }

  enqueueShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || this.isShellHydrated(shell) || this.isShellQueued(shell)) {
      return;
    }

    shell.dataset[this.datasetKeys.queued] = 'true';
    if (prioritize) {
      this.pendingShells.unshift(shell);
    } else {
      this.pendingShells.push(shell);
    }

    if (this.renderer.hydrationPaused) {
      return;
    }

    this.renderer.updateHydrationPhase();
    this.scheduleHydration();
  }

  scheduleHydration() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress || this.idleId !== null) {
      return;
    }

    this.idleId = this.requestIdleRenderFn(() => {
      this.idleId = null;
      void this.flushHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushHydrationQueue() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress) {
      return;
    }

    const hydrationToken = this.hydrationToken;
    const renderVersion = this.hydrationRenderVersion;

    const shells = [];
    while (this.pendingShells.length > 0 && shells.length < this.batchSize) {
      const nextShell = this.pendingShells.shift();
      if (!nextShell?.isConnected || this.isShellHydrated(nextShell)) {
        continue;
      }

      this.removeDatasetValue(nextShell, 'queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.renderer.updateHydrationPhase();
      return;
    }

    this.hydrationInProgress = true;
    this.renderer.setPhase('hydrating');

    let batchContext;
    try {
      batchContext = await this.prepareHydrationBatch(shells);
    } catch (error) {
      if (hydrationToken !== this.hydrationToken) {
        return;
      }
      this.handlePrepareHydrationBatchError(shells, error);
      this.hydrationInProgress = false;
      this.renderer.updateHydrationPhase();
      return;
    }

    for (const shell of shells) {
      if (hydrationToken !== this.hydrationToken) {
        return;
      }
      await this.hydrateShell(shell, batchContext, { hydrationToken, renderVersion });
    }

    if (hydrationToken !== this.hydrationToken) {
      return;
    }
    this.hydrationInProgress = false;

    if (this.pendingShells.length > 0) {
      this.scheduleHydration();
    }

    this.renderer.updateHydrationPhase();
  }

  async prepareHydrationBatch() {
    return null;
  }

  handlePrepareHydrationBatchError(_shells, _error) {}

  async hydrateShell() {
    throw new Error('hydrateShell must be implemented by subclasses');
  }

  markShellHydrated(shell) {
    this.markShellRendered(shell);
    shell.dataset[this.datasetKeys.hydrated] = 'true';
    shell.dataset[this.datasetKeys.instanceId] = String(++this.instanceCounter);
  }

  isShellHydrated(shell) {
    return shell?.dataset?.[this.datasetKeys.hydrated] === 'true';
  }

  removeDatasetValue(shell, name) {
    const datasetKey = this.datasetKeys[name];
    if (!datasetKey || !shell) {
      return;
    }

    shell.removeAttribute?.(this.attributeNames[name]);
    if (shell.dataset) {
      delete shell.dataset[datasetKey];
    }
  }

  isShellQueued(shell) {
    return shell?.dataset?.[this.datasetKeys.queued] === 'true';
  }

  async fetchSource(filePath) {
    const target = String(filePath ?? '').trim();
    if (!target) {
      throw new Error(`Missing ${this.filePathLabel} file path`);
    }

    if (this.fileInflightRequests.has(target)) {
      return this.fileInflightRequests.get(target);
    }

    if (typeof this.loadFileSource !== 'function') {
      throw new Error(`Missing ${this.filePathLabel} source loader`);
    }

    const request = this.loadFileSource(target)
      .finally(() => {
        this.fileInflightRequests.delete(target);
      });

    this.fileInflightRequests.set(target, request);
    return request;
  }
}
