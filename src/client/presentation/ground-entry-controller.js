import { normalizeGroundDisplayName } from '../../domain/ground-hosted-contract.js';

const SHARE_LINK_COPIED = 'Share link copied.';
const SHARE_LINK_COPY_FAILED = 'Copying failed. Copy the share link from the address bar.';

// Owns Ground's entry DOM, focus and clipboard only. The governance status card
// and the document surface stay owned by GovernanceUiController.
export class GroundEntryController {
  constructor({
    clipboard = navigator.clipboard,
    elements,
    notify = () => {},
    onCreateDocument,
    origin,
  }) {
    this.clipboard = clipboard;
    this.elements = elements;
    this.notify = notify;
    this.origin = origin;
    this.recoveryUrl = '';
    this.displayNameRequest = null;

    elements.createDocumentButton?.addEventListener('click', () => onCreateDocument?.());
    elements.recoveryCopyButton?.addEventListener('click', () => {
      void this.#copy(this.recoveryUrl, elements.recoveryLinkInput);
    });
    elements.recoveryCloseButton?.addEventListener('click', () => {
      elements.recoveryDialog?.close?.();
    });
    // Ground always asks for a name before it creates or joins a document, so
    // dismissing the prompt has nothing to fall back to.
    elements.displayNameDialog?.addEventListener('cancel', (event) => event.preventDefault());
    elements.displayNameInput?.addEventListener('input', () => {
      elements.displayNameInput.setCustomValidity('');
    });
  }

  showLanding() {
    this.#setSurface({ landing: true });
  }

  showDocument() {
    this.#setSurface({ share: true });
  }

  showStatus(_accessState) {
    this.#setSurface({});
  }

  showUnavailable() {
    this.#setSurface({ unavailable: true });
  }

  // Concurrent callers share one open prompt, so one submission answers all of
  // them and no submit listener outlives the dialog.
  requestDisplayName() {
    this.displayNameRequest ??= this.#promptDisplayName().finally(() => {
      this.displayNameRequest = null;
    });
    return this.displayNameRequest;
  }

  #promptDisplayName() {
    const { displayNameDialog, displayNameForm, displayNameInput } = this.elements;
    const open = () => {
      displayNameDialog?.showModal?.();
      displayNameInput?.focus?.();
    };

    return new Promise((resolve) => {
      // A browser may close the modal despite the refused cancel, so a close
      // that carries no name reopens the prompt.
      const handleClose = () => open();
      const handleSubmit = (event) => {
        event.preventDefault();
        let displayName;
        try {
          displayName = normalizeGroundDisplayName(displayNameInput?.value ?? '');
        } catch (error) {
          displayNameInput?.setCustomValidity?.(error.message);
          displayNameInput?.reportValidity?.();
          return;
        }
        displayNameForm?.removeEventListener('submit', handleSubmit);
        displayNameDialog?.removeEventListener('close', handleClose);
        displayNameDialog?.close?.();
        resolve(displayName);
      };
      displayNameForm?.addEventListener('submit', handleSubmit);
      displayNameDialog?.addEventListener('close', handleClose);
      open();
    });
  }

  showRecoveryLink(url) {
    const { recoveryCopyButton, recoveryDialog, recoveryLinkInput } = this.elements;
    this.recoveryUrl = url;
    if (recoveryLinkInput) {
      recoveryLinkInput.value = url;
    }
    recoveryDialog?.showModal?.();
    recoveryCopyButton?.focus?.();
  }

  // The share link is the canonical document route with no query or fragment. It
  // is also the address the page already shows, so a failed copy points there
  // rather than at the readonly field inside the closed recovery dialog.
  async copyShareLink(docId) {
    try {
      await this.clipboard.writeText(`${this.origin}/${docId}`);
      this.notify(SHARE_LINK_COPIED);
    } catch {
      this.notify(SHARE_LINK_COPY_FAILED);
    }
  }

  async #copy(value, fallbackInput) {
    try {
      await this.clipboard.writeText(value);
    } catch {
      if (fallbackInput) {
        fallbackInput.value = value;
        fallbackInput.focus();
        fallbackInput.setSelectionRange(0, value.length);
      }
    }
  }

  #setSurface({ landing = false, share = false, unavailable = false }) {
    const { groundLanding, groundUnavailable, shareButton } = this.elements;
    if (groundLanding) {
      groundLanding.hidden = !landing;
    }
    if (groundUnavailable) {
      groundUnavailable.hidden = !unavailable;
    }
    if (shareButton) {
      shareButton.hidden = !share;
    }
  }
}
