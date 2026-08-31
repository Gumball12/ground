import { afterEach, describe, expect, it, vi } from 'vitest';

import { GovernanceUiController } from '../../src/client/presentation/governance-ui-controller.js';
import '../../src/client/styles/style.css';

const governanceFixture = () => ({
  activity: [
    {
      action: 'direct_edit_applied',
      actor: { displayName: 'Mina', kind: 'human', roleId: 'owner' },
      createdAt: Date.UTC(2026, 7, 30, 10, 0),
      id: 'activity-1',
      outcome: 'applied',
      target: 'document',
    },
    {
      action: 'grant_revoked',
      actor: { displayName: 'Mina', kind: 'human', roleId: 'owner' },
      createdAt: Date.UTC(2026, 7, 30, 10, 1),
      id: 'activity-2',
      outcome: 'revoked',
      target: 'session-ai',
    },
    {
      action: 'proposal_created',
      actor: { displayName: 'ReviewBot', kind: 'ai', roleId: 'reviewer' },
      createdAt: Date.UTC(2026, 7, 30, 10, 2),
      id: 'activity-3',
      outcome: 'open',
      target: 'proposal-open',
    },
  ],
  participants: [
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
      displayName: 'OldBot',
      kind: 'ai',
      participantSessionId: 'session-revoked',
      roleId: 'reviewer',
      state: 'revoked',
    },
    {
      displayName: 'EditBot',
      kind: 'ai',
      participantSessionId: 'session-editor',
      roleId: 'editor',
      state: 'active',
    },
  ],
  reviewGroups: [
    {
      from: 4,
      proposals: [{
        createdByDisplayName: 'ReviewBot',
        expectedText: 'before',
        id: 'proposal-open',
        replacementText: 'after',
        status: 'open',
      }],
      to: 10,
      unlocated: false,
    },
    {
      from: null,
      proposals: [{
        createdByDisplayName: 'ReviewBot',
        expectedText: 'missing',
        id: 'proposal-unlocated',
        replacementText: 'replacement',
        status: 'conflict',
      }],
      to: null,
      unlocated: true,
    },
  ],
  roles: {
    editor: ['document.read', 'document.comment', 'document.suggest', 'document.edit'],
    owner: [
      'document.read',
      'document.comment',
      'document.suggest',
      'document.edit',
      'conflict.resolve',
      'grant.manage',
    ],
    reviewer: ['document.read', 'document.comment', 'document.suggest'],
  },
  session: {
    displayName: 'Mina',
    participantSessionId: 'session-owner',
    roleId: 'owner',
    state: 'active',
  },
});

function createController() {
  document.body.innerHTML = `
    <section id="participantBar" hidden></section>
    <aside id="governanceRail" hidden>
      <div role="tablist" aria-label="Governance">
        <button type="button" data-governance-tab="review" aria-controls="governanceReviewPanel">Review</button>
        <button type="button" data-governance-tab="activity" aria-controls="governanceActivityPanel">Activity</button>
        <button type="button" data-governance-tab="roles" aria-controls="governanceRolesPanel">Roles</button>
      </div>
      <section id="governanceReviewPanel" data-governance-panel="review"></section>
      <section id="governanceActivityPanel" data-governance-panel="activity"></section>
      <section id="governanceRolesPanel" data-governance-panel="roles"></section>
    </aside>
    <button id="manageAccessBtn" type="button">Manage access</button>
    <dialog id="manageAccessDialog" class="app-dialog">
      <div data-manage-access-list></div>
      <button type="button" data-manage-access-close>Close</button>
    </dialog>
  `;

  const callbacks = {
    onAssignRole: vi.fn(),
    onResolveProposal: vi.fn(),
    onRevoke: vi.fn(),
    onSelectProposal: vi.fn(),
  };
  const controller = new GovernanceUiController({
    governanceRail: document.getElementById('governanceRail'),
    manageAccessButton: document.getElementById('manageAccessBtn'),
    manageAccessDialog: document.getElementById('manageAccessDialog'),
    participantBar: document.getElementById('participantBar'),
    ...callbacks,
  });

  return { callbacks, controller };
}

describe('GovernanceUiController', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('renders participant identity, kind, grant state, and self labels without credentials', () => {
    const { controller } = createController();

    controller.render({ ...governanceFixture(), credential: 'must-not-render' });

    const self = document.querySelector('[data-self="true"]');
    expect(self?.textContent).toContain('Mina');
    expect(self?.textContent).toContain('Human');
    expect(self?.textContent).toContain('Owner');
    expect(self?.textContent).toContain('Active');
    expect(document.querySelector('[data-participant-kind="ai"]')?.textContent).toContain('AI');
    expect(document.querySelector('[data-grant-state="revoked"]')?.textContent).toContain('Revoked');
    expect(document.body.textContent).not.toContain('must-not-render');
    expect(document.querySelector('[data-credential]')).toBeNull();
  });

  it('uses the high-contrast text token for small Grant state labels', () => {
    const { controller } = createController();
    document.documentElement.dataset.theme = 'light';
    controller.render(governanceFixture());
    const expected = document.createElement('span');
    expected.style.color = 'var(--color-text)';
    document.body.appendChild(expected);

    expect(getComputedStyle(document.querySelector('[data-grant-state="active"] .governance-state')).color)
      .toBe(getComputedStyle(expected).color);
    expect(getComputedStyle(document.querySelector('[data-grant-state="pending"] .governance-state')).color)
      .toBe(getComputedStyle(expected).color);
  });

  it('uses roving semantic tabs and a semantic Role capability table', () => {
    const { controller } = createController();
    controller.render(governanceFixture());

    const reviewTab = document.querySelector('[data-governance-tab="review"]');
    const activityTab = document.querySelector('[data-governance-tab="activity"]');
    expect(document.querySelector('#governanceRail [role="tablist"]')).not.toBeNull();
    expect(reviewTab).toHaveAttribute('role', 'tab');
    expect(reviewTab).toHaveAttribute('tabindex', '0');
    expect(activityTab).toHaveAttribute('tabindex', '-1');
    expect(document.querySelector('#roleCapabilityMatrix')?.tagName).toBe('TABLE');

    reviewTab.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));

    expect(activityTab).toHaveAttribute('aria-selected', 'true');
    expect(activityTab).toHaveAttribute('tabindex', '0');
    expect(reviewTab).toHaveAttribute('tabindex', '-1');
    expect(document.querySelector('[data-governance-panel="activity"]')).not.toHaveAttribute('hidden');
  });

  it('filters Activity with aria-pressed controls', () => {
    const { controller } = createController();
    controller.render(governanceFixture());
    document.querySelector('[data-governance-tab="activity"]').click();

    const accessFilter = document.querySelector('[data-activity-filter="access"]');
    expect(accessFilter).toHaveAttribute('aria-pressed', 'false');

    accessFilter.click();

    expect(document.querySelector('[data-activity-filter="access"]')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('[data-activity-id]')).toHaveLength(1);
    expect(document.querySelector('[data-activity-id="activity-2"]')?.textContent).toContain('Mina');
  });

  it('renders complete actor metadata and a semantic Activity timestamp', () => {
    const { controller } = createController();
    controller.render(governanceFixture());

    const item = document.querySelector('[data-activity-id="activity-1"]');
    expect(item?.textContent).toContain('Mina');
    expect(item?.textContent).toContain('Human');
    expect(item?.textContent).toContain('Owner');
    expect(item?.textContent).toContain('Direct Edit Applied');
    expect(item?.textContent).toContain('Applied');
    expect(item?.textContent).toContain('document');
    const timestamp = item?.querySelector('time');
    expect(timestamp).toHaveAttribute('datetime', '2026-08-30T10:00:00.000Z');
    expect(timestamp?.textContent).not.toBe('');
    expect(document.querySelector('[data-activity-id="activity-3"]')?.textContent).toContain('AI');
    expect(document.querySelector('[data-activity-id="activity-3"]')?.textContent).toContain('Reviewer');
  });

  it('requires confirmation before applying a Proposal and keeps cancel side-effect free', () => {
    const { callbacks, controller } = createController();
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    controller.render(governanceFixture());

    const located = document.querySelector('[data-proposal-id="proposal-open"]');
    const unlocated = document.querySelector('[data-proposal-id="proposal-unlocated"]');
    located.querySelector('[data-proposal-select]').click();
    located.querySelector('[data-proposal-resolution="apply_proposed"]').click();

    expect(callbacks.onSelectProposal).toHaveBeenCalledWith('proposal-open');
    expect(confirm).toHaveBeenCalledOnce();
    expect(callbacks.onResolveProposal).not.toHaveBeenCalled();
    expect(document.querySelector('[data-proposal-id="proposal-open"]')?.textContent).toContain('before → after');
    expect(document.querySelectorAll('[data-activity-id]')).toHaveLength(3);

    located.querySelector('[data-proposal-resolution="apply_proposed"]').click();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(callbacks.onResolveProposal).toHaveBeenCalledWith('proposal-open', 'apply_proposed');
    expect(unlocated.closest('[data-conflict-group]')).toHaveAttribute('data-unlocated', 'true');
    expect(unlocated.querySelector('[data-proposal-resolution="apply_proposed"]')).toBeDisabled();
    expect(unlocated.textContent).toContain('Unlocated conflict');
  });

  it('opens the native access dialog and keeps the Owner row immutable', () => {
    const { callbacks, controller } = createController();
    const dialog = document.getElementById('manageAccessDialog');
    controller.render(governanceFixture());

    document.getElementById('manageAccessBtn').click();

    expect(dialog.open).toBe(true);
    const ownerRow = dialog.querySelector('[data-owner="true"]');
    const pendingRow = dialog.querySelector('[data-participant-session-id="session-ai"]');
    expect(ownerRow.querySelector('[data-role-control]')).toBeDisabled();
    expect(ownerRow.querySelector('[data-revoke-control]')).toBeDisabled();

    pendingRow.querySelector('[data-role-control]').value = 'reviewer';
    pendingRow.querySelector('[data-role-control]').dispatchEvent(new Event('change', { bubbles: true }));
    expect(callbacks.onAssignRole).toHaveBeenCalledWith('session-ai', 'reviewer', 60);

    document.querySelector('[data-participant-session-id="session-editor"] [data-revoke-control]').click();
    expect(callbacks.onRevoke).toHaveBeenCalledWith('session-editor');
  });
});
