import { expect, test as base } from '@playwright/test';

import { startGroundLocalServer } from '../../../scripts/serve-ground-local.mjs';

export const test = base.extend({
  // Playwright requires an object destructuring pattern for the fixtures
  // argument, and this worker fixture needs none of them.
  // eslint-disable-next-line no-empty-pattern
  groundServer: [async ({}, use) => {
    const server = await startGroundLocalServer();
    try {
      await use(server);
    } finally {
      await server.close();
    }
  }, { scope: 'worker' }],
  baseURL: async ({ groundServer }, use) => {
    await use(groundServer.baseURL);
  },
});

// Each participant is a separate browser context, so each gets its own anonymous
// Supabase identity exactly as a separate person or agent would.
export const openGroundContext = async (browser, baseURL, displayName) => {
  const context = await browser.newContext({
    baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, displayName, errors, page };
};

export const submitGroundDisplayName = async (page, displayName) => {
  const dialog = page.locator('#displayNameDialog');
  await expect(dialog).toHaveAttribute('open', '');
  await page.locator('#displayNameInput').fill(displayName);
  await page.locator('#displayNameSubmit').click();
  await expect(dialog).not.toHaveAttribute('open', '');
};

export const createGroundDocument = async (page, displayName) => {
  await page.goto('/');
  await expect(page.locator('#groundLanding')).toBeVisible();
  await page.locator('#createGroundDocument').click();
  await submitGroundDisplayName(page, displayName);

  const recoveryDialog = page.locator('#groundRecoveryDialog');
  await expect(recoveryDialog).toHaveAttribute('open', '');
  const recoveryUrl = await page.locator('#groundRecoveryLink').inputValue();
  await page.locator('#closeGroundRecovery').click();
  await expect(recoveryDialog).not.toHaveAttribute('open', '');

  const docId = new URL(page.url()).pathname.slice(1);
  return { docId, recoveryUrl };
};

export const joinGroundDocument = async (browser, baseURL, docId, displayName) => {
  const participant = await openGroundContext(browser, baseURL, displayName);
  await participant.page.goto(`/${docId}`);
  await submitGroundDisplayName(participant.page, displayName);
  return participant;
};

export const expectGroundPending = async (page) => {
  await expect(page.locator('#governanceStatusPanel')).toContainText('Waiting for access');
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  await expect(page.locator('#governanceRail')).toBeHidden();
};

export const expectGroundEditor = async (page, { editable }) => {
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', String(editable));
};

// Only an Owner may list participants, so Roles are assigned from the Owner's
// Manage access dialog by the name each visitor submitted.
export const assignGroundRole = async (ownerPage, displayName, roleId) => {
  await ownerPage.locator('#manageAccessBtn').click();
  const dialog = ownerPage.locator('#manageAccessDialog');
  await expect(dialog).toHaveAttribute('open', '');
  const row = dialog.locator('[data-participant-session-id]').filter({ hasText: displayName });
  await expect(row).toHaveCount(1);
  await row.locator('select').selectOption(roleId);
  // A Pending row's submit button reads "Assign role" and an Active row's reads
  // "Update role", so the stable data attribute selects it either way.
  await row.locator('[data-role-submit]').click();
  await expect(row).toContainText('Active');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).not.toHaveAttribute('open', '');
};

export { expect };
