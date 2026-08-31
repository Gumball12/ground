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
  pasteClipboardText,
  revokeGovernedRole,
  replaceEditorContent,
  seedStoredUserName,
  setEditorSelection,
  test,
  waitForCollaborativeEditor,
} from './helpers/app-fixture.js';

const participant = (page, participantSessionId) => page.locator('#participantBar').locator(
  `[data-participant-session-id="${participantSessionId}"]`,
);

const isEvidenceRun = (testInfo) => (
  testInfo.project.name === 'governance-evidence'
);

const primaryShortcut = (key) => (
  `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`
);

const attachEvidenceScreenshot = async ({
  name,
  page,
  testInfo,
}) => {
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

async function waitForRegisteredTool(page, name) {
  await expect.poll(async () => page.evaluate((toolName) => (
    Boolean(window.__COLLABMD_MODEL_CONTEXT__?.registered?.[toolName])
  ), name), { timeout: 15000 }).toBe(true);
}

async function activityCount(page) {
  await page.locator('[data-governance-tab="activity"]').click();
  return page.locator('#governanceActivityPanel [data-activity-id]').count();
}

async function activityIds(page) {
  await page.locator('[data-governance-tab="activity"]').click();
  return page.locator('#governanceActivityPanel [data-activity-id]').evaluateAll((items) => (
    items.map((item) => item.dataset.activityId)
  ));
}

async function activityRecords(page) {
  await page.locator('[data-governance-tab="activity"]').click();
  return page.locator('#governanceActivityPanel [data-activity-id]').evaluateAll((items) => (
    items.map((item) => ({ id: item.dataset.activityId, text: item.textContent }))
  ));
}

async function newOwnerDirectEditIds(page, existingIds) {
  const records = await activityRecords(page);
  return records.filter((record) => (
    !existingIds.includes(record.id)
    && record.text?.includes('Owner')
    && record.text?.includes('Direct Edit Applied')
  )).map((record) => record.id);
}

async function hasSameLocationConflictGroup(page) {
  return page.locator('#governanceReviewPanel [data-conflict-group]').evaluateAll((groups) => (
    groups.some((group) => (
      group.textContent?.includes('Conflict')
      && group.querySelectorAll('[data-proposal-id]').length === 2
    ))
  ));
}

async function editorIsEditable(page) {
  return page.locator('.cm-content').first().getAttribute('contenteditable');
}

async function closeLatestDocumentSocket(sockets) {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('Missing document WebSocket route.');
  }
  await socket.close({ code: 1011, reason: 'E2E connection interruption' });
}

test('public participant kind labels an AI Reviewer without exposing its credential in the URL', async ({ page: ownerPage }, testInfo) => {
  const reviewerPage = await ownerPage.context().newPage();

  try {
    const owner = await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    const reviewer = await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'ai' });
    await assignGovernedRole(ownerPage, reviewer.participantSessionId, 'reviewer');

    const reviewerSelf = reviewerPage.locator('[data-self="true"]');
    await expect(reviewerSelf).toHaveAttribute('data-participant-kind', 'ai');
    await expect(reviewerSelf).toContainText('Reviewer');
    await expect(reviewerSelf).toContainText('AI');

    const storedSession = await reviewerPage.evaluate(
      (key) => window.sessionStorage.getItem(key),
      GOVERNANCE_SESSION_STORAGE_KEY,
    );
    const credential = JSON.parse(storedSession).credential;
    const participantUrl = new URL(reviewerPage.url());
    expect([...participantUrl.searchParams]).toEqual([['participantKind', 'ai']]);
    expect(participantUrl.href).not.toContain(credential);
    await expect.poll(async () => {
      const joined = (await activityRecords(ownerPage)).filter((record) => (
        record.text?.includes('Participant Joined')
      ));
      return {
        count: joined.length,
        owner: joined.some((record) => record.text?.includes(owner.participantSessionId)),
        reviewer: joined.some((record) => record.text?.includes(reviewer.participantSessionId)),
      };
    }).toEqual({ count: 2, owner: true, reviewer: true });
    await attachEvidenceScreenshot({
      name: 'ai-reviewer-role',
      page: reviewerPage,
      testInfo,
    });
  } finally {
    await reviewerPage.close();
  }
});

test('governed access keeps participants isolated through role and revoke transitions', async ({ page: ownerPage }, testInfo) => {
  const writerPage = await ownerPage.context().newPage();
  const reviewerPage = await ownerPage.context().newPage();
  const duplicatePage = await ownerPage.context().newPage();

  try {
    await installModelContextHarness(writerPage);
    const owner = await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'ai' });
    const reviewer = await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'human' });

    await expect.poll(async () => ownerPage.locator('#participantBar [data-participant-session-id]').count()).toBe(3);
    await expect(ownerPage.locator('#participantBar [data-grant-state="active"]')).toHaveCount(1);
    await expect(participant(ownerPage, owner.participantSessionId)).toContainText('Owner');
    await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'pending');
    await expect(reviewerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'pending');

    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'active');
    await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-participant-kind', 'ai');
    await expect(writerPage.locator('[data-self="true"]')).toContainText('AI');
    await expect(writerPage.locator('[data-self="true"]')).toContainText('Editor');
    await waitForCollaborativeEditor(writerPage);

    await assignGovernedRole(ownerPage, reviewer.participantSessionId, 'reviewer');
    await expect(reviewerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'active');
    await expect(reviewerPage.locator('[data-self="true"]')).toContainText('Reviewer');
    await waitForCollaborativeEditor(reviewerPage);

    await expect(ownerPage.locator('#tabLockOverlay')).toBeHidden();
    await expect(writerPage.locator('#tabLockOverlay')).toBeHidden();
    await expect(reviewerPage.locator('#tabLockOverlay')).toBeHidden();

    await copyGovernedParticipantSession(writerPage, duplicatePage);
    await seedStoredUserName(duplicatePage, 'Writer duplicate');
    await duplicatePage.goto('/#file=README.md');
    await expect(duplicatePage.locator('#tabLockOverlay')).toBeVisible();

    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press('Control+End');
    await writerPage.keyboard.type('\nWriter history marker');
    await expect.poll(async () => getEditorText(writerPage)).toContain('Writer history marker');

    await assignGovernedRole(ownerPage, writer.participantSessionId, 'reviewer');
    await expect(writerPage.locator('[data-self="true"]')).toContainText('Reviewer');
    await waitForCollaborativeEditor(writerPage);
    const reviewerText = await getEditorText(writerPage);
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press(primaryShortcut('Z'));
    await expect.poll(async () => getEditorText(writerPage)).toBe(reviewerText);

    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await expect(writerPage.locator('[data-self="true"]')).toContainText('Editor');
    await waitForCollaborativeEditor(writerPage);
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press(primaryShortcut('Z'));
    await expect.poll(async () => getEditorText(writerPage)).toBe(reviewerText);

    await waitForRegisteredTool(writerPage, 'collabmd_apply_text_edits');
    const document = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    expect(document.path).toBe('README.md');

    await revokeGovernedRole(ownerPage, writer.participantSessionId);
    await expect(writerPage.locator('[data-self="true"]')).toHaveAttribute('data-grant-state', 'revoked');
    await expect(writerPage.locator('#governanceRail')).toBeVisible();
    await expect(writerPage.locator('.cm-editor')).toHaveCount(0);
    await expect(executeCachedTool(writerPage, 'collabmd_apply_text_edits', {
      path: 'README.md',
      revision: document.revision,
      replacements: [{ newText: 'Denied', oldText: 'Welcome' }],
    })).rejects.toThrow(/No supported, synchronized CollabMD document is active/);
    await attachEvidenceScreenshot({
      name: 'revoked-editor',
      page: writerPage,
      testInfo,
    });
  } finally {
    await duplicatePage.close();
    await reviewerPage.close();
    await writerPage.close();
  }
});

test('governed collaboration converges Writer edits and resolves persisted Proposals', async ({ page: ownerPage }, testInfo) => {
  const writerPage = await ownerPage.context().newPage();
  const reviewerPage = await ownerPage.context().newPage();

  try {
    await installModelContextHarness(writerPage);
    await installModelContextHarness(reviewerPage);
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'ai' });
    const reviewer = await createGovernedParticipant(reviewerPage, { displayName: 'Reviewer', kind: 'human' });

    await expect.poll(async () => ownerPage.locator('#participantBar [data-participant-session-id]').count()).toBe(3);
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await assignGovernedRole(ownerPage, reviewer.participantSessionId, 'reviewer');
    await waitForCollaborativeEditor(writerPage);
    await waitForCollaborativeEditor(reviewerPage);
    await waitForRegisteredTool(writerPage, 'collabmd_apply_text_edits');
    await waitForRegisteredTool(reviewerPage, 'collabmd_propose_text_edit');

    const source = '# Launch plan\n\nBudget is $100K.\n\nUnlocated target.\n';
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
    const beforeProposal = await getEditorText(reviewerPage);
    const reviewerProposal = await executeRegisteredTool(reviewerPage, 'collabmd_propose_text_edit', {
      newText: '$120K',
      oldText: '$110K',
      path: 'README.md',
      revision: reviewerRead.revision,
    });
    expect(await getEditorText(reviewerPage)).toBe(beforeProposal);
    await expect.poll(async () => getEditorText(ownerPage)).toBe(beforeProposal);

    const writerReadForProposal = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    const writerProposal = await executeRegisteredTool(writerPage, 'collabmd_propose_text_edit', {
      newText: '$130K',
      oldText: '$110K',
      path: 'README.md',
      revision: writerReadForProposal.revision,
    });
    await expect(ownerPage.locator(`[data-proposal-id="${reviewerProposal.id}"]`)).toBeVisible();
    await expect(ownerPage.locator(`[data-proposal-id="${writerProposal.id}"]`)).toBeVisible();

    const conflictRead = await executeRegisteredTool(writerPage, 'collabmd_read_active_document');
    const firstConflict = await executeRegisteredTool(writerPage, 'collabmd_apply_text_edits', {
      path: 'README.md',
      replacements: [{ newText: 'First missing replacement', oldText: 'Missing source text' }],
      revision: conflictRead.revision,
    });
    const secondConflict = await executeRegisteredTool(writerPage, 'collabmd_apply_text_edits', {
      path: 'README.md',
      replacements: [{ newText: 'Second missing replacement', oldText: 'Missing source text' }],
      revision: conflictRead.revision,
    });
    expect(firstConflict.replacementCount).toBe(0);
    expect(secondConflict.replacementCount).toBe(0);
    await expect.poll(async () => hasSameLocationConflictGroup(ownerPage)).toBe(true);

    await expect.poll(async () => activityCount(ownerPage)).toBe(13);
    const beforeResolutionActivity = await activityCount(ownerPage);
    await ownerPage.locator('[data-governance-tab="review"]').click();
    await attachEvidenceScreenshot({
      name: 'proposal-conflicts',
      page: ownerPage,
      testInfo,
    });
    ownerPage.once('dialog', (dialog) => dialog.accept());
    await ownerPage.locator(`[data-proposal-id="${reviewerProposal.id}"] [data-proposal-resolution="apply_proposed"]`).click();
    await expect.poll(async () => getEditorText(ownerPage)).toContain('$120K');
    await expect(ownerPage.locator(`[data-proposal-id="${writerProposal.id}"]`)).toContainText('Conflict');
    await expect.poll(async () => activityCount(ownerPage)).toBe(beforeResolutionActivity + 2);

    const beforeRefreshActivity = await activityCount(ownerPage);
    await ownerPage.reload();
    await expect(ownerPage.locator('[data-self="true"]')).toContainText('Owner');
    await waitForCollaborativeEditor(ownerPage);
    await ownerPage.locator('[data-governance-tab="activity"]').click();
    await expect(ownerPage.locator('#governanceActivityPanel')).toContainText('Proposal Accepted');
    await expect.poll(async () => activityCount(ownerPage)).toBe(beforeRefreshActivity);
  } finally {
    await reviewerPage.close();
    await writerPage.close();
  }
});

test('governed mutation freezes offline work and discards stale history after a Grant change', async ({ browser, page: ownerPage }, testInfo) => {
  const writerContext = await browser.newContext(isEvidenceRun(testInfo)
    ? {
        recordVideo: {
          dir: testInfo.outputPath('manual-video'),
        },
      }
    : {});
  const documentSockets = [];
  let blockGovernanceRefresh = false;
  let releaseGovernanceRefresh = null;
  let governanceRefreshGate = Promise.resolve();
  const holdGovernanceRefresh = () => {
    blockGovernanceRefresh = true;
    governanceRefreshGate = new Promise((resolve) => {
      releaseGovernanceRefresh = resolve;
    });
  };
  const resumeGovernanceRefresh = () => {
    blockGovernanceRefresh = false;
    releaseGovernanceRefresh?.();
    releaseGovernanceRefresh = null;
  };
  await writerContext.routeWebSocket(/\/ws\//u, (socket) => {
    if (socket.url().includes('README.md')) {
      documentSockets.push(socket);
    }
    socket.connectToServer();
  });
  const writerPage = await writerContext.newPage();
  const writerVideo = writerPage.video();

  try {
    await createGovernedParticipant(ownerPage, { displayName: 'Owner', kind: 'human' });
    const writer = await createGovernedParticipant(writerPage, { displayName: 'Writer', kind: 'human' });

    await expect.poll(async () => ownerPage.locator('#participantBar [data-participant-session-id]').count()).toBe(2);
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await expect(writerPage.locator('[data-self="true"]')).toContainText('Editor');
    await waitForCollaborativeEditor(writerPage);
    await expect.poll(() => documentSockets.length).toBeGreaterThan(0);
    await writerPage.route('**/api/governance/session', async (route) => {
      if (blockGovernanceRefresh && route.request().method() === 'GET') {
        await governanceRefreshGate;
      }
      await route.continue();
    });

    await replaceEditorContent(writerPage, '# Mutation flow\n\n- [ ] Task\n');
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press('Control+End');
    await writerPage.keyboard.type('Typed');
    await expect.poll(async () => getEditorText(writerPage)).toContain('Typed');

    await pasteClipboardText(writerPage, ' Pasted');
    await expect.poll(async () => getEditorText(writerPage)).toContain('Pasted');

    await setEditorSelection(writerPage, 'Typed');
    await writerPage.locator('[data-markdown-action="bold"]').click();
    await expect.poll(async () => getEditorText(writerPage)).toContain('**Typed**');

    const task = writerPage.locator('#previewContent .task-list-item input[data-task-checkbox="true"]');
    await expect(task).toBeVisible();
    await task.click();
    await expect.poll(async () => getEditorText(writerPage)).toContain('- [x] Task');
    const beforeUndo = await getEditorText(writerPage);
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press(primaryShortcut('Z'));
    await expect.poll(async () => getEditorText(writerPage)).not.toBe(beforeUndo);
    await writerPage.keyboard.press(primaryShortcut('Shift+Z'));
    await expect.poll(async () => getEditorText(writerPage)).toBe(beforeUndo);
    const synchronizedText = beforeUndo;
    await expect.poll(async () => getEditorText(ownerPage)).toBe(synchronizedText);

    await writerPage.locator('[data-governance-tab="activity"]').click();
    let beforeReconnectActivityIds = [];
    await expect.poll(async () => {
      const [ownerIds, writerIds] = await Promise.all([
        activityIds(ownerPage),
        activityIds(writerPage),
      ]);
      if (JSON.stringify(ownerIds) !== JSON.stringify(writerIds)) {
        return false;
      }
      beforeReconnectActivityIds = ownerIds;
      return true;
    }).toBe(true);
    const beforeReconnectActivityCount = beforeReconnectActivityIds.length;
    expect(beforeReconnectActivityCount).toBeGreaterThan(0);
    holdGovernanceRefresh();
    await closeLatestDocumentSocket(documentSockets);
    await expect.poll(async () => editorIsEditable(writerPage)).toBe('false');
    const ownerTask = ownerPage.locator('#previewContent .task-list-item input[data-task-checkbox="true"]');
    await ownerTask.click();
    await expect.poll(async () => getEditorText(ownerPage)).toContain('- [ ] Task');
    let ownerDirectEditId = '';
    await expect.poll(async () => {
      const ids = await newOwnerDirectEditIds(ownerPage, beforeReconnectActivityIds);
      if (ids.length !== 1) {
        return false;
      }
      ownerDirectEditId = ids[0];
      return true;
    }).toBe(true);
    const ownerDeltaText = await getEditorText(ownerPage);
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.type(' Offline');
    await writerPage.keyboard.press('Backspace');
    await expect.poll(async () => getEditorText(writerPage)).toBe(synchronizedText);

    resumeGovernanceRefresh();
    await expect.poll(() => documentSockets.length).toBeGreaterThan(1);
    await expect.poll(async () => editorIsEditable(writerPage)).toBe('true');
    await expect.poll(async () => getEditorText(writerPage)).toBe(ownerDeltaText);
    await expect.poll(async () => (
      newOwnerDirectEditIds(ownerPage, beforeReconnectActivityIds)
    )).toEqual([ownerDirectEditId]);
    await expect.poll(async () => (
      newOwnerDirectEditIds(writerPage, beforeReconnectActivityIds)
    )).toEqual([ownerDirectEditId]);
    const beforeReconnectEditActivityIds = await activityIds(ownerPage);
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press('Control+End');
    await writerPage.keyboard.type(' Reconnected');
    await expect.poll(async () => getEditorText(writerPage)).toContain('Reconnected');
    const reconnectedText = await getEditorText(writerPage);
    await expect.poll(async () => getEditorText(ownerPage)).toBe(reconnectedText);
    await writerPage.locator('.cm-content').blur();
    await expect.poll(async () => (
      (await activityRecords(ownerPage)).filter((record) => (
        !beforeReconnectEditActivityIds.includes(record.id)
        && record.text?.includes('Writer')
        && record.text?.includes('Direct Edit Applied')
      )).length
    )).toBe(1);

    const beforeChangedGrantActivityIds = await activityIds(ownerPage);
    holdGovernanceRefresh();
    await closeLatestDocumentSocket(documentSockets);
    await expect.poll(async () => editorIsEditable(writerPage)).toBe('false');
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'reviewer');
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.type(' Stale');
    await expect.poll(async () => getEditorText(writerPage)).toBe(reconnectedText);

    resumeGovernanceRefresh();
    await expect(writerPage.locator('[data-self="true"]')).toContainText('Reviewer');
    await waitForCollaborativeEditor(writerPage);
    await expect.poll(async () => getEditorText(writerPage)).toBe(reconnectedText);
    await expect.poll(async () => {
      const newRecords = (await activityRecords(ownerPage)).filter((record) => (
        !beforeChangedGrantActivityIds.includes(record.id)
      ));
      return {
        count: newRecords.length,
        grantAssigned: newRecords.filter((record) => record.text?.includes('Grant Assigned')).length,
      };
    }).toEqual({ count: 1, grantAssigned: 1 });
    await attachEvidenceScreenshot({
      name: 'offline-grant-revalidated',
      page: writerPage,
      testInfo,
    });

    const beforeRecreateActivity = await activityCount(ownerPage);
    await assignGovernedRole(ownerPage, writer.participantSessionId, 'editor');
    await expect(writerPage.locator('[data-self="true"]')).toContainText('Editor');
    await waitForCollaborativeEditor(writerPage);
    await writerPage.locator('.cm-content').click();
    await writerPage.keyboard.press(primaryShortcut('Z'));
    await expect.poll(async () => getEditorText(writerPage)).toBe(reconnectedText);
    await expect.poll(async () => activityCount(ownerPage)).toBe(beforeRecreateActivity + 1);
  } finally {
    resumeGovernanceRefresh();
    await writerContext.close();

    if (writerVideo) {
      const videoPath = testInfo.outputPath('offline-grant-revalidation.webm');
      await writerVideo.saveAs(videoPath);
      await testInfo.attach('offline-grant-revalidation-video', {
        contentType: 'video/webm',
        path: videoPath,
      });
    }
  }
});
