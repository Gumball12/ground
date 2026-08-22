import {
  isBaseFilePath,
  isDiagramFilePath,
  isHtmlFilePath,
  isMarkdownFilePath,
  isStructurizrFilePath,
} from '../../domain/file-kind.js';
import { canFormatDocument } from '../domain/document-formatter.js';
import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

const HTML_PREVIEW_CSP = "default-src 'none'; base-uri about:; form-action 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

function createHtmlPreviewDocument(content, allowScripts = false) {
  const scriptSource = allowScripts ? "'unsafe-inline'" : "'none'";
  return `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}; script-src ${scriptSource};"><base href="about:srcdoc">${String(content ?? '')}`;
}

function hasHtmlScripts(content) {
  const preview = new DOMParser().parseFromString(content, 'text/html');
  if (preview.scripts.length > 0) return true;
  return [...preview.querySelectorAll('*')].some((element) => [...element.attributes].some(({ name, value }) => (
    (name.startsWith('on') && name in element)
    || ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/iu.test(value))
  )));
}

export class WorkspacePreviewController {
  constructor({
    backlinksPanel,
    basesPreview = null,
    drawioEmbed,
    elements,
    excalidrawEmbed,
    getDisplayName,
    getSession,
    isDrawioFile,
    isExcalidrawFile,
    isBaseFile,
    isImageFile,
    isPdfFile,
    isMermaidFile,
    isPlantUmlFile,
    layoutController,
    outlineController,
    previewRenderer,
    pdfPreview = null,
    schedulePreviewLayoutSync,
    scrollSyncController,
    structurizrPreview = null,
    videoEmbed,
  }) {
    this.backlinksPanel = backlinksPanel;
    this.basesPreview = basesPreview ?? { reconcileEmbeds() {}, renderStandalone() {} };
    this.drawioEmbed = drawioEmbed ?? {
      detachForCommit() {},
      hydrateVisibleEmbeds() {},
      reconcileEmbeds() {},
      setHydrationPaused() {},
      syncLayout() {},
      updateLocalUser() {},
      updateTheme() {},
    };
    this.elements = elements;
    this.htmlPreviewShell = null;
    if (this.elements.htmlPreviewMaximizeButton) {
      this.elements.htmlPreviewMaximizeButton.addEventListener('click', () => {
        const isMaximized = this.htmlPreviewShell?.classList.contains('is-maximized');
        this.setHtmlPreviewMaximized(!isMaximized);
      });
      setDiagramActionButtonIcon(this.elements.htmlPreviewMaximizeButton, 'maximize');
    }
    this.excalidrawEmbed = excalidrawEmbed;
    this.getDisplayName = getDisplayName;
    this.getSession = getSession;
    this.isDrawioFile = isDrawioFile ?? (() => false);
    this.isExcalidrawFile = isExcalidrawFile ?? (() => false);
    this.isBaseFile = isBaseFile ?? isBaseFilePath;
    this.isImageFile = isImageFile ?? (() => false);
    this.isPdfFile = isPdfFile ?? (() => false);
    this.isMermaidFile = isMermaidFile ?? (() => false);
    this.isPlantUmlFile = isPlantUmlFile ?? (() => false);
    this.layoutController = layoutController;
    this.outlineController = outlineController;
    this.previewRenderer = previewRenderer;
    this.pdfPreview = pdfPreview ?? { cancel() {}, render() {} };
    this.schedulePreviewLayoutSyncCallback = schedulePreviewLayoutSync;
    this.scrollSyncController = scrollSyncController;
    this.structurizrPreview = structurizrPreview ?? {
      queueSync() {},
      render: async () => false,
      reset() {},
    };
    this.videoEmbed = videoEmbed;
  }

  createDiagramPreviewDocument(language, source = '') {
    const text = String(source ?? '');
    const longestFence = Math.max(...(text.match(/`+/g)?.map((fence) => fence.length) ?? [0]));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    return `${fence}${language}\n${text}\n${fence}`;
  }

  getPreviewSource(filePath, { drawioMode = null } = {}) {
    const source = this.getSession()?.getText() ?? '';
    if (this.isMermaidFile(filePath)) {
      return this.createDiagramPreviewDocument('mermaid', source);
    }

    if (this.isPlantUmlFile(filePath)) {
      return this.createDiagramPreviewDocument('plantuml', source);
    }

    if (this.isDrawioFile(filePath) && drawioMode === 'text') {
      return this.createDiagramPreviewDocument('xml', source);
    }

    return source;
  }

  setHtmlPreviewMaximized(maximized) {
    const isMaximized = Boolean(maximized && this.htmlPreviewShell);
    this.htmlPreviewShell?.classList.toggle('is-maximized', isMaximized);
    globalThis.document?.body?.classList.toggle('html-preview-maximized-open', isMaximized);

    const button = this.elements.htmlPreviewMaximizeButton;
    if (button) {
      setDiagramActionButtonIcon(button, isMaximized ? 'restore' : 'maximize');
      button.title = isMaximized ? 'Restore HTML preview' : 'Maximize HTML preview';
      button.setAttribute('aria-label', button.title);
    }
  }

  resetPreviewMode() {
    this.setHtmlPreviewMaximized(false);
    this.htmlPreviewShell = null;
    this.pdfPreview.cancel();
    this.elements.previewContent?.classList.remove('is-drawio-file-preview');
    this.elements.previewContent?.classList.remove('is-excalidraw-file-preview');
    this.elements.previewContent?.classList.remove('is-base-file-preview');
    this.elements.previewContent?.classList.remove('is-image-file-preview');
    this.elements.previewContent?.classList.remove('is-pdf-file-preview');
    this.elements.previewContent?.classList.remove('is-html-file-preview');
    this.elements.previewContent?.classList.remove('is-mermaid-file-preview');
    this.elements.previewContent?.classList.remove('is-plantuml-file-preview');
    this.elements.previewContent?.classList.remove('is-structurizr-file-preview');
    this.structurizrPreview.reset();
  }

  syncFileChrome(filePath, { drawioMode = null, preferPreviewForBase = false } = {}) {
    const isDrawio = this.isDrawioFile(filePath);
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isBase = this.isBaseFile(filePath);
    const isImage = this.isImageFile(filePath);
    const isPdf = this.isPdfFile(filePath);
    const isHtml = isHtmlFilePath(filePath);
    const isMarkdown = isMarkdownFilePath(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const isStructurizr = isStructurizrFilePath(filePath);
    const isDiagramFile = isDiagramFilePath(filePath);
    const usesHeaderBacklinks = isExcalidraw || (isDrawio && drawioMode !== 'text');

    this.backlinksPanel.setDisplayMode?.(usesHeaderBacklinks ? 'header' : 'dock');

    this.elements.editorFindButton?.classList.toggle('hidden', !isMarkdown);
    this.elements.editorFormatButton?.classList.toggle('hidden', !canFormatDocument(filePath));
    this.elements.markdownToolbar?.classList.toggle('hidden', !isMarkdown);
    this.elements.exportMenuGroup?.classList.toggle('hidden', !isMarkdown);
    this.elements.htmlPreviewMaximizeButton?.classList.toggle('hidden', !isHtml);
    this.elements.outlineToggle?.classList.toggle('hidden', isDiagramFile || isImage || isPdf || isHtml || isBase);
    this.elements.previewContent?.classList.toggle('is-mermaid-file-preview', isMermaid);
    this.elements.previewContent?.classList.toggle('is-plantuml-file-preview', isPlantUml);
    this.elements.previewContent?.classList.toggle('is-structurizr-file-preview', isStructurizr);

    if (isStructurizr) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }

    if ((isDrawio && drawioMode !== 'text') || isExcalidraw || isHtml || isImage || isPdf || (isBase && preferPreviewForBase)) {
      this.layoutController.setView('preview', { persist: false });
      this.outlineController.close();
      this.backlinksPanel.clear();
      return;
    }

    if (isMermaid || isPlantUml) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }
  }

  renderExcalidrawFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-excalidraw-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const placeholder = document.createElement('div');
    placeholder.className = 'excalidraw-embed-placeholder';
    placeholder.dataset.embedKey = `${filePath}#file-preview`;
    placeholder.dataset.embedLabel = this.getDisplayName(filePath);
    placeholder.dataset.embedTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading Excalidraw preview…';
    placeholder.appendChild(loadingShell);
    if (renderHost) {
      renderHost.replaceChildren(placeholder);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.drawioEmbed.reconcileEmbeds(previewElement);
    this.excalidrawEmbed.reconcileEmbeds(previewElement, { isLargeDocument: false });
    this.drawioEmbed.hydrateVisibleEmbeds();
    this.excalidrawEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  renderDrawioFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-drawio-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const placeholder = document.createElement('div');
    placeholder.className = 'drawio-embed-placeholder';
    placeholder.dataset.drawioKey = `${filePath}#file-preview`;
    placeholder.dataset.drawioLabel = this.getDisplayName(filePath);
    placeholder.dataset.drawioMode = 'edit';
    placeholder.dataset.drawioTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading draw.io preview…';
    placeholder.appendChild(loadingShell);

    if (renderHost) {
      renderHost.replaceChildren(placeholder);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.drawioEmbed.reconcileEmbeds(previewElement);
    this.drawioEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  renderImageFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-image-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const shell = document.createElement('figure');
    shell.className = 'image-file-preview-shell';

    const image = document.createElement('img');
    image.className = 'image-file-preview-image';
    image.alt = this.getDisplayName(filePath);
    image.src = resolveApiUrl(`/attachment?path=${encodeURIComponent(filePath)}`);
    shell.appendChild(image);

    if (renderHost) {
      renderHost.replaceChildren(shell);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  renderPdfFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-pdf-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    if (renderHost) {
      this.pdfPreview.render({
        filePath,
        renderHost,
      });
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  renderHtmlFilePreview({ content = '' } = {}) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    const wasMaximized = this.htmlPreviewShell?.classList.contains('is-maximized') ?? false;
    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-html-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const source = String(content ?? '');
    const iframe = document.createElement('iframe');
    iframe.className = 'html-file-preview-frame';
    iframe.title = 'HTML preview';
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    iframe.setAttribute('sandbox', '');
    // ponytail: full iframe replacement resets script consent whenever the content changes.
    iframe.srcdoc = createHtmlPreviewDocument(source);

    const shell = document.createElement('div');
    shell.className = 'html-file-preview-shell';

    if (hasHtmlScripts(source)) {
      const scriptGate = document.createElement('div');
      scriptGate.className = 'html-file-preview-script-gate';
      scriptGate.textContent = 'Scripts are disabled by default. Run them only if you trust this HTML file.';

      const runScriptsButton = document.createElement('button');
      runScriptsButton.type = 'button';
      runScriptsButton.className = 'ui-button ui-button--secondary ui-button--compact';
      runScriptsButton.textContent = 'Run scripts';
      runScriptsButton.addEventListener('click', () => {
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.srcdoc = createHtmlPreviewDocument(source, true);
        scriptGate.remove();
      });
      scriptGate.append(runScriptsButton);
      shell.append(scriptGate);
    }
    shell.append(iframe);
    this.htmlPreviewShell = shell;
    this.setHtmlPreviewMaximized(wasMaximized);

    if (renderHost) {
      renderHost.replaceChildren(shell);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  async renderBaseFilePreview(filePath, { source = null } = {}) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-base-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    if (renderHost) {
      renderHost.style.minHeight = '';
    }

    await this.basesPreview.renderStandalone({
      filePath,
      renderHost,
      source: typeof source === 'string'
        ? source
        : (this.getSession()?.getText?.() ?? null),
    });

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  async renderStructurizrFilePreview(filePath, { source = null } = {}) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-structurizr-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);
    if (renderHost) {
      renderHost.style.minHeight = '';
    }

    await this.structurizrPreview.render({
      filePath,
      renderHost,
      source: typeof source === 'string' ? source : (this.getSession()?.getText?.() ?? ''),
    });

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  renderTextFilePreview({ content = '' } = {}) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.videoEmbed?.detachForCommit();
    this.drawioEmbed.detachForCommit();
    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const shell = document.createElement('div');
    shell.className = 'preview-shell';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = String(content ?? '');
    pre.appendChild(code);
    shell.appendChild(pre);

    if (renderHost) {
      renderHost.replaceChildren(shell);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.close();
    this.backlinksPanel.clear();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.videoEmbed?.reconcileEmbeds(previewElement);
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  createResizeHandler(restoreSidebarState) {
    let resizeTimer = null;
    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        restoreSidebarState?.();
        this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
      }, 100);
    };
  }

  initializePreviewLayoutObserver(onSchedule = () => {}) {
    if (typeof ResizeObserver !== 'function' || !this.elements.previewContent) {
      return null;
    }

    const observer = new ResizeObserver(() => {
      onSchedule();
    });
    observer.observe(this.elements.previewContent);
    return observer;
  }

  schedulePreviewLayoutSync({
    hydrationPaused,
    previewLayoutSyncTimer,
    setPendingPreviewLayoutSync,
    setPreviewLayoutSyncTimer,
    delayMs = 120,
  }) {
    if (hydrationPaused) {
      setPendingPreviewLayoutSync(true);
      return;
    }

    clearTimeout(previewLayoutSyncTimer);

    const nextTimer = setTimeout(() => {
      setPreviewLayoutSyncTimer(null);

      const hasSession = Boolean(this.getSession());
      const isDrawioPreview = this.elements.previewContent?.classList?.contains?.('is-drawio-file-preview') ?? false;
      const isExcalidrawPreview = this.elements.previewContent?.classList?.contains?.('is-excalidraw-file-preview') ?? false;
      if ((!hasSession && !isDrawioPreview && !isExcalidrawPreview) || !this.elements.previewContent) {
        return;
      }

      if (this.elements.previewContent.dataset.renderPhase === 'shell') {
        return;
      }

      if (hydrationPaused) {
        setPendingPreviewLayoutSync(true);
        return;
      }

      this.videoEmbed?.syncLayout();
      this.drawioEmbed.syncLayout();
      this.excalidrawEmbed.syncLayout();
      if ((isDrawioPreview || isExcalidrawPreview) && !hasSession) {
        return;
      }

      this.scrollSyncController.invalidatePreviewBlocks();
      this.scrollSyncController.warmPreviewBlocks({
        onReady: () => {
          if (!this.getSession()) {
            return;
          }

          this.scrollSyncController.realignAfterLayoutChange();
          this.outlineController.scheduleActiveHeadingUpdate();
        },
      });
    }, delayMs);

    setPreviewLayoutSyncTimer(nextTimer);
  }

  handleEditorScrollActivityChange({
    isActive,
    pendingPreviewLayoutSync,
    previewLayoutSyncTimer,
    setHydrationPaused,
    setPendingPreviewLayoutSync,
    setPreviewLayoutSyncTimer,
  }) {
    const nextPaused = Boolean(isActive);
    setHydrationPaused(nextPaused);
    this.previewRenderer.setHydrationPaused(nextPaused);
    this.drawioEmbed.setHydrationPaused(nextPaused);
    this.excalidrawEmbed.setHydrationPaused(nextPaused);

    if (nextPaused) {
      clearTimeout(previewLayoutSyncTimer);
      setPreviewLayoutSyncTimer(null);
      setPendingPreviewLayoutSync(true);
      return;
    }

    if (pendingPreviewLayoutSync) {
      setPendingPreviewLayoutSync(false);
      this.schedulePreviewLayoutSync({
        delayMs: 0,
        hydrationPaused: false,
        previewLayoutSyncTimer: null,
        setPendingPreviewLayoutSync,
        setPreviewLayoutSyncTimer,
      });
    }
  }
}
