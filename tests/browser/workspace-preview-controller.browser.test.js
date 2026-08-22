import { afterEach, expect, it } from 'vitest';

import { WorkspacePreviewController } from '../../src/client/application/workspace-preview-controller.js';

afterEach(() => {
  document.body.className = '';
});

it('renders interactive HTML in an isolated network-blocked sandbox', () => {
  const previewContent = document.createElement('div');
  const renderHost = document.createElement('div');
  const embed = { detachForCommit() {} };
  const controller = new WorkspacePreviewController({
    backlinksPanel: { clear() {} },
    drawioEmbed: embed,
    elements: { previewContent },
    excalidrawEmbed: embed,
    getDisplayName: (filePath) => filePath,
    getSession: () => null,
    layoutController: {},
    outlineController: { close() {} },
    previewRenderer: {
      ensureRenderHost: () => renderHost,
      normalizePreviewChildren() {},
    },
    schedulePreviewLayoutSync() {},
    scrollSyncController: {
      invalidatePreviewBlocks() {},
      setLargeDocumentMode() {},
    },
  });

  controller.renderHtmlFilePreview({ content: '<style>h1{color:red}</style><h1>Hello</h1><script>alert(1)</script>' });

  const shell = renderHost.firstElementChild;
  const iframe = shell.querySelector('iframe');
  expect(shell.className).toBe('html-file-preview-shell');
  expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
  expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
  expect(iframe.referrerPolicy).toBe('no-referrer');
  expect(iframe.getAttribute('allow')).toContain("camera 'none'");
  expect(iframe.srcdoc).toContain("default-src 'none'");
  expect(iframe.srcdoc).toContain("connect-src 'none'");
  expect(iframe.srcdoc).toContain("script-src 'unsafe-inline'");
  expect(iframe.srcdoc).toContain("style-src 'unsafe-inline'");
  expect(iframe.srcdoc).toContain('<h1>Hello</h1>');
  expect(previewContent.dataset.renderPhase).toBe('ready');

  controller.setHtmlPreviewMaximized(true);
  expect(shell.classList.contains('is-maximized')).toBe(true);
  expect(document.body.classList.contains('html-preview-maximized-open')).toBe(true);
  controller.setHtmlPreviewMaximized(false);
  expect(document.body.classList.contains('html-preview-maximized-open')).toBe(false);
});
