import {
  assignGroundRole,
  createGroundDocument,
  expect,
  expectGroundEditor,
  expectGroundPending,
  joinGroundDocument,
  openGroundContext,
  submitGroundDisplayName,
  test,
} from './helpers/ground-app-fixture.js';

const DOCUMENT_ROUTE = /\/[A-Za-z0-9_-]{22}$/u;

// Each flow drives three anonymous browser contexts against a real Supabase
// stack, so it needs more than the shared default budget.
test.describe.configure({ timeout: 120_000 });

test('creates, shares, joins Pending, and assigns both Roles', async ({
  browser,
  groundServer,
}) => {
  const owner = await openGroundContext(browser, groundServer.baseURL, 'Owner');
  const created = await createGroundDocument(owner.page, 'Owner');

  await expect(owner.page).toHaveURL(DOCUMENT_ROUTE);
  expect(created.docId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  await expectGroundEditor(owner.page, { editable: true });
  await expect(owner.page.locator('#shareGroundDocument')).toBeVisible();

  // The share link is the canonical route only; the recovery token never leaks.
  const shareUrl = `${groundServer.baseURL}/${created.docId}`;
  expect(created.recoveryUrl).toContain('recover=');
  expect(shareUrl).not.toContain('recover=');

  const editor = await joinGroundDocument(
    browser,
    groundServer.baseURL,
    created.docId,
    'Writer Agent',
  );
  const reviewer = await joinGroundDocument(
    browser,
    groundServer.baseURL,
    created.docId,
    'Reviewer Agent',
  );

  await expectGroundPending(editor.page);
  await expectGroundPending(reviewer.page);

  // A Pending visitor may not list participants, so it sees no roster at all.
  await expect(editor.page.locator('#participantBar [data-participant-session-id]')).toHaveCount(0);
  await expect.poll(
    async () => owner.page.locator('#participantBar [data-participant-session-id]').count(),
  ).toBe(3);

  await assignGroundRole(owner.page, 'Writer Agent', 'editor');
  await assignGroundRole(owner.page, 'Reviewer Agent', 'reviewer');

  await expectGroundEditor(editor.page, { editable: true });
  await expectGroundEditor(reviewer.page, { editable: false });

  expect(owner.errors).toEqual([]);
  expect(editor.errors).toEqual([]);
  expect(reviewer.errors).toEqual([]);

  await Promise.all([owner.context.close(), editor.context.close(), reviewer.context.close()]);
});

test('an unknown document shows the status-only unavailable surface', async ({
  browser,
  groundServer,
}) => {
  const visitor = await openGroundContext(browser, groundServer.baseURL, 'Visitor');

  await visitor.page.goto('/AAAAAAAAAAAAAAAAAAAAAA');
  // Ground asks for a display name before it can attempt the join that
  // discovers the document does not exist.
  await submitGroundDisplayName(visitor.page, 'Visitor');

  await expect(visitor.page.locator('#groundUnavailable')).toBeVisible();
  await expect(visitor.page.locator('.cm-editor')).toHaveCount(0);
  await expect(visitor.page.locator('#governanceRail')).toBeHidden();
  await expect(visitor.page.locator('#shareGroundDocument')).toBeHidden();

  await visitor.context.close();
});

test('a second session receives a safe denial for another document', async ({
  browser,
  groundServer,
}) => {
  const owner = await openGroundContext(browser, groundServer.baseURL, 'Owner');
  const created = await createGroundDocument(owner.page, 'Owner');

  const outsider = await openGroundContext(browser, groundServer.baseURL, 'Outsider');
  const second = await createGroundDocument(outsider.page, 'Outsider');
  expect(second.docId).not.toBe(created.docId);

  const denied = await outsider.page.evaluate(async (documentId) => {
    const stored = Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-'))
      .map((key) => localStorage.getItem(key))[0];
    const response = await fetch('/api/ground', {
      body: JSON.stringify({ documentId, operation: 'hydrate_document' }),
      headers: {
        authorization: `Bearer ${JSON.parse(stored).access_token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    return { body: await response.text(), status: response.status };
  }, created.docId);

  expect(denied.status).toBe(404);
  expect(denied.body).toBe('{"code":"GROUND_UNAVAILABLE"}');

  await Promise.all([owner.context.close(), outsider.context.close()]);
});
