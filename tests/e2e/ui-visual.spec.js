import {
  assignGovernedRole,
  createGovernedParticipant,
  executeRegisteredTool,
  expect,
  getEditorText,
  installModelContextHarness,
  revokeGovernedRole,
  replaceEditorContent,
  test,
  waitForCollaborativeEditor,
} from './helpers/app-fixture.js';
import { startTestServer } from '../node/helpers/test-server.js';

const screenshotOptions = {
  animations: 'disabled',
  caret: 'hide',
  fullPage: true,
  maxDiffPixelRatio: 0.015,
};

const waitForRegisteredTool = async (page, name) => {
  await expect.poll(async () => page.evaluate((toolName) => (
    Boolean(window.__COLLABMD_MODEL_CONTEXT__?.registered?.[toolName])
  ), name), { timeout: 15000 }).toBe(true);
};

const hasSameLocationConflictGroup = async (page) => (
  page.locator('#governanceReviewPanel [data-conflict-group]').evaluateAll((groups) => (
    groups.some((group) => (
      group.textContent?.includes('Conflict')
      && group.querySelectorAll('[data-proposal-id]').length === 2
    ))
  ))
);

test.describe('ui visual regression', () => {
  test('matches the focused workspace Owner, access, Proposal, Pending, and Revoked states', async ({ browser, e2eServer }) => {
    const contextOptions = {
      baseURL: e2eServer.baseURL,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      viewport: { height: 720, width: 1280 },
    };
    const ownerContext = await browser.newContext(contextOptions);
    const writerContext = await browser.newContext(contextOptions);
    const reviewerContext = await browser.newContext(contextOptions);
    const ownerPage = await ownerContext.newPage();
    const writerPage = await writerContext.newPage();
    const reviewerPage = await reviewerContext.newPage();

    try {
      await installModelContextHarness(writerPage);
      await installModelContextHarness(reviewerPage);
      await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
      await waitForCollaborativeEditor(ownerPage);
      await expect(ownerPage.locator('.cm-editor')).toHaveCount(1);
      await expect(ownerPage.locator('#participantBar')).toBeVisible();
      await expect(ownerPage.locator('#governanceRail')).toBeVisible();
      await expect(ownerPage.locator('#governanceReviewPanel')).toHaveAccessibleName('Review');
      await ownerPage.locator('#governanceActivityTab').click();
      await expect(ownerPage.locator('#governanceActivityPanel')).toHaveAccessibleName('Activity');
      await ownerPage.locator('#governanceRolesTab').click();
      await expect(ownerPage.locator('#governanceRolesPanel')).toHaveAccessibleName('Roles');
      await ownerPage.locator('#governanceReviewTab').click();
      await expect(ownerPage.locator('#previewPane')).toHaveCount(0);
      await expect.soft(ownerPage).toHaveScreenshot('focused-owner-workspace.png', screenshotOptions);

      const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'ai' });
      const reviewer = await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'human' });
      await expect(reviewerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'pending');
      await expect(reviewerPage.locator('#governanceStatusPanel')).toContainText('Waiting for access');
      await expect(reviewerPage.getByRole('button', { name: 'Manage access' })).toBeHidden();
      await expect.soft(reviewerPage).toHaveScreenshot('focused-pending.png', screenshotOptions);

      await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
      await assignGovernedRole(ownerPage, reviewer.participantSessionId, 'reviewer');
      const dialog = ownerPage.locator('#manageAccessDialog');
      await expect(dialog).toHaveAttribute('open', '');
      await expect(dialog.locator(`[data-participant-session-id="${writer.participantSessionId}"]`)).toContainText('Active');
      await expect(dialog.locator(`[data-participant-session-id="${reviewer.participantSessionId}"]`)).toContainText('Active');
      await expect.soft(ownerPage).toHaveScreenshot('focused-manage-access.png', screenshotOptions);
      await dialog.getByRole('button', { name: 'Close' }).click();

      await Promise.all([
        waitForCollaborativeEditor(writerPage),
        waitForCollaborativeEditor(reviewerPage),
        waitForRegisteredTool(writerPage, 'collabmd_apply_text_edits'),
        waitForRegisteredTool(reviewerPage, 'collabmd_propose_text_edit'),
      ]);
      const source = '# Launch plan\n\nBudget is $100K.\n\nTarget: seed.\n';
      await replaceEditorContent(ownerPage, source);
      await expect.poll(async () => getEditorText(writerPage)).toBe(source);
      await replaceEditorContent(writerPage, source.replace('$100K', '$110K'));
      await expect.poll(async () => getEditorText(ownerPage)).toContain('$110K');
      const reviewerRead = await executeRegisteredTool(reviewerPage, 'collabmd_read_active_document');
      const reviewerProposal = await executeRegisteredTool(reviewerPage, 'collabmd_propose_text_edit', {
        newText: '$120K',
        oldText: '$110K',
        path: 'README.md',
        revision: reviewerRead.revision,
      });
      const firstTargetProposal = await executeRegisteredTool(reviewerPage, 'collabmd_propose_text_edit', {
        newText: 'one',
        oldText: 'seed',
        path: 'README.md',
        revision: reviewerRead.revision,
      });
      const secondTargetProposal = await executeRegisteredTool(reviewerPage, 'collabmd_propose_text_edit', {
        newText: 'two',
        oldText: 'seed',
        path: 'README.md',
        revision: reviewerRead.revision,
      });
      const conflictRead = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
      const targetEdit = await executeRegisteredTool(writerPage, 'collabmd_apply_text_edits', {
        path: 'README.md',
        replacements: [{ newText: 'live', oldText: 'seed' }],
        revision: conflictRead.revision,
      });
      expect(targetEdit.replacementCount).toBe(1);
      await expect.poll(async () => hasSameLocationConflictGroup(ownerPage)).toBe(true);
      await ownerPage.locator('[data-governance-tab="review"]').click();
      await expect(ownerPage.locator('#governanceReviewPanel')).toContainText('Proposal');
      await expect(ownerPage.locator('#governanceReviewPanel')).toContainText('Conflict');
      const reviewPanel = ownerPage.locator('#governanceReviewPanel');
      await reviewPanel.evaluate((panel) => { panel.scrollTop = 36; });
      const conflictGroup = reviewPanel.locator('[data-conflict-group]', {
        has: ownerPage.locator(`[data-proposal-id="${firstTargetProposal.id}"]`),
      }).first();
      const conflictCards = conflictGroup.locator('[data-proposal-id]');
      await expect(conflictCards).toHaveCount(2);
      await expect(conflictGroup).toHaveAttribute('data-unlocated', 'false');
      await expect(reviewPanel.locator(`[data-proposal-id="${firstTargetProposal.id}"]`))
        .toContainText('Current: live');
      await expect(reviewPanel.locator(`[data-proposal-id="${firstTargetProposal.id}"]`))
        .toContainText('Proposed: one');
      await expect(reviewPanel.locator(`[data-proposal-id="${secondTargetProposal.id}"]`))
        .toContainText('Current: live');
      await expect(reviewPanel.locator(`[data-proposal-id="${secondTargetProposal.id}"]`))
        .toContainText('Proposed: two');
      await expect(reviewPanel.locator(`[data-proposal-id="${reviewerProposal.id}"]`))
        .toContainText('Current: $110K');
      await expect(reviewPanel.locator(`[data-proposal-id="${reviewerProposal.id}"]`))
        .toContainText('Proposed: $120K');
      const reviewFrameTargets = [
        conflictGroup.locator('.review-group-title'),
        conflictCards.nth(0),
        conflictCards.nth(1),
        ownerPage.locator(
          `[data-proposal-id="${reviewerProposal.id}"] [data-proposal-resolution="apply_proposed"]`,
        ),
      ];
      await expect.poll(async () => (await Promise.all(reviewFrameTargets.map((target) => (
        target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight;
        })
      )))).every(Boolean)).toBe(true);
      await expect.soft(ownerPage).toHaveScreenshot('focused-proposal-conflicts.png', {
        ...screenshotOptions,
        maxDiffPixelRatio: 0.005,
      });

      await revokeGovernedRole(ownerPage, writer.participantSessionId);
      await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'revoked');
      await expect(writerPage.locator('#governanceStatusPanel')).toContainText('Access revoked');
      await expect(writerPage.locator('.cm-editor')).toHaveCount(0);
      await expect.soft(writerPage).toHaveScreenshot('focused-revoked.png', screenshotOptions);
    } finally {
      await reviewerContext.close();
      await writerContext.close();
      await ownerContext.close();
    }
  });

  test('matches the password auth gate', async ({ page }) => {
    const app = await startTestServer({
      auth: {
        password: 'visual-secret',
        strategy: 'password',
      },
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem('collabmd-theme', 'dark');
        window.localStorage.setItem('collabmd-user-name', 'Audit User');
      });

      await page.goto(`${app.baseUrl}/#file=test.md`);
      await expect(page.locator('.auth-gate-card')).toBeVisible();
      await expect(page).toHaveScreenshot('auth-gate-password.png', screenshotOptions);
    } finally {
      await app.close();
    }
  });
});
