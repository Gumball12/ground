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
    onCreateDocument: () => created.push(true),
    origin: ORIGIN,
  });
  return { controller, copied, created };
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

it('copies the canonical share link without a query or fragment', async () => {
  const { controller, copied } = createEntry();

  await controller.copyShareLink(DOCUMENT_ID);

  expect(copied).toEqual([`${ORIGIN}/${DOCUMENT_ID}`]);
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
  const url = `${ORIGIN}/${DOCUMENT_ID}?recover=token`;

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
  const url = `${ORIGIN}/${DOCUMENT_ID}?recover=token`;
  controller.showRecoveryLink(url);

  document.getElementById('copyGroundRecoveryLink').click();
  await Promise.resolve();
  await Promise.resolve();

  const input = document.getElementById('groundRecoveryLink');
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(url.length);
});
