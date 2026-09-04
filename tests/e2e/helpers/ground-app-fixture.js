import { expect, test as base } from '@playwright/test';

import { startGroundLocalServer } from '../../../scripts/serve-ground-local.mjs';
// Ground reuses the local suite's WebMCP harness and editor probes. Importing
// them runs no filesystem work; the vault helpers only compute paths.
import {
  executeCachedTool,
  executeRegisteredTool,
  getEditorText,
  installModelContextHarness,
  replaceEditorContent,
} from './app-fixture.js';
import {
  attachEvidenceScreenshot,
  attachEvidenceVideo,
  withEvidenceVideo,
} from './evidence-artifacts.js';

export const test = base.extend({
  // Playwright requires an object destructuring pattern for the fixtures
  // argument, and this worker fixture needs none of them.
  // eslint-disable-next-line no-empty-pattern
  groundServer: [async ({}, use) => {
    // A hosted smoke run targets a deployed URL and starts no local server.
    const hostedBaseURL = process.env.GROUND_E2E_BASE_URL;
    if (hostedBaseURL) {
      await use({ baseURL: hostedBaseURL, close: async () => {} });
      return;
    }
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
export const openGroundContext = async (
  browser,
  baseURL,
  displayName,
  { testInfo = null, videoName = null, withModelContext = false } = {},
) => {
  const contextOptions = {
    baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  };
  const context = await browser.newContext(
    videoName && testInfo
      ? withEvidenceVideo(contextOptions, testInfo, videoName)
      : contextOptions,
  );
  const page = await context.newPage();
  // The harness installs through `addInitScript`, so it has to be in place
  // before the first navigation of this page.
  if (withModelContext) {
    await installModelContextHarness(page);
  }
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, displayName, errors, page, video: page.video(), videoName };
};

// A video file is only readable once its context closes, so closing and
// attaching belong together.
export const closeGroundContext = async ({ context, testInfo, video, videoName }) => {
  await context.close();
  await attachEvidenceVideo({ name: videoName, testInfo, video });
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

export const joinGroundDocument = async (browser, baseURL, docId, displayName, options = {}) => {
  const participant = await openGroundContext(browser, baseURL, displayName, options);
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
  // The Owner learns about a new visitor when the document's Activity advances,
  // so the roster has to carry the visitor before the dialog can list them.
  await expect(
    ownerPage.locator('#participantBar [data-participant-session-id]').filter({ hasText: displayName }),
  ).toHaveCount(1);
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

// Sends one operation with the page's own anonymous session, which is how a
// direct API probe reaches the boundary without going through the UI.
export const postGroundOperation = (page, body) => page.evaluate(async (payload) => {
  const stored = Object.keys(localStorage)
    .filter((key) => key.startsWith('sb-'))
    .map((key) => localStorage.getItem(key))[0];
  const response = await fetch('/api/ground', {
    body: JSON.stringify(payload),
    headers: {
      authorization: `Bearer ${JSON.parse(stored).access_token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  });
  return { body: await response.text(), status: response.status };
}, body);

export const waitForGroundTool = async (page, name) => {
  await expect.poll(async () => page.evaluate((toolName) => (
    Boolean(window.__COLLABMD_MODEL_CONTEXT__?.registered?.[toolName])
  ), name), { timeout: 15_000 }).toBe(true);
};

export const readGroundActivity = async (page) => {
  await page.locator('[data-governance-tab="activity"]').click();
  return page.locator('#governanceActivityPanel [data-activity-id]').evaluateAll((rows) => (
    rows.map((row) => ({
      id: row.dataset.activityId,
      text: row.textContent ?? '',
      time: row.querySelector('time')?.getAttribute('datetime') ?? '',
    }))
  ));
};

export {
  attachEvidenceScreenshot,
  executeCachedTool as executeCachedGroundTool,
  executeRegisteredTool as executeGroundTool,
  expect,
  getEditorText as getGroundEditorText,
  replaceEditorContent as replaceGroundEditorContent,
};
