import { afterEach, describe, expect, it, vi } from 'vitest';

import { GovernanceUiController } from '../../src/client/presentation/governance-ui-controller.js';
import '../../src/client/styles/style.css';

const roles = Object.freeze({
  editor: ['document.read', 'document.suggest', 'document.edit'],
  owner: [
    'document.read',
    'document.suggest',
    'document.edit',
    'conflict.resolve',
    'grant.manage',
  ],
  reviewer: ['document.read', 'document.suggest'],
});

const participants = Object.freeze([
  {
    displayName: 'Mina',
    kind: 'human',
    participantSessionId: 'session-owner',
    roleId: 'owner',
    state: 'active',
  },
  {
    displayName: 'ReviewBot',
    kind: 'ai',
    participantSessionId: 'session-ai',
    state: 'pending',
  },
  {
    displayName: 'EditBot',
    kind: 'ai',
    participantSessionId: 'session-editor',
    roleId: 'editor',
    state: 'active',
  },
]);

const activity = Object.freeze([
  {
    action: 'direct_edit_applied',
    actor: {
      displayName: 'Mina',
      kind: 'human',
      participantSessionId: 'session-owner',
      roleId: 'owner',
    },
    createdAt: Date.UTC(2026, 7, 30, 10, 0),
    id: 'activity-1',
    outcome: 'applied',
    source: 'document_editor',
    target: 'document',
  },
  {
    action: 'grant_revoked',
    actor: {
      displayName: 'Mina',
      kind: 'human',
      participantSessionId: 'session-owner',
      roleId: 'owner',
    },
    createdAt: Date.UTC(2026, 7, 30, 10, 1),
    id: 'activity-2',
    outcome: 'revoked',
    source: 'access_management',
    target: 'session-ai',
  },
  {
    action: 'proposal_created',
    actor: {
      displayName: 'ReviewBot',
      kind: 'ai',
      participantSessionId: 'session-ai',
      roleId: 'reviewer',
    },
    createdAt: Date.UTC(2026, 7, 30, 10, 2),
    id: 'activity-3',
    outcome: 'open',
    source: 'webmcp_proposal',
    target: 'proposal-open',
  },
]);

const activeOwnerState = () => ({
  activity,
  connectionState: { status: 'connected', unreachable: false },
  participants,
  reviewGroups: [],
  roles,
  session: {
    displayName: 'Mina',
    documentPath: 'README.md',
    kind: 'human',
    participantSessionId: 'session-owner',
    roleId: 'owner',
    state: 'active',
  },
  shellState: { accessState: 'active', phase: 'ready' },
});

const proposalGroup = ({ unlocated = false } = {}) => ({
  from: unlocated ? null : 4,
  proposals: [{
    createdByDisplayName: 'ReviewBot',
    createdByKind: 'ai',
    createdByParticipantSessionId: 'session-ai',
    createdByRole: 'reviewer',
    currentText: unlocated ? null : 'before',
    expectedText: unlocated ? 'missing' : 'before',
    id: unlocated ? 'proposal-unlocated' : 'proposal-open',
    replacementText: unlocated ? 'replacement' : 'after',
    status: unlocated ? 'conflict' : 'open',
  }],
  to: unlocated ? null : 10,
  unlocated,
});

const mount = () => {
  document.body.innerHTML = `
    <section id="participantBar" hidden>
      <button type="button" id="manageAccessBtn" hidden>Manage access</button>
    </section>
    <section id="governanceStatusPanel" hidden>
      <h2 data-governance-status-title></h2>
      <p data-governance-status-copy></p>
      <button type="button" data-governance-retry hidden>Retry</button>
    </section>
    <section id="focusedDocumentSurface" hidden>
      <a id="skipToEditor" href="#editorContainer">Skip to editor</a>
      <div id="editorContainer"></div>
      <aside id="governanceRail" hidden>
        <div role="tablist">
          <button type="button" data-governance-tab="review" aria-controls="governanceReviewPanel">Review</button>
          <button type="button" data-governance-tab="activity" aria-controls="governanceActivityPanel">Activity</button>
          <button type="button" data-governance-tab="roles" aria-controls="governanceRolesPanel">Roles</button>
        </div>
        <section id="governanceReviewPanel" data-governance-panel="review"></section>
        <section id="governanceActivityPanel" data-governance-panel="activity"></section>
        <section id="governanceRolesPanel" data-governance-panel="roles"></section>
      </aside>
    </section>
    <dialog id="manageAccessDialog" aria-labelledby="manageAccessTitle">
      <h2 id="manageAccessTitle" tabindex="-1">Manage access</h2>
      <div data-manage-access-list></div>
      <button type="button" data-manage-access-close>Close</button>
    </dialog>
  `;
  const callbacks = {
    onAssignRole: vi.fn(),
    onResolveProposal: vi.fn(),
    onRetry: vi.fn(),
    onRevoke: vi.fn(),
    onSelectProposal: vi.fn(),
  };
  const controller = new GovernanceUiController({
    documentSurface: document.getElementById('focusedDocumentSurface'),
    governanceRail: document.getElementById('governanceRail'),
    governanceStatusCopy: document.querySelector('[data-governance-status-copy]'),
    governanceStatusPanel: document.getElementById('governanceStatusPanel'),
    governanceStatusRetry: document.querySelector('[data-governance-retry]'),
    governanceStatusTitle: document.querySelector('[data-governance-status-title]'),
    manageAccessButton: document.getElementById('manageAccessBtn'),
    manageAccessDialog: document.getElementById('manageAccessDialog'),
    participantBar: document.getElementById('participantBar'),
    skipToEditor: document.getElementById('skipToEditor'),
    ...callbacks,
  });
  return { callbacks, controller };
};

const expectSkipToEditorBlocked = () => {
  const skipToEditor = document.getElementById('skipToEditor');
  expect(skipToEditor).toHaveAttribute('hidden');
  expect(skipToEditor).toHaveAttribute('tabindex', '-1');
  skipToEditor.focus();
  expect(document.activeElement).not.toBe(skipToEditor);
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('GovernanceUiController focused shell', () => {
  it('shows the focused document, Participant bar, rail, and access control for an Owner', () => {
    const { controller } = mount();

    controller.render(activeOwnerState());

    expect(document.getElementById('participantBar')).not.toHaveAttribute('hidden');
    expect(document.getElementById('focusedDocumentSurface')).not.toHaveAttribute('hidden');
    expect(document.getElementById('focusedDocumentSurface')).toHaveAttribute('data-owner', 'true');
    expect(document.getElementById('governanceRail')).not.toHaveAttribute('hidden');
    expect(document.getElementById('manageAccessBtn')).not.toHaveAttribute('hidden');
    expect(document.getElementById('governanceStatusPanel')).toHaveAttribute('hidden');
    expect(document.getElementById('skipToEditor')).not.toHaveAttribute('hidden');
    expect(document.getElementById('skipToEditor')).toHaveAttribute('tabindex', '0');
    expect(document.querySelector('[data-governance-connection]')?.textContent).toBe('Connected');
    expect(document.querySelector('.governance-avatar')).not.toHaveClass('user-avatar');
  });

  it('shows the document without Owner controls for an active non-Owner', () => {
    const { controller } = mount();
    const state = activeOwnerState();
    state.session = { ...participants[2], documentPath: 'README.md' };

    controller.render(state);
    document.getElementById('manageAccessBtn').click();

    expect(document.getElementById('focusedDocumentSurface')).not.toHaveAttribute('hidden');
    expect(document.getElementById('focusedDocumentSurface')).toHaveAttribute('data-owner', 'false');
    expect(document.getElementById('participantBar')).not.toHaveAttribute('hidden');
    expect(document.getElementById('governanceRail')).toHaveAttribute('hidden');
    expect(document.getElementById('manageAccessBtn')).toHaveAttribute('hidden');
    expect(document.getElementById('manageAccessDialog').open).toBe(false);
  });

  it.each([
    ['pending', 'Waiting for access'],
    ['revoked', 'Access revoked'],
  ])('blocks the document for the %s Access state', (accessState, expectedTitle) => {
    const { controller } = mount();
    const state = activeOwnerState();
    state.session = { ...state.session, roleId: undefined, state: accessState };
    state.shellState = { accessState, phase: 'ready' };

    controller.render(state);

    expect(document.getElementById('participantBar')).not.toHaveAttribute('hidden');
    expect(document.getElementById('focusedDocumentSurface')).toHaveAttribute('hidden');
    expect(document.getElementById('governanceRail')).toHaveAttribute('hidden');
    expect(document.querySelector('[data-governance-status-title]')?.textContent).toBe(expectedTitle);
    expect(document.querySelector('[data-governance-retry]')).toHaveAttribute('hidden');
    expectSkipToEditorBlocked();
  });

  it('renders loading and retryable error as neutral status-only states', () => {
    const { callbacks, controller } = mount();
    const state = activeOwnerState();
    state.session = null;
    state.shellState = { accessState: null, phase: 'loading' };

    controller.render(state);

    expect(document.getElementById('participantBar')).toHaveAttribute('hidden');
    expect(document.getElementById('focusedDocumentSurface')).toHaveAttribute('hidden');
    expect(document.querySelector('[data-governance-status-title]')?.textContent).toBe('Checking access');
    expect(document.querySelector('[data-governance-retry]')).toHaveAttribute('hidden');
    expectSkipToEditorBlocked();

    controller.render({ ...state, shellState: { accessState: null, phase: 'error' } });
    document.querySelector('[data-governance-retry]').click();

    expect(document.querySelector('[data-governance-status-title]')?.textContent).toBe('Unable to check access');
    expect(document.querySelector('[data-governance-retry]')).not.toHaveAttribute('hidden');
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    expectSkipToEditorBlocked();
  });

  it('renders latest-first Activity with complete actor attribution, action, source, outcome, target, and time', () => {
    const { controller } = mount();
    controller.render(activeOwnerState());
    document.querySelector('[data-governance-tab="activity"]').click();

    const items = document.querySelectorAll('[data-activity-id]');
    expect(Array.from(items, (item) => item.dataset.activityId)).toEqual([
      'activity-3',
      'activity-2',
      'activity-1',
    ]);
    expect(items[0].textContent).toContain('ReviewBot');
    expect(items[0].textContent).toContain('AI');
    expect(items[0].textContent).toContain('session-ai');
    expect(items[0].textContent).toContain('Reviewer');
    expect(items[0].textContent).toContain('Proposal Created');
    expect(items[0].textContent).toContain('WebMCP proposal');
    expect(items[0].textContent).toContain('Open');
    expect(items[0].textContent).toContain('proposal-open');
    expect(items[0].querySelector('time')).toHaveAttribute('datetime', '2026-08-30T10:02:00.000Z');
    expect(document.querySelector('[data-activity-filter]')).toBeNull();
  });

  it('renders Proposal Human or AI and Role-at-creation attribution', () => {
    const { controller } = mount();
    const state = activeOwnerState();
    state.reviewGroups = [proposalGroup()];

    controller.render(state);

    const proposal = document.querySelector('[data-proposal-id="proposal-open"]');
    expect(proposal.textContent).toContain('ReviewBot');
    expect(proposal.textContent).toContain('AI');
    expect(proposal.textContent).toContain('Reviewer');
  });

  it('renders exact live Current and Proposed text without presenting a stale expectation as current', () => {
    const { controller } = mount();
    const state = activeOwnerState();
    const group = proposalGroup();
    group.proposals[0] = {
      ...group.proposals[0],
      currentText: 'live current text',
      expectedText: 'stale expected text',
      replacementText: 'proposed replacement',
      status: 'conflict',
    };
    state.reviewGroups = [group];

    controller.render(state);

    const change = document.querySelector('[data-proposal-id="proposal-open"] .proposal-change');
    expect(change).toHaveTextContent('Current: live current text');
    expect(change).toHaveTextContent('Proposed: proposed replacement');
    expect(change).not.toHaveTextContent('stale expected text');
  });

  it('renders public Role and Access labels for internal grant Activity actions', () => {
    const accessActivity = [
      { ...activity[1], action: 'grant_assigned', id: 'activity-grant-assigned' },
      { ...activity[1], action: 'grant_changed', id: 'activity-grant-changed' },
      { ...activity[1], id: 'activity-grant-revoked' },
    ];
    const { controller } = mount();
    controller.render({ ...activeOwnerState(), activity: accessActivity });
    document.querySelector('[data-governance-tab="activity"]').click();

    const copy = document.querySelector('#governanceActivityPanel').textContent;
    expect(copy).toContain('Role assigned');
    expect(copy).toContain('Role changed');
    expect(copy).toContain('Access revoked');
    expect(copy).not.toMatch(/Grant (Assigned|Changed|Revoked)/u);
    expect(copy).not.toMatch(/grant_(assigned|changed|revoked)/u);
  });

  it('uses roving semantic tabs and a semantic Role capability table', () => {
    const { controller } = mount();
    controller.render(activeOwnerState());
    const reviewTab = document.querySelector('[data-governance-tab="review"]');
    const activityTab = document.querySelector('[data-governance-tab="activity"]');

    reviewTab.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    expect(reviewTab).toHaveAttribute('tabindex', '-1');
    expect(activityTab).toHaveAttribute('tabindex', '0');
    expect(activityTab).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('#roleCapabilityMatrix')?.tagName).toBe('TABLE');
  });

  it('keeps Proposal confirmation cancel side-effect free', () => {
    const { callbacks, controller } = mount();
    const state = activeOwnerState();
    state.reviewGroups = [proposalGroup()];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    controller.render(state);

    document.querySelector('[data-proposal-resolution="apply_proposed"]').click();

    expect(confirm).toHaveBeenCalledOnce();
    expect(callbacks.onResolveProposal).not.toHaveBeenCalled();
    expect(document.querySelector('[data-proposal-id="proposal-open"]')?.textContent)
      .toContain('Current: before');
    expect(document.querySelector('[data-proposal-id="proposal-open"]')?.textContent)
      .toContain('Proposed: after');
    expect(document.querySelectorAll('[data-activity-id]')).toHaveLength(3);
  });

  it('blocks applying an Unlocated Proposal but allows Keep current resolution', () => {
    const { callbacks, controller } = mount();
    const state = activeOwnerState();
    state.reviewGroups = [proposalGroup({ unlocated: true })];
    const confirm = vi.spyOn(window, 'confirm');
    controller.render(state);

    const proposal = document.querySelector('[data-proposal-id="proposal-unlocated"]');
    proposal.querySelector('[data-proposal-select]').click();
    expect(proposal.querySelector('[data-proposal-resolution="apply_proposed"]')).toBeNull();
    proposal.querySelector('[data-proposal-resolution="keep_current"]').click();

    expect(confirm).not.toHaveBeenCalled();
    expect(callbacks.onSelectProposal).toHaveBeenCalledWith('proposal-unlocated');
    expect(callbacks.onResolveProposal).toHaveBeenCalledWith('proposal-unlocated', 'keep_current');
    expect(proposal.closest('[data-conflict-group]')).toHaveAttribute('data-unlocated', 'true');
    expect(proposal.querySelector('.proposal-change')).toHaveTextContent('Current: Unavailable');
    expect(proposal.querySelector('.proposal-change')).toHaveTextContent('Proposed: replacement');
    expect(proposal.querySelector('.proposal-change')).not.toHaveTextContent('missing');
  });
});

describe('GovernanceUiController Manage access', () => {
  it('keeps the selected Role as a draft until the Owner explicitly assigns it', async () => {
    const { callbacks, controller } = mount();
    controller.render(activeOwnerState());
    document.getElementById('manageAccessBtn').click();

    const dialog = document.getElementById('manageAccessDialog');
    const pendingRow = dialog.querySelector('[data-participant-session-id="session-ai"]');
    expect(dialog.open).toBe(true);
    expect(pendingRow.querySelector('[data-expiry-control]')).toBeNull();

    pendingRow.querySelector('[data-role-control]').value = 'reviewer';
    pendingRow.querySelector('[data-role-control]').dispatchEvent(new Event('change', { bubbles: true }));

    expect(callbacks.onAssignRole).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);

    pendingRow.querySelector('[data-role-submit]').click();

    await vi.waitFor(() => {
      expect(callbacks.onAssignRole).toHaveBeenCalledWith('session-ai', 'reviewer');
    });
    expect(dialog.open).toBe(true);
  });

  it('focuses the Manage access heading for an Owner-only dialog and returns focus on close', () => {
    const { controller } = mount();
    const state = activeOwnerState();
    state.participants = [participants[0]];
    controller.render(state);
    const manageAccessButton = document.getElementById('manageAccessBtn');
    const dialog = document.getElementById('manageAccessDialog');
    const title = document.getElementById('manageAccessTitle');

    manageAccessButton.focus();
    manageAccessButton.click();

    expect(dialog.open).toBe(true);
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(title);

    dialog.querySelector('[data-manage-access-close]').click();

    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(manageAccessButton);
  });

  it('labels assign, update, and revoke actions and locks the Owner row', () => {
    const { controller } = mount();
    controller.render(activeOwnerState());
    document.getElementById('manageAccessBtn').click();

    const dialog = document.getElementById('manageAccessDialog');
    const pending = dialog.querySelector('[data-participant-session-id="session-ai"]');
    const active = dialog.querySelector('[data-participant-session-id="session-editor"]');
    const owner = dialog.querySelector('[data-participant-session-id="session-owner"]');

    expect(pending.querySelector('[data-role-submit]')).toHaveTextContent('Assign role');
    expect(pending.querySelector('[data-revoke-control]')).toBeNull();
    expect(active.querySelector('[data-role-submit]')).toHaveTextContent('Update role');
    expect(active.querySelector('[data-revoke-control]')).toHaveTextContent('Revoke access');
    expect(owner.querySelector('[data-role-control]')).toBeDisabled();
    expect(owner.querySelector('[data-role-submit]')).toBeDisabled();
    expect(owner.querySelector('[data-revoke-control]')).toBeNull();
  });

  it('disables only the pending row and keeps the dialog open while assigning', async () => {
    const { callbacks, controller } = mount();
    const request = Promise.withResolvers();
    callbacks.onAssignRole.mockReturnValueOnce(request.promise);
    controller.render(activeOwnerState());
    document.getElementById('manageAccessBtn').click();

    const dialog = document.getElementById('manageAccessDialog');
    const pending = dialog.querySelector('[data-participant-session-id="session-ai"]');
    pending.querySelector('[data-role-control]').value = 'editor';
    pending.querySelector('[data-role-control]').dispatchEvent(new Event('change', { bubbles: true }));
    pending.querySelector('[data-role-submit]').click();

    const pendingAfterRequest = () => dialog.querySelector('[data-participant-session-id="session-ai"]');
    const activeAfterRequest = () => dialog.querySelector('[data-participant-session-id="session-editor"]');
    await vi.waitFor(() => expect(pendingAfterRequest().querySelector('[data-role-control]')).toBeDisabled());
    expect(pendingAfterRequest().querySelector('[data-role-submit]')).toBeDisabled();
    expect(activeAfterRequest().querySelector('[data-role-control]')).not.toBeDisabled();
    expect(dialog.open).toBe(true);
    request.resolve();
    await vi.waitFor(() => expect(pendingAfterRequest().querySelector('[data-role-inline-status]')).toHaveTextContent('Role updated'));
  });

  it.each([
    ['active Role', activeOwnerState, 'session-editor', 'editor'],
    ['Pending placeholder', activeOwnerState, 'session-ai', ''],
    ['Revoked placeholder', () => ({
      ...activeOwnerState(),
      participants: activeOwnerState().participants.map((participant) => (
        participant.participantSessionId === 'session-ai'
          ? { ...participant, state: 'revoked' }
          : participant
      )),
    }), 'session-ai', ''],
  ])('restores the authoritative %s after a failed assignment', async (_label, makeState, participantSessionId, expectedRole) => {
    const { callbacks, controller } = mount();
    callbacks.onAssignRole.mockRejectedValueOnce(new Error('Role update failed'));
    controller.render(makeState());
    document.getElementById('manageAccessBtn').click();

    const dialog = document.getElementById('manageAccessDialog');
    const row = dialog.querySelector(`[data-participant-session-id="${participantSessionId}"]`);
    const roleControl = row.querySelector('[data-role-control]');
    roleControl.value = expectedRole === 'editor' ? 'reviewer' : 'editor';
    roleControl.dispatchEvent(new Event('change', { bubbles: true }));
    row.querySelector('[data-role-submit]').click();

    const currentRow = () => dialog.querySelector(`[data-participant-session-id="${participantSessionId}"]`);
    await vi.waitFor(() => expect(currentRow().querySelector('[data-role-inline-status]')).toHaveTextContent('Role update failed'));
    expect(currentRow().querySelector('[data-role-control]').value).toBe(expectedRole);
    expect(dialog.open).toBe(true);
  });

  it('keeps a newer authoritative Role when an older assignment request fails', async () => {
    const { callbacks, controller } = mount();
    const request = Promise.withResolvers();
    callbacks.onAssignRole.mockReturnValueOnce(request.promise);
    controller.render(activeOwnerState());
    document.getElementById('manageAccessBtn').click();

    const dialog = document.getElementById('manageAccessDialog');
    const editorRow = dialog.querySelector('[data-participant-session-id="session-editor"]');
    editorRow.querySelector('[data-role-control]').value = 'reviewer';
    editorRow.querySelector('[data-role-control]').dispatchEvent(new Event('change', { bubbles: true }));
    editorRow.querySelector('[data-role-submit]').click();
    await vi.waitFor(() => expect(callbacks.onAssignRole).toHaveBeenCalledWith('session-editor', 'reviewer'));

    const newerState = activeOwnerState();
    newerState.participants = newerState.participants.map((participant) => (
      participant.participantSessionId === 'session-editor'
        ? { ...participant, roleId: 'reviewer' }
        : participant
    ));
    controller.render(newerState);
    request.reject(new Error('Role update failed'));

    const currentEditorRow = () => dialog.querySelector('[data-participant-session-id="session-editor"]');
    await vi.waitFor(() => expect(currentEditorRow().querySelector('[data-role-inline-status]')).toHaveTextContent('Role update failed'));
    expect(currentEditorRow().querySelector('[data-role-control]').value).toBe('reviewer');
    expect(dialog.open).toBe(true);
    const pendingRow = dialog.querySelector('[data-participant-session-id="session-ai"]');
    expect(pendingRow.querySelector('[data-role-control]').value).toBe('');
    expect(pendingRow.querySelector('[data-role-control]')).not.toBeDisabled();
  });

  it('confirms revoke, leaves failed Active access authoritative, and blocks a non-Owner modal trigger', async () => {
    const { callbacks, controller } = mount();
    callbacks.onRevoke.mockRejectedValueOnce(new Error('Revoke failed'));
    controller.render(activeOwnerState());
    document.getElementById('manageAccessBtn').click();

    const dialog = document.getElementById('manageAccessDialog');
    const active = dialog.querySelector('[data-participant-session-id="session-editor"]');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    active.querySelector('[data-revoke-control]').click();

    await vi.waitFor(() => expect(callbacks.onRevoke).toHaveBeenCalledWith('session-editor'));
    expect(confirm).toHaveBeenCalledWith('Revoke access for EditBot? Unsynchronized local work may be discarded.');
    const activeAfterRevoke = () => dialog.querySelector('[data-participant-session-id="session-editor"]');
    await vi.waitFor(() => expect(activeAfterRevoke().querySelector('[data-role-inline-status]')).toHaveTextContent('Revoke failed'));
    expect(activeAfterRevoke().querySelector('[data-role-control]').value).toBe('editor');
    expect(dialog.open).toBe(true);

    const state = activeOwnerState();
    state.session = { ...participants[2], documentPath: 'README.md' };
    controller.render(state);
    document.getElementById('manageAccessBtn').click();
    expect(dialog.open).toBe(false);
  });

  it('sends no revoke request when the Owner cancels the confirmation', () => {
    const { callbacks, controller } = mount();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    controller.render(activeOwnerState());
    document.getElementById('manageAccessBtn').click();

    document.querySelector('[data-participant-session-id="session-editor"] [data-revoke-control]').click();

    expect(callbacks.onRevoke).not.toHaveBeenCalled();
  });
});
