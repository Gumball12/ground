import { normalizeGroundDisplayName } from '../../domain/ground-hosted-contract.js';

// Owns Ground's entry DOM, focus and clipboard only. The governance status card
// and the document surface stay owned by GovernanceUiController.
export class GroundEntryController {
  constructor({ clipboard = navigator.clipboard, elements, onCreateDocument, origin }) {
    this.clipboard = clipboard;
    this.elements = elements;
    this.origin = origin;
    this.recoveryUrl = '';

    elements.createDocumentButton?.addEventListener('click', () => onCreateDocument?.());
    elements.recoveryCopyButton?.addEventListener('click', () => {
      void this.#copy(this.recoveryUrl, elements.recoveryLinkInput);
    });
    elements.recoveryCloseButton?.addEventListener('click', () => {
      elements.recoveryDialog?.close?.();
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

  requestDisplayName() {
    const { displayNameDialog, displayNameForm, displayNameInput } = this.elements;
    displayNameDialog?.showModal?.();
    displayNameInput?.focus?.();

    return new Promise((resolve) => {
      const handleSubmit = (event) => {
        const displayName = normalizeGroundDisplayName(displayNameInput?.value ?? '');
        if (!displayName) {
          return;
        }
        event.preventDefault();
        displayNameForm?.removeEventListener('submit', handleSubmit);
        displayNameDialog?.close?.();
        resolve(displayName);
      };
      displayNameForm?.addEventListener('submit', handleSubmit);
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

  // The share link is the canonical document route with no query or fragment.
  copyShareLink(docId) {
    return this.#copy(`${this.origin}/${docId}`, this.elements.recoveryLinkInput);
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
