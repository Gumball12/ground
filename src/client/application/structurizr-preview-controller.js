import { resolveAppPath } from '../domain/runtime-paths.js';

const SYNC_DEBOUNCE_MS = 300;

function decodeViewKey(hash = '') {
  const normalized = String(hash ?? '').replace(/^#/, '');
  if (!normalized) {
    return '';
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

export class StructurizrPreviewController {
  constructor({
    enabled = false,
    syncWorkspace,
  }) {
    this.enabled = Boolean(enabled);
    this.syncWorkspace = syncWorkspace;
    this.iframe = null;
    this.shell = null;
    this.status = null;
    this.filePath = null;
    this.viewKey = '';
    this.lastVersion = null;
    this.syncTimer = null;
    this.syncToken = 0;
    this.handleFrameLoad = () => {
      try {
        this.viewKey = decodeViewKey(this.iframe?.contentWindow?.location?.hash || '') || this.viewKey;
        this.iframe?.contentWindow?.addEventListener('hashchange', this.handleFrameHashChange);
      } catch {
        // Cross-origin deployments cannot expose the frame hash; the current route still works.
      }
    };
    this.handleFrameHashChange = () => {
      try {
        this.viewKey = decodeViewKey(this.iframe?.contentWindow?.location?.hash || '') || this.viewKey;
      } catch {
        // Ignore inaccessible frame locations.
      }
    };
  }

  setStatus(message = '', { error = false } = {}) {
    if (!this.status) {
      return;
    }

    this.status.textContent = message;
    this.status.hidden = !message;
    this.status.classList.toggle('is-error', error);
  }

  mount(renderHost, filePath) {
    const fileChanged = Boolean(this.filePath && this.filePath !== filePath);
    if (fileChanged) {
      this.iframe?.contentWindow?.removeEventListener?.('hashchange', this.handleFrameHashChange);
      this.iframe?.removeEventListener('load', this.handleFrameLoad);
      this.iframe?.remove();
      this.iframe = null;
      this.lastVersion = null;
      this.viewKey = '';
    }

    this.filePath = filePath;

    if (this.shell?.isConnected && this.shell.parentElement === renderHost) {
      return;
    }

    this.shell = document.createElement('section');
    this.shell.className = 'structurizr-preview-shell';
    this.shell.dataset.structurizrPreview = 'true';

    this.status = document.createElement('div');
    this.status.className = 'structurizr-preview-status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.shell.appendChild(this.status);

    renderHost?.replaceChildren(this.shell);
    this.iframe = null;
    this.lastVersion = null;
  }

  async render({ filePath, renderHost, source = '' }) {
    this.mount(renderHost, filePath);
    return this.syncNow({ filePath, source: String(source ?? '') });
  }

  queueSync({ filePath, source = '' } = {}) {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow({ filePath, source: String(source ?? '') });
    }, SYNC_DEBOUNCE_MS);
  }

  async syncNow({ filePath, source = '' } = {}) {
    if (filePath !== this.filePath) {
      return false;
    }

    const token = ++this.syncToken;
    if (!this.enabled) {
      this.setStatus('Structurizr preview is not configured. Start CollabMD with --local-structurizr.', { error: true });
      return false;
    }

    this.setStatus('Validating Structurizr workspace…');

    try {
      const payload = await this.syncWorkspace({ path: filePath, source });
      if (token !== this.syncToken || filePath !== this.filePath) {
        return false;
      }

      const nextVersion = payload?.version || null;
      if (!this.iframe || nextVersion !== this.lastVersion) {
        const iframe = this.iframe ?? document.createElement('iframe');
        if (!this.iframe) {
          iframe.className = 'structurizr-preview-iframe';
          iframe.title = 'Structurizr architecture diagram';
          iframe.loading = 'eager';
          iframe.referrerPolicy = 'same-origin';
          iframe.addEventListener('load', this.handleFrameLoad);
          this.iframe = iframe;
          this.shell?.appendChild(iframe);
        }

        const route = resolveAppPath('/workspace/1/diagrams');
        const hash = this.viewKey ? `#${encodeURIComponent(this.viewKey)}` : '';
        iframe.src = `${route}${hash}`;
        this.lastVersion = nextVersion;
      }

      this.setStatus('');
      return true;
    } catch (error) {
      if (token !== this.syncToken || filePath !== this.filePath) {
        return false;
      }

      this.setStatus(error?.message || 'Failed to load Structurizr workspace.', { error: true });
      return false;
    }
  }

  reset() {
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.syncToken += 1;
    this.iframe?.contentWindow?.removeEventListener?.('hashchange', this.handleFrameHashChange);
    this.iframe?.removeEventListener('load', this.handleFrameLoad);
    this.iframe = null;
    this.shell = null;
    this.status = null;
    this.filePath = null;
    this.lastVersion = null;
    this.viewKey = '';
  }
}
