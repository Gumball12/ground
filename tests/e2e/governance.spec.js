import { unlink } from 'node:fs/promises';

import {
  assignGovernedRole,
  copyGovernedParticipantSession,
  createGovernedParticipant,
  executeCachedTool,
  executeRegisteredTool,
  expect,
  GOVERNANCE_SESSION_STORAGE_KEY,
  getEditorText,
  installModelContextHarness,
  revokeGovernedRole,
  replaceEditorContent,
  seedStoredUserName,
  test,
  waitForCollaborativeEditor,
} from './helpers/app-fixture.js';

const FORBIDDEN_LEGACY_IDS = [
  'sidebar',
  'toolbarSearchBtn',
  'chatToggleBtn',
  'editorFormatBtn',
  'toggleWrapBtn',
  'markdownToolbar',
  'mobileViewToggle',
  'previewPane',
  'commentsToggle',
  'outlineToggle',
  'toolbarPresence',
  'shareBtn',
];

const isEvidenceRun = (testInfo) => (
  testInfo.project.name === 'governance-evidence'
);

const attachEvidenceScreenshot = async ({ name, page, testInfo }) => {
  if (!isEvidenceRun(testInfo)) {
    return;
  }

  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach(name, {
    contentType: 'image/png',
    path: screenshotPath,
  });
  await unlink(screenshotPath);
};

const withEvidenceVideo = (contextOptions, testInfo, name) => ({
  ...contextOptions,
  ...(isEvidenceRun(testInfo)
    ? { recordVideo: { dir: testInfo.outputPath(`${name}-source`), size: contextOptions.viewport } }
    : {}),
});

const attachEvidenceVideo = async ({ name, testInfo, video }) => {
  if (!isEvidenceRun(testInfo) || !video) {
    return;
  }
  const videoPath = await video.path();
  await testInfo.attach(name, {
    contentType: 'video/webm',
    path: videoPath,
  });
  await unlink(videoPath);
};

const closeManageAccess = async (ownerPage) => {
  const dialog = ownerPage.locator('#manageAccessDialog');
  if (await dialog.evaluate((element) => element.open)) {
    await dialog.getByRole('button', { name: 'Close' }).click();
  }
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

const expectFocusedShellAtNarrowWidth = async (page) => {
  expect(await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 360, scrollWidth: 360 });
  await expect(page.locator(FORBIDDEN_LEGACY_IDS.map((id) => `#${id}`).join(','))).toHaveCount(0);
};

test('Pending AI Reviewer sees only Access status without a credential in the URL', async ({ browser, e2eServer }, testInfo) => {
  const contextOptions = {
    baseURL: e2eServer.baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  };
  const ownerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'owner'));
  const reviewerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'reviewer'));
  const ownerPage = await ownerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  const ownerVideo = ownerPage.video();
  const reviewerVideo = reviewerPage.video();

  try {
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    await expect(ownerPage.locator('[data-self="true"]')).toContainText('Owner');
    await expect(ownerPage.getByRole('button', { name: 'Retry' })).toBeHidden();
    await waitForCollaborativeEditor(ownerPage);
    await createGovernedParticipant(reviewerPage, { displayName: 'AI Reviewer', kind: 'ai' });

    const reviewerSelf = reviewerPage.locator('[data-self="true"]');
    await expect(reviewerSelf).toHaveAttribute('data-grant-state', 'pending');
    await expect(reviewerSelf).toHaveAttribute('data-participant-kind', 'ai');
    await expect(reviewerSelf).toContainText('AI Reviewer');
    await expect(reviewerSelf).toContainText('AI');
    await expect(reviewerPage.locator('#governanceStatusPanel')).toContainText('Waiting for access');
    await expect(reviewerPage.locator('.cm-editor')).toHaveCount(0);
    await expect(reviewerPage.locator('#governanceRail')).toBeHidden();
    await expect(reviewerPage.getByRole('button', { name: 'Manage access' })).toBeHidden();
    await expect(reviewerPage.getByRole('button', { name: 'Retry' })).toBeHidden();
    await expect(reviewerPage.locator('#editorContainer')).not.toContainText('Welcome to the test vault');

    const storedSession = await reviewerPage.evaluate(
      (key) => window.sessionStorage.getItem(key),
      GOVERNANCE_SESSION_STORAGE_KEY,
    );
    const credential = JSON.parse(storedSession).credential;
    const participantUrl = new URL(reviewerPage.url());
    expect([...participantUrl.searchParams]).toEqual([['participantKind', 'ai']]);
    expect(participantUrl.href).not.toContain(credential);

    await attachEvidenceScreenshot({
      name: 'focused-pending',
      page: reviewerPage,
      testInfo,
    });
  } finally {
    await reviewerContext.close();
    await attachEvidenceVideo({ name: 'reviewer-flow', testInfo, video: reviewerVideo });
    await ownerContext.close();
    await attachEvidenceVideo({ name: 'owner-flow', testInfo, video: ownerVideo });
  }
});

test('Owner assigns Editor and Reviewer through Manage access and sees source-labelled Activity', async ({ browser, e2eServer }, testInfo) => {
  const contextOptions = {
    baseURL: e2eServer.baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  };
  const ownerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'owner'));
  const writerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'writer'));
  const reviewerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'reviewer'));
  const ownerPage = await ownerContext.newPage();
  const writerPage = await writerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  const ownerVideo = ownerPage.video();
  const writerVideo = writerPage.video();
  const reviewerVideo = reviewerPage.video();

  try {
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    await waitForCollaborativeEditor(ownerPage);
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'human' });
    const reviewer = await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'ai' });

    await expect.poll(async () => ownerPage.locator('#participantBar [data-participant-session-id]').count()).toBe(3);
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await assignGovernedRole(ownerPage, reviewer.participantSessionId, 'reviewer');

    const dialog = ownerPage.locator('#manageAccessDialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.locator(`[data-participant-session-id="${writer.participantSessionId}"]`)).toContainText('Human · Active');
    await expect(dialog.locator(`[data-participant-session-id="${reviewer.participantSessionId}"]`)).toContainText('AI · Active');
    await attachEvidenceScreenshot({
      name: 'focused-manage-access',
      page: ownerPage,
      testInfo,
    });

    await closeManageAccess(ownerPage);
    await Promise.all([
      waitForCollaborativeEditor(writerPage),
      waitForCollaborativeEditor(reviewerPage),
    ]);
    await expect(ownerPage.locator('.cm-editor')).toHaveCount(1);
    await expect(ownerPage.locator('#participantBar')).toBeVisible();
    await expect(ownerPage.locator('#governanceRail')).toBeVisible();
    await expect(ownerPage.locator('#previewPane')).toHaveCount(0);
    await ownerPage.locator('[data-governance-tab="activity"]').click();
    await expect(ownerPage.locator('#governanceActivityPanel')).toContainText('Source: Access management');
    await attachEvidenceScreenshot({
      name: 'focused-owner-workspace',
      page: ownerPage,
      testInfo,
    });
  } finally {
    await reviewerContext.close();
    await attachEvidenceVideo({ name: 'reviewer-flow', testInfo, video: reviewerVideo });
    await writerContext.close();
    await attachEvidenceVideo({ name: 'writer-flow', testInfo, video: writerVideo });
    await ownerContext.close();
    await attachEvidenceVideo({ name: 'owner-flow', testInfo, video: ownerVideo });
  }
});

test('Writer edits converge, Reviewer proposes, same-location conflicts group, and Owner resolves one', async ({ browser, e2eServer }, testInfo) => {
  const contextOptions = {
    baseURL: e2eServer.baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  };
  const ownerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'owner'));
  const writerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'writer'));
  const reviewerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'reviewer'));
  const ownerPage = await ownerContext.newPage();
  const writerPage = await writerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  const ownerVideo = ownerPage.video();
  const writerVideo = writerPage.video();
  const reviewerVideo = reviewerPage.video();

  try {
    await installModelContextHarness(writerPage);
    await installModelContextHarness(reviewerPage);
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    await waitForCollaborativeEditor(ownerPage);
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'ai' });
    const reviewer = await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'human' });
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await assignGovernedRole(ownerPage, reviewer.participantSessionId, 'reviewer');
    await closeManageAccess(ownerPage);
    await Promise.all([
      waitForCollaborativeEditor(writerPage),
      waitForCollaborativeEditor(reviewerPage),
      waitForRegisteredTool(writerPage, 'collabmd_apply_text_edits'),
      waitForRegisteredTool(reviewerPage, 'collabmd_propose_text_edit'),
    ]);

    const source = '# Launch plan\n\nBudget is $100K.\n\nTarget: seed.\n';
    await replaceEditorContent(ownerPage, source);
    await expect.poll(async () => getEditorText(writerPage)).toBe(source);

    const writerRead = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    const writerEdit = await executeRegisteredTool(writerPage, 'collabmd_apply_text_edits', {
      path: 'README.md',
      replacements: [{ newText: '$110K', oldText: '$100K' }],
      revision: writerRead.revision,
    });
    expect(writerEdit.replacementCount).toBe(1);
    await expect.poll(async () => getEditorText(ownerPage)).toContain('$110K');

    const reviewerRead = await executeRegisteredTool(reviewerPage, 'collabmd_read_active_document');
    const reviewerProposal = await executeRegisteredTool(reviewerPage, 'collabmd_propose_text_edit', {
      newText: '$120K',
      oldText: '$110K',
      path: 'README.md',
      revision: reviewerRead.revision,
    });
    await expect(ownerPage.locator(`[data-proposal-id="${reviewerProposal.id}"]`)).toBeVisible();

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
    await expect.poll(async () => getEditorText(ownerPage)).toBe(
      source.replace('$100K', '$110K').replace('seed', 'live'),
    );
    await expect.poll(async () => hasSameLocationConflictGroup(ownerPage)).toBe(true);

    const contentBeforeMissingTarget = await getEditorText(ownerPage);
    const missingRead = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    const missingConflict = await executeRegisteredTool(writerPage, 'collabmd_apply_text_edits', {
      path: 'README.md',
      replacements: [{ newText: 'Unsafe replacement', oldText: 'Missing source text' }],
      revision: missingRead.revision,
    });
    expect(missingConflict.replacementCount).toBe(0);
    expect(missingConflict.conflictProposals).toHaveLength(1);
    expect(missingConflict.conflictProposals[0].status).toBe('conflict');
    await expect.poll(async () => getEditorText(ownerPage)).toBe(contentBeforeMissingTarget);

    await ownerPage.locator('[data-governance-tab="review"]').click();
    const reviewPanel = ownerPage.locator('#governanceReviewPanel');
    const missingProposalCard = reviewPanel.locator(
      `[data-proposal-id="${missingConflict.conflictProposals[0].id}"]`,
    );
    const unlocatedGroup = reviewPanel.locator('[data-conflict-group][data-unlocated="true"]');
    await expect(unlocatedGroup).toContainText('Unlocated conflicts');
    await expect(missingProposalCard).toBeVisible();
    await expect(unlocatedGroup.locator('[data-proposal-resolution="apply_proposed"]')).toHaveCount(0);
    await missingProposalCard.getByRole('button', { name: 'Keep current' }).click();
    await expect(missingProposalCard).toHaveCount(0);
    await expect.poll(async () => getEditorText(ownerPage)).toBe(contentBeforeMissingTarget);

    await expect(reviewPanel).toContainText('Conflict');
    await reviewPanel.evaluate((panel) => { panel.scrollTop = 36; });
    const conflictGroup = reviewPanel.locator('[data-conflict-group]', {
      has: ownerPage.locator(`[data-proposal-id="${firstTargetProposal.id}"]`),
    }).first();
    const conflictCards = conflictGroup.locator('[data-proposal-id]');
    await expect(conflictCards).toHaveCount(2);
    await expect(conflictGroup).toHaveAttribute('data-unlocated', 'false');
    await expect(conflictGroup.locator('.review-group-title')).toContainText('Location');
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
    await attachEvidenceScreenshot({
      name: 'focused-proposal-conflicts',
      page: ownerPage,
      testInfo,
    });

    const writerReadForProposal = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    const writerProposal = await executeRegisteredTool(writerPage, 'collabmd_propose_text_edit', {
      newText: '$130K',
      oldText: '$110K',
      path: 'README.md',
      revision: writerReadForProposal.revision,
    });
    await expect(ownerPage.locator(`[data-proposal-id="${writerProposal.id}"]`)).toBeVisible();

    ownerPage.once('dialog', (dialog) => dialog.accept());
    await ownerPage.locator(
      `[data-proposal-id="${reviewerProposal.id}"] [data-proposal-resolution="apply_proposed"]`,
    ).click();
    await expect.poll(async () => getEditorText(ownerPage)).toContain('$120K');
    await expect(ownerPage.locator(`[data-proposal-id="${writerProposal.id}"]`)).toContainText('Conflict');
    await ownerPage.locator('[data-governance-tab="activity"]').click();
    await expect(ownerPage.locator('#governanceActivityPanel')).toContainText('Source: Owner decision');
  } finally {
    await reviewerContext.close();
    await attachEvidenceVideo({ name: 'reviewer-flow', testInfo, video: reviewerVideo });
    await writerContext.close();
    await attachEvidenceVideo({ name: 'writer-flow', testInfo, video: writerVideo });
    await ownerContext.close();
    await attachEvidenceVideo({ name: 'owner-flow', testInfo, video: ownerVideo });
  }
});

test('Owner revocation reauthorizes cached Writer apply before Revoked cleanup', async ({ browser, e2eServer }, testInfo) => {
  const contextOptions = {
    baseURL: e2eServer.baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  };
  const ownerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'owner'));
  const writerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'writer'));
  const ownerPage = await ownerContext.newPage();
  const writerPage = await writerContext.newPage();
  const ownerVideo = ownerPage.video();
  const writerVideo = writerPage.video();

  try {
    await writerPage.addInitScript(() => {
      const nativeSetInterval = window.setInterval.bind(window);
      window.setInterval = (handler, timeout, ...args) => nativeSetInterval(
        handler,
        timeout === 1000 ? 60_000 : timeout,
        ...args,
      );
    });
    await installModelContextHarness(writerPage);
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    await waitForCollaborativeEditor(ownerPage);
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'human' });
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await writerPage.reload();
    await waitForCollaborativeEditor(writerPage);
    await waitForRegisteredTool(writerPage, 'collabmd_apply_text_edits');

    const source = '# Revocation evidence\n\nStale document text.\n';
    await replaceEditorContent(writerPage, source);
    await expect.poll(async () => getEditorText(ownerPage)).toBe(source);
    const writerDirectEditActivity = ownerPage
      .locator('#governanceActivityPanel [data-activity-id]')
      .filter({ hasText: 'Writer' })
      .filter({ hasText: 'Direct Edit Applied' });
    await expect(writerDirectEditActivity).toHaveCount(1);
    const document = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    const writerEditor = writerPage.locator('.cm-content');
    await writerEditor.click();
    const governanceRefresh = Promise.withResolvers();
    let delayedRefreshRequested = false;
    await writerPage.route('**/api/governance/session', async (route) => {
      if (route.request().method() === 'GET') {
        delayedRefreshRequested = true;
        await governanceRefresh.promise;
      }
      await route.continue();
    });
    const accessDialog = ownerPage.locator('#manageAccessDialog');
    await expect(accessDialog).toHaveAttribute('open', '');
    const revokeResponsePromise = ownerPage.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes('/api/governance/grants/')
    ));
    ownerPage.once('dialog', (dialog) => dialog.accept());
    await accessDialog
      .locator(`[data-participant-session-id="${writer.participantSessionId}"]`)
      .getByRole('button', { name: 'Revoke access' })
      .click();
    expect((await revokeResponsePromise).status()).toBe(200);
    await expect.poll(() => delayedRefreshRequested).toBe(true);
    await expect(writerPage.locator('[data-governance-connection]')).toHaveText('Disconnected');
    await expect(writerEditor).toHaveAttribute('contenteditable', 'false');
    await expect.poll(async () => getEditorText(writerPage)).toBe(source);
    await writerPage.keyboard.type('Denied');
    await expect.poll(async () => getEditorText(writerPage)).toBe(source);
    await expect.poll(async () => getEditorText(ownerPage)).toBe(source);
    const authorizeResponsePromise = writerPage.waitForResponse((response) => {
      if (!response.url().endsWith('/api/governance/authorize')) {
        return false;
      }
      return response.request().postDataJSON()?.capability === 'document.edit';
    });
    await expect(executeCachedTool(writerPage, 'collabmd_apply_text_edits', {
      path: 'README.md',
      revision: document.revision,
      replacements: [{ newText: 'Denied', oldText: 'Stale' }],
    })).rejects.toThrow(/CAPABILITY_DENIED: Missing document\.edit/);
    const authorizeResponse = await authorizeResponsePromise;
    expect(authorizeResponse.status()).toBe(200);
    expect(await authorizeResponse.json()).toEqual({
      ok: false,
      session: {
        documentPath: 'README.md',
        participantSessionId: writer.participantSessionId,
        state: 'revoked',
      },
    });
    await expect.poll(async () => getEditorText(ownerPage)).toBe(source);

    governanceRefresh.resolve();
    await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'revoked');
    await expect(writerPage.locator('#governanceStatusPanel')).toContainText('Access revoked');
    await expect(writerPage.locator('.cm-editor')).toHaveCount(0);
    await expect(writerPage.locator('#editorContainer')).not.toContainText('Stale document text');
    await expect(writerPage.getByRole('button', { name: 'Manage access' })).toBeHidden();
    await expect(writerDirectEditActivity).toHaveCount(1);
    expect(await writerPage.locator('#toastContainer').textContent())
      .not.toContain('Unsynchronized local changes were discarded.');
    await attachEvidenceScreenshot({
      name: 'focused-revoked',
      page: writerPage,
      testInfo,
    });
  } finally {
    await writerContext.close();
    await attachEvidenceVideo({ name: 'writer-flow', testInfo, video: writerVideo });
    await ownerContext.close();
    await attachEvidenceVideo({ name: 'owner-flow', testInfo, video: ownerVideo });
  }
});

test('focused Owner, Pending, and Revoked shells reflow at 360px without legacy DOM', async ({ browser, e2eServer }, testInfo) => {
  const contextOptions = {
    baseURL: e2eServer.baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 360 },
  };
  const ownerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'owner'));
  const writerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'writer'));
  const reviewerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'reviewer'));
  const ownerPage = await ownerContext.newPage();
  const writerPage = await writerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  const ownerVideo = ownerPage.video();
  const writerVideo = writerPage.video();
  const reviewerVideo = reviewerPage.video();

  try {
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    await waitForCollaborativeEditor(ownerPage);
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'human' });
    await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'ai' });
    await expectFocusedShellAtNarrowWidth(ownerPage);
    await expectFocusedShellAtNarrowWidth(reviewerPage);

    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await closeManageAccess(ownerPage);
    await waitForCollaborativeEditor(writerPage);
    await revokeGovernedRole(ownerPage, writer.participantSessionId);
    await closeManageAccess(ownerPage);
    await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'revoked');
    await expectFocusedShellAtNarrowWidth(writerPage);
  } finally {
    await reviewerContext.close();
    await attachEvidenceVideo({ name: 'reviewer-flow', testInfo, video: reviewerVideo });
    await writerContext.close();
    await attachEvidenceVideo({ name: 'writer-flow', testInfo, video: writerVideo });
    await ownerContext.close();
    await attachEvidenceVideo({ name: 'owner-flow', testInfo, video: ownerVideo });
  }
});

test('duplicate Participant tab can take over without blocking another Participant session', async ({ browser, e2eServer }, testInfo) => {
  const contextOptions = {
    baseURL: e2eServer.baseURL,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    viewport: { height: 720, width: 1280 },
  };
  const ownerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'owner'));
  const writerContext = await browser.newContext(withEvidenceVideo(contextOptions, testInfo, 'writer'));
  const ownerPage = await ownerContext.newPage();
  const writerPage = await writerContext.newPage();
  const duplicatePage = await ownerContext.newPage();
  const ownerVideo = ownerPage.video();
  const writerVideo = writerPage.video();
  const takeoverVideo = duplicatePage.video();

  try {
    await ownerPage.addInitScript(() => {
      window.sessionStorage.setItem('collabmd-tab-id', 'legacy-cloned-tab-id');
    });
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    await waitForCollaborativeEditor(ownerPage);
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'human' });
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await closeManageAccess(ownerPage);
    await waitForCollaborativeEditor(writerPage);

    await copyGovernedParticipantSession(ownerPage, duplicatePage);
    await seedStoredUserName(duplicatePage, 'Owner duplicate');
    await duplicatePage.goto('/#file=README.md');
    await expect(duplicatePage.locator('#tabLockOverlay')).toBeVisible();
    await expect(writerPage.locator('#tabLockOverlay')).toBeHidden();
    await expect(writerPage.locator('.cm-editor')).toBeVisible();

    await duplicatePage.getByRole('button', { name: 'Take over here' }).click();
    await expect(duplicatePage.locator('#tabLockOverlay')).toBeHidden();
    await expect(duplicatePage.locator('.cm-editor')).toBeVisible();
    await expect(ownerPage.locator('#tabLockOverlay')).toBeVisible();
    await expect(ownerPage.locator('#tabLockTitle')).toHaveText('This tab is no longer active');
    await expect(writerPage.locator('#tabLockOverlay')).toBeHidden();
    await expect(writerPage.locator('.cm-editor')).toBeVisible();
  } finally {
    await writerContext.close();
    await attachEvidenceVideo({ name: 'writer-flow', testInfo, video: writerVideo });
    await ownerContext.close();
    await attachEvidenceVideo({ name: 'owner-flow', testInfo, video: ownerVideo });
    await attachEvidenceVideo({ name: 'takeover-flow', testInfo, video: takeoverVideo });
  }
});
