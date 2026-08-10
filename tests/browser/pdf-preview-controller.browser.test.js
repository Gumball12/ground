import { afterEach, describe, expect, it, vi } from 'vitest';

import { PdfPreviewController } from '../../src/client/application/pdf-preview-controller.js';

const waitForNextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function createPdfViewerApi() {
  return {
    EventBus: class { on() {} dispatch() {} },
    FindState: { FOUND: 0, PENDING: 3 },
    PDFFindController: class { setDocument() {} },
    PDFLinkService: class { setDocument() {} setViewer() {} },
  };
}

describe('PdfPreviewController password handling', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('prompts for a password and retries after an incorrect password', async () => {
    const passwords = [];
    const passwordResponses = {
      INCORRECT_PASSWORD: 2,
      NEED_PASSWORD: 1,
    };
    const pdfDocument = {
      destroy: vi.fn(async () => {}),
      getOutline: vi.fn(async () => []),
      numPages: 0,
    };
    let resolveDocument;
    const documentPromise = new Promise((resolve) => {
      resolveDocument = resolve;
    });
    const loadingTask = {
      destroy: vi.fn(async () => {}),
      onPassword: null,
      promise: documentPromise,
    };
    const requestPassword = (reason) => {
      loadingTask.onPassword((password) => {
        passwords.push(password);
        if (password === 'correct') {
          resolveDocument(pdfDocument);
          return;
        }
        queueMicrotask(() => requestPassword(passwordResponses.INCORRECT_PASSWORD));
      }, reason);
    };
    const getDocument = vi.fn(() => {
      queueMicrotask(() => requestPassword(passwordResponses.NEED_PASSWORD));
      return loadingTask;
    });
    const controller = new PdfPreviewController({
      previewContainer: document.createElement('div'),
    });
    controller.loadPdfJs = async () => ({
      pdfjs: {
        getDocument,
        PasswordResponses: passwordResponses,
      },
      pdfViewer: createPdfViewerApi(),
    });
    const renderHost = document.createElement('div');
    document.body.appendChild(renderHost);

    const renderPromise = controller.render({
      displayName: 'secured',
      filePath: 'secured.pdf',
      renderHost,
    });
    await waitForNextTask();

    const firstPrompt = renderHost.querySelector('.pdf-file-preview-password-prompt');
    expect(firstPrompt).not.toBeNull();
    expect(firstPrompt.querySelector('input[type="password"]')).not.toBeNull();
    expect(firstPrompt).toHaveTextContent('Enter the password to preview this PDF.');

    const firstInput = firstPrompt.querySelector('input[type="password"]');
    firstInput.value = 'wrong';
    firstPrompt.requestSubmit();
    await waitForNextTask();

    const retryPrompt = renderHost.querySelector('.pdf-file-preview-password-prompt');
    expect(retryPrompt).toHaveTextContent('The password was incorrect. Try again.');
    const retryInput = retryPrompt.querySelector('input[type="password"]');
    retryInput.value = 'correct';
    retryPrompt.requestSubmit();

    await renderPromise;

    expect(passwords).toEqual(['wrong', 'correct']);
    expect(renderHost.querySelector('.pdf-file-preview-status')).toHaveTextContent('0 pages');
    controller.cancel();
  });
});
