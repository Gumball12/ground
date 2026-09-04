import { expect, it } from 'vitest';

import { GroundEntryController } from '../../src/client/presentation/ground-entry-controller.js';

const DOCUMENT_ID = 'AbCdEf0123456789_-xyZA';
const ORIGIN = 'https://ground.test';

const GROUND_MARKUP = `
  <section id="groundLanding" aria-labelledby="groundLandingTitle" hidden>
    <h1 id="groundLandingTitle">One document. Different roles.</h1>
    <button id="createGroundDocument" type="button">Create demo document</button>
  </section>
  <section id="groundUnavailable" aria-labelledby="groundUnavailableTitle" hidden>
    <h1 id="groundUnavailableTitle">This document is unavailable</h1>
  </section>
  <button id="shareGroundDocument" type="button" hidden>Share document</button>
  <dialog id="groundRecoveryDialog" aria-labelledby="groundRecoveryTitle">
    <h2 id="groundRecoveryTitle">Save your Owner recovery link</h2>
    <input id="groundRecoveryLink" readonly aria-label="Owner recovery link">
    <button id="copyGroundRecoveryLink" type="button">Copy recovery link</button>
    <button id="closeGroundRecovery" type="button">Done</button>
  </dialog>
  <dialog id="displayNameDialog" aria-labelledby="displayNameTitle">
    <form id="displayNameForm" method="dialog">
      <h2 id="displayNameTitle">Update display name</h2>
      <input type="text" id="displayNameInput" name="displayName" maxlength="24" required>
      <button type="button" id="displayNameCancel">Cancel</button>
      <button type="submit" id="displayNameSubmit">Save name</button>
    </form>
  </dialog>
`;

const createEntry = ({ clipboard } = {}) => {
  document.body.innerHTML = GROUND_MARKUP;
  const copied = [];
  const created = [];
  const notifications = [];
  const controller = new GroundEntryController({
    clipboard: clipboard ?? {
      writeText: async (value) => {
        copied.push(value);
      },
    },
    elements: {
      createDocumentButton: document.getElementById('createGroundDocument'),
      displayNameDialog: document.getElementById('displayNameDialog'),
      displayNameForm: document.getElementById('displayNameForm'),
      displayNameInput: document.getElementById('displayNameInput'),
      groundLanding: document.getElementById('groundLanding'),
      groundUnavailable: document.getElementById('groundUnavailable'),
      recoveryCloseButton: document.getElementById('closeGroundRecovery'),
      recoveryCopyButton: document.getElementById('copyGroundRecoveryLink'),
      recoveryDialog: document.getElementById('groundRecoveryDialog'),
      recoveryLinkInput: document.getElementById('groundRecoveryLink'),
      shareButton: document.getElementById('shareGroundDocument'),
    },
    notify: (message) => notifications.push(message),
    onCreateDocument: () => created.push(true),
    origin: ORIGIN,
  });
  return { controller, copied, created, notifications };
};

it('shows only the landing surface and reports a create request', () => {
  const { controller, created } = createEntry();

  controller.showLanding();

  expect(document.getElementById('groundLanding').hidden).toBe(false);
  expect(document.getElementById('shareGroundDocument').hidden).toBe(true);
  expect(document.getElementById('groundUnavailable').hidden).toBe(true);

  document.getElementById('createGroundDocument').click();
  expect(created.length).toBe(1);
});

it('shows the Share action only while a document is open', () => {
  const { controller } = createEntry();

  controller.showDocument();

  expect(document.getElementById('shareGroundDocument').hidden).toBe(false);
  expect(document.getElementById('groundLanding').hidden).toBe(true);

  controller.showStatus('pending');
  expect(document.getElementById('shareGroundDocument').hidden).toBe(true);
});

it('shows a status-only unavailable surface', () => {
  const { controller } = createEntry();

  controller.showUnavailable();

  expect(document.getElementById('groundUnavailable').hidden).toBe(false);
  expect(document.getElementById('groundLanding').hidden).toBe(true);
  expect(document.getElementById('shareGroundDocument').hidden).toBe(true);
});

it('copies the canonical share link without a query or fragment and confirms it', async () => {
  const { controller, copied, notifications } = createEntry();

  await controller.copyShareLink(DOCUMENT_ID);

  expect(copied).toEqual([`${ORIGIN}/${DOCUMENT_ID}`]);
  expect(notifications).toEqual(['Share link copied.']);
});

// The share link is the address the page already shows, so a failed copy points
// there instead of at the readonly field inside the closed recovery dialog.
it('points at the address bar when the share link cannot reach the clipboard', async () => {
  const { controller, notifications } = createEntry({
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });

  await controller.copyShareLink(DOCUMENT_ID);

  expect(notifications).toEqual(['Copying failed. Copy the share link from the address bar.']);
  const recoveryInput = document.getElementById('groundRecoveryLink');
  expect(recoveryInput.value).toBe('');
  expect(document.activeElement).not.toBe(recoveryInput);
});

// Ground always asks for a name before it creates or joins, so dismissing the
// prompt has nothing to fall back to: Escape is refused, and a close the
// browser forces anyway reopens the prompt with the request still pending.
it('refuses to dismiss the display name prompt without a name', async () => {
  const { controller } = createEntry();
  const dialog = document.getElementById('displayNameDialog');
  let resolved = null;
  void controller.requestDisplayName().then((name) => {
    resolved = name;
  });

  const cancel = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);

  dialog.close();
  await new Promise((settle) => setTimeout(settle, 0));
  expect(dialog.open).toBe(true);
  expect(resolved).toBe(null);

  // The reopened prompt still answers the original request.
  document.getElementById('displayNameInput').value = 'Owner';
  document.getElementById('displayNameForm').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await new Promise((settle) => setTimeout(settle, 0));
  expect(resolved).toBe('Owner');
  expect(dialog.open).toBe(false);
});

it('keeps the prompt open for a name that is only whitespace', async () => {
  const { controller } = createEntry();
  const dialog = document.getElementById('displayNameDialog');
  const form = document.getElementById('displayNameForm');
  const input = document.getElementById('displayNameInput');
  const requested = controller.requestDisplayName();

  input.value = '   ';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(dialog.open).toBe(true);
  expect(input.validationMessage).not.toBe('');

  input.value = 'Owner';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

  expect(await requested).toBe('Owner');
  expect(dialog.open).toBe(false);
});

// Two callers waiting on the same prompt share it, so one submission answers
// both and no second submit listener survives to resolve a later request twice.
it('shares one open prompt between concurrent display name requests', async () => {
  const { controller } = createEntry();

  const first = controller.requestDisplayName();
  const second = controller.requestDisplayName();

  expect(second).toBe(first);
  document.getElementById('displayNameInput').value = 'Owner';
  document.getElementById('displayNameForm').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  expect(await first).toBe('Owner');

  // A later request opens a fresh prompt rather than reusing the settled one.
  const third = controller.requestDisplayName();
  expect(third).not.toBe(first);
  document.getElementById('displayNameInput').value = 'Again';
  document.getElementById('displayNameForm').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  expect(await third).toBe('Again');
});

it('resolves the display name from the existing dialog form', async () => {
  const { controller } = createEntry();

  const requested = controller.requestDisplayName();
  document.getElementById('displayNameInput').value = 'Reviewer Agent';
  document.getElementById('displayNameForm').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );

  expect(await requested).toBe('Reviewer Agent');
});

it('shows the recovery link once, focuses the copy action, and copies on request', async () => {
  const { controller, copied } = createEntry();
  const url = `${ORIGIN}/${DOCUMENT_ID}#recover=token`;

  controller.showRecoveryLink(url);

  const dialog = document.getElementById('groundRecoveryDialog');
  expect(dialog.open).toBe(true);
  expect(document.getElementById('groundRecoveryLink').value).toBe(url);
  expect(document.activeElement).toBe(document.getElementById('copyGroundRecoveryLink'));

  document.getElementById('copyGroundRecoveryLink').click();
  await Promise.resolve();
  expect(copied).toEqual([url]);

  document.getElementById('closeGroundRecovery').click();
  expect(dialog.open).toBe(false);
});

it('selects the readonly link field when the clipboard is unavailable', async () => {
  const { controller } = createEntry({
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });
  const url = `${ORIGIN}/${DOCUMENT_ID}#recover=token`;
  controller.showRecoveryLink(url);

  document.getElementById('copyGroundRecoveryLink').click();
  await Promise.resolve();
  await Promise.resolve();

  const input = document.getElementById('groundRecoveryLink');
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(url.length);
});
