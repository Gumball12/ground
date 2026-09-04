const CAPABILITY_LABELS = Object.freeze({
  'conflict.resolve': 'Resolve conflicts',
  'document.edit': 'Edit',
  'document.read': 'Read',
  'document.suggest': 'Suggest',
  'grant.manage': 'Manage access',
});

const STATE_LABELS = Object.freeze({
  active: 'Active',
  pending: 'Pending',
  revoked: 'Revoked',
});

const ACTIVITY_SOURCE_LABELS = Object.freeze({
  access_management: 'Access management',
  document_editor: 'Document editor',
  owner_decision: 'Owner decision',
  system_reconciliation: 'System reconciliation',
  webmcp_apply: 'WebMCP apply',
  webmcp_proposal: 'WebMCP proposal',
});

const ACTIVITY_ACTION_LABELS = Object.freeze({
  grant_assigned: 'Role assigned',
  grant_changed: 'Role changed',
  grant_revoked: 'Access revoked',
});

const STATUS_CONTENT = Object.freeze({
  error: {
    copy: 'CollabMD could not verify your Access. Retry without leaving this page.',
    title: 'Unable to check access',
  },
  loading: {
    copy: 'Checking your Role for this document.',
    title: 'Checking access',
  },
  pending: {
    copy: 'The Owner must assign you a Role. This page updates automatically.',
    title: 'Waiting for access',
  },
  revoked: {
    copy: 'Your Access was revoked. The Owner can assign you a Role again.',
    title: 'Access revoked',
  },
});

const titleCase = (value) => String(value || '')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase());

const createElement = (tagName, { className = '', text = '' } = {}) => {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  return element;
};

const appendText = (parent, tagName, text, className = '') => {
  const element = createElement(tagName, { className, text });
  parent.appendChild(element);
  return element;
};

const connectionLabel = (status) => ({
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
}[status] ?? 'Disconnected');

const isOwner = (state) => state.session?.state === 'active'
  && state.roles[state.session?.roleId]?.includes('grant.manage') === true;

export class GovernanceUiController {
  constructor({
    documentSurface,
    governanceRail,
    governanceStatusCopy,
    governanceStatusPanel,
    governanceStatusRetry,
    governanceStatusTitle,
    manageAccessButton,
    manageAccessDialog,
    onAssignRole = () => {},
    onResolveProposal = () => {},
    onRetry = () => {},
    onRevoke = () => {},
    onSelectProposal = () => {},
    participantBar,
    skipToEditor,
  }) {
    this.documentSurface = documentSurface;
    this.governanceRail = governanceRail;
    this.governanceStatusCopy = governanceStatusCopy;
    this.governanceStatusPanel = governanceStatusPanel;
    this.governanceStatusRetry = governanceStatusRetry;
    this.governanceStatusTitle = governanceStatusTitle;
    this.manageAccessButton = manageAccessButton;
    this.manageAccessDialog = manageAccessDialog;
    this.onAssignRole = onAssignRole;
    this.onResolveProposal = onResolveProposal;
    this.onRetry = onRetry;
    this.onRevoke = onRevoke;
    this.onSelectProposal = onSelectProposal;
    this.participantBar = participantBar;
    this.skipToEditor = skipToEditor;
    this.activeTab = 'review';
    this.roleDrafts = new Map();
    this.roleRequestStates = new Map();
    this.authoritativeRoles = new Map();
    this.state = {
      activity: [],
      connectionState: { status: 'disconnected', unreachable: false },
      participants: [],
      reviewGroups: [],
      roles: {},
      session: null,
      shellState: { accessState: null, phase: 'loading' },
    };

    this.manageAccessButton?.addEventListener('click', () => {
      if (isOwner(this.state)) {
        this.manageAccessDialog?.showModal?.();
        this.manageAccessDialog?.querySelector('#manageAccessTitle')?.focus();
      }
    });
    this.manageAccessDialog?.querySelector('[data-manage-access-close]')?.addEventListener('click', () => {
      this.manageAccessDialog?.close?.();
    });
    this.manageAccessDialog?.addEventListener('close', () => {
      if (this.manageAccessButton && !this.manageAccessButton.hidden) {
        this.manageAccessButton.focus();
      }
    });
    this.governanceStatusRetry?.addEventListener('click', () => this.onRetry());
    this.governanceRail?.querySelector('[role="tablist"]')?.addEventListener('click', (event) => {
      const tab = event.target.closest?.('[data-governance-tab]');
      if (tab) {
        this.selectTab(tab.dataset.governanceTab, { focus: false });
      }
    });
    this.governanceRail?.querySelector('[role="tablist"]')?.addEventListener('keydown', (event) => {
      this.handleTabKeydown(event);
    });
  }

  render(state = {}) {
    this.state = {
      activity: Array.isArray(state.activity) ? state.activity : [],
      // The Participant bar draws who is connected now; Manage Access draws the
      // durable roster. They are different lists and must stay separate.
      connectedParticipants: Array.isArray(state.connectedParticipants)
        ? state.connectedParticipants
        : [],
      connectionState: state.connectionState ?? { status: 'disconnected', unreachable: false },
      participants: Array.isArray(state.participants) ? state.participants : [],
      reviewGroups: Array.isArray(state.reviewGroups) ? state.reviewGroups : [],
      roles: state.roles && typeof state.roles === 'object' ? state.roles : {},
      session: state.session ?? null,
      shellState: state.shellState ?? { accessState: null, phase: 'loading' },
    };
    this.reconcileRoleDrafts();

    const ready = this.state.shellState.phase === 'ready';
    const accessState = this.state.shellState.accessState;
    const active = ready && accessState === 'active';
    const owner = active && isOwner(this.state);

    const showParticipants = ready && ['active', 'pending', 'revoked'].includes(accessState);

    this.renderStatus();
    if (this.participantBar) {
      this.participantBar.hidden = !showParticipants;
      if (showParticipants) {
        this.renderParticipants();
      } else {
        this.participantBar.replaceChildren();
      }
    }
    if (this.documentSurface) {
      this.documentSurface.hidden = !active;
      this.documentSurface.dataset.owner = String(owner);
    }
    if (this.skipToEditor) {
      this.skipToEditor.hidden = !active;
      this.skipToEditor.tabIndex = active ? 0 : -1;
    }
    if (this.governanceRail) {
      this.governanceRail.hidden = !owner;
    }
    if (this.manageAccessButton) {
      this.manageAccessButton.hidden = !owner;
    }

    if (!owner) {
      this.manageAccessDialog?.close?.();
      return;
    }

    this.renderReview();
    this.renderActivity();
    this.renderRoles();
    this.renderManageAccess();
    this.selectTab(this.activeTab, { focus: false });
  }

  hide() {
    this.participantBar?.replaceChildren();
    if (this.participantBar) {
      this.participantBar.hidden = true;
    }
    if (this.documentSurface) {
      this.documentSurface.hidden = true;
    }
    if (this.governanceRail) {
      this.governanceRail.hidden = true;
    }
    if (this.governanceStatusPanel) {
      this.governanceStatusPanel.hidden = true;
    }
    if (this.skipToEditor) {
      this.skipToEditor.hidden = true;
      this.skipToEditor.tabIndex = -1;
    }
    if (this.manageAccessButton) {
      this.manageAccessButton.hidden = true;
    }
    this.manageAccessDialog?.close?.();
  }

  renderStatus() {
    const { accessState, phase } = this.state.shellState;
    const statusKey = phase === 'ready' ? accessState : phase;
    const content = STATUS_CONTENT[statusKey];
    if (this.governanceStatusPanel) {
      this.governanceStatusPanel.hidden = !content;
    }
    if (!content) {
      return;
    }
    if (this.governanceStatusTitle) {
      this.governanceStatusTitle.textContent = content.title;
    }
    if (this.governanceStatusCopy) {
      this.governanceStatusCopy.textContent = content.copy;
    }
    if (this.governanceStatusRetry) {
      this.governanceStatusRetry.hidden = phase !== 'error';
    }
  }

  handleTabKeydown(event) {
    const tabs = Array.from(this.governanceRail?.querySelectorAll('[data-governance-tab]') ?? []);
    const currentIndex = tabs.indexOf(event.target.closest?.('[data-governance-tab]'));
    if (currentIndex < 0) {
      return;
    }

    let nextIndex;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    this.selectTab(tabs[nextIndex].dataset.governanceTab, { focus: true });
  }

  selectTab(tabName, { focus = false } = {}) {
    const selectedTab = this.governanceRail?.querySelector(`[data-governance-tab="${tabName}"]`);
    if (!selectedTab) {
      return;
    }
    this.activeTab = tabName;
    this.governanceRail.querySelectorAll('[data-governance-tab]').forEach((tab) => {
      const selected = tab === selectedTab;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('active', selected);
    });
    this.governanceRail.querySelectorAll('[data-governance-panel]').forEach((panel) => {
      const selected = panel.dataset.governancePanel === tabName;
      panel.hidden = !selected;
      panel.setAttribute('role', 'tabpanel');
    });
    if (focus) {
      selectedTab.focus();
    }
  }

  renderParticipants() {
    const fragment = document.createDocumentFragment();
    const label = appendText(fragment, 'span', 'Participants', 'governance-kicker');
    label.id = 'participantBarLabel';
    this.participantBar.setAttribute('aria-labelledby', label.id);

    const connection = appendText(
      fragment,
      'span',
      connectionLabel(this.state.connectionState.status),
      'governance-connection',
    );
    connection.dataset.governanceConnection = '';

    const list = createElement('div', { className: 'participant-list' });
    this.state.connectedParticipants.forEach((participant) => {
      const self = participant.participantSessionId === this.state.session?.participantSessionId;
      list.appendChild(this.createParticipant(participant, { self }));
    });
    fragment.appendChild(list);
    this.participantBar.replaceChildren(fragment);
    if (this.manageAccessButton) {
      this.participantBar.appendChild(this.manageAccessButton);
    }
  }

  createParticipant(participant, { self = false } = {}) {
    const item = createElement('article', { className: 'participant-item' });
    item.dataset.participantSessionId = participant.participantSessionId;
    item.dataset.grantState = STATE_LABELS[participant.state] ? participant.state : 'pending';
    if (self) {
      item.dataset.self = 'true';
    }

    const avatar = appendText(
      item,
      'span',
      String(participant.displayName || '?').slice(0, 1).toUpperCase(),
      'governance-avatar',
    );
    avatar.setAttribute('aria-hidden', 'true');

    const identity = createElement('span', { className: 'participant-identity' });
    appendText(identity, 'strong', participant.displayName || 'Unnamed', 'participant-name');
    const metadata = createElement('span', { className: 'participant-metadata' });
    // Only an Owner can read the roster a Role comes from. Every other viewer
    // gets no Role line rather than a guess.
    if (participant.roleId) {
      appendText(metadata, 'span', titleCase(participant.roleId));
    }
    appendText(
      metadata,
      'span',
      STATE_LABELS[participant.state] || STATE_LABELS.pending,
      `ui-status-badge governance-state governance-state--${participant.state || 'pending'}`,
    );
    if (self) {
      appendText(metadata, 'span', 'You', 'ui-pill-badge ui-pill-badge--accent');
    }
    identity.appendChild(metadata);
    item.appendChild(identity);
    return item;
  }

  renderReview() {
    const panel = this.governanceRail?.querySelector('[data-governance-panel="review"]');
    if (!panel) {
      return;
    }
    panel.replaceChildren();
    if (this.state.reviewGroups.length === 0) {
      appendText(panel, 'p', 'No open Proposals or Conflicts.', 'ui-empty-state ui-empty-state--compact');
      return;
    }

    this.state.reviewGroups.forEach((group, groupIndex) => {
      const section = createElement('section', { className: 'review-group' });
      section.dataset.conflictGroup = String(groupIndex);
      section.dataset.unlocated = String(Boolean(group.unlocated));
      appendText(
        section,
        'h3',
        group.unlocated ? 'Unlocated conflicts' : `Location ${group.from + 1}-${group.to}`,
        'review-group-title',
      );
      group.proposals.forEach((proposal) => {
        section.appendChild(this.createProposal(proposal, { unlocated: group.unlocated }));
      });
      panel.appendChild(section);
    });
  }

  createProposal(proposal, { unlocated = false } = {}) {
    const item = createElement('article', { className: 'proposal-card' });
    item.dataset.proposalId = proposal.id;
    const select = createElement('button', {
      className: 'proposal-select',
      text: unlocated
        ? 'Unlocated conflict'
        : proposal.status === 'conflict' ? 'Conflict' : 'Proposal',
    });
    select.type = 'button';
    select.dataset.proposalSelect = '';
    select.addEventListener('click', () => this.onSelectProposal(proposal.id));
    item.appendChild(select);
    const change = createElement('p', { className: 'proposal-change' });
    appendText(change, 'span', `Current: ${proposal.currentText ?? 'Unavailable'}`);
    change.append(' · ');
    appendText(change, 'span', `Proposed: ${proposal.replacementText}`);
    item.appendChild(change);
    appendText(
      item,
      'p',
      `By ${proposal.createdByDisplayName || 'Unknown'} · Role at creation: ${titleCase(proposal.createdByRole || 'unknown')} · ${titleCase(proposal.status)}`,
      'proposal-meta',
    );

    const actions = createElement('div', { className: 'proposal-actions' });
    const canResolve = this.state.roles[this.state.session?.roleId]?.includes('conflict.resolve') === true;
    const resolutions = unlocated
      ? [['keep_current', 'Keep current']]
      : [['keep_current', 'Keep current'], ['apply_proposed', 'Apply']];
    for (const [resolution, label] of resolutions) {
      const button = createElement('button', {
        className: resolution === 'apply_proposed'
          ? 'ui-button ui-button--primary ui-button--compact'
          : 'ui-button ui-button--secondary ui-button--compact',
        text: label,
      });
      button.type = 'button';
      button.dataset.proposalResolution = resolution;
      button.disabled = !canResolve;
      button.addEventListener('click', () => {
        if (resolution === 'apply_proposed'
          && !window.confirm('Apply this proposed change to the document? This will replace the current text.')) {
          return;
        }
        this.onResolveProposal(proposal.id, resolution);
      });
      actions.appendChild(button);
    }
    item.appendChild(actions);
    return item;
  }

  renderActivity() {
    const panel = this.governanceRail?.querySelector('[data-governance-panel="activity"]');
    if (!panel) {
      return;
    }
    panel.replaceChildren();
    const list = createElement('ol', { className: 'activity-list' });
    this.state.activity.toReversed().forEach((record) => {
      const item = createElement('li', { className: 'activity-item' });
      item.dataset.activityId = record.id;
      appendText(item, 'strong', record.actor?.displayName || 'Unknown');
      appendText(
        item,
        'span',
        `Page session: ${record.actor?.participantSessionId || 'unknown'}`,
        'activity-meta',
      );
      appendText(item, 'span', `Role: ${titleCase(record.actor?.roleId || 'unknown')}`, 'activity-meta');
      appendText(item, 'span', ACTIVITY_ACTION_LABELS[record.action] || titleCase(record.action));
      appendText(
        item,
        'span',
        `Source: ${ACTIVITY_SOURCE_LABELS[record.source] || titleCase(record.source || 'unknown')}`,
        'activity-meta',
      );
      appendText(item, 'span', `Outcome: ${titleCase(record.outcome)} · Target: ${record.target}`, 'activity-meta');
      const createdAt = new Date(record.createdAt);
      const timestamp = appendText(
        item,
        'time',
        Number.isNaN(createdAt.getTime()) ? 'Unknown time' : createdAt.toLocaleString(),
        'activity-meta',
      );
      if (!Number.isNaN(createdAt.getTime())) {
        timestamp.dateTime = createdAt.toISOString();
      }
      list.appendChild(item);
    });
    if (this.state.activity.length === 0) {
      appendText(panel, 'p', 'No activity yet.', 'ui-empty-state ui-empty-state--compact');
    } else {
      panel.appendChild(list);
    }
  }

  renderRoles() {
    const panel = this.governanceRail?.querySelector('[data-governance-panel="roles"]');
    if (!panel) {
      return;
    }
    panel.replaceChildren();
    const table = createElement('table', { className: 'role-capability-matrix' });
    table.id = 'roleCapabilityMatrix';
    appendText(table, 'caption', 'Role capabilities', 'sr-only');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    appendText(headRow, 'th', 'Capability').scope = 'col';
    const roleIds = Object.keys(this.state.roles);
    roleIds.forEach((roleId) => {
      const header = appendText(headRow, 'th', titleCase(roleId));
      header.scope = 'col';
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    Object.keys(CAPABILITY_LABELS).forEach((capability) => {
      const row = document.createElement('tr');
      const label = appendText(row, 'th', CAPABILITY_LABELS[capability]);
      label.scope = 'row';
      roleIds.forEach((roleId) => {
        const allowed = this.state.roles[roleId]?.includes(capability) === true;
        const cell = appendText(row, 'td', allowed ? 'Allowed' : 'Not allowed');
        cell.dataset.capabilityState = allowed ? 'allowed' : 'denied';
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    panel.appendChild(table);
  }

  renderManageAccess() {
    const list = this.manageAccessDialog?.querySelector('[data-manage-access-list]');
    if (!list) {
      return;
    }
    list.replaceChildren();
    const roleIds = Object.keys(this.state.roles).filter((roleId) => roleId !== 'owner');
    this.state.participants.forEach((participant) => {
      const owner = participant.roleId === 'owner';
      const requestState = this.roleRequestStates.get(participant.participantSessionId) ?? {};
      const roleDraft = this.roleDrafts.get(participant.participantSessionId) ?? '';
      const row = createElement('div', { className: 'manage-access-row' });
      row.dataset.participantSessionId = participant.participantSessionId;
      row.dataset.owner = String(owner);
      const identity = createElement('div', { className: 'manage-access-identity' });
      appendText(identity, 'strong', participant.displayName || 'Unnamed');
      appendText(identity, 'span', STATE_LABELS[participant.state] || 'Pending');
      row.appendChild(identity);

      const roleControl = document.createElement('select');
      roleControl.className = 'ui-input';
      roleControl.dataset.roleControl = '';
      roleControl.setAttribute('aria-label', `Role for ${participant.displayName}`);
      roleControl.disabled = owner || requestState.pending === true;
      const placeholder = appendText(roleControl, 'option', owner ? 'Owner' : 'Assign role');
      placeholder.value = '';
      placeholder.selected = owner || !roleDraft;
      roleIds.forEach((roleId) => {
        const option = appendText(roleControl, 'option', titleCase(roleId));
        option.value = roleId;
        option.selected = roleDraft === roleId;
      });
      roleControl.addEventListener('change', () => {
        this.roleDrafts.set(participant.participantSessionId, roleControl.value);
        this.roleRequestStates.delete(participant.participantSessionId);
        submit.disabled = !roleControl.value;
        status.textContent = '';
      });

      const submit = createElement('button', {
        className: 'ui-button ui-button--primary ui-button--compact',
        text: participant.state === 'active' ? 'Update role' : 'Assign role',
      });
      submit.type = 'button';
      submit.dataset.roleSubmit = '';
      submit.disabled = owner || requestState.pending === true || !roleDraft;
      submit.addEventListener('click', () => {
        void this.submitRole(participant);
      });

      const revoke = createElement('button', {
        className: 'ui-button ui-button--danger ui-button--compact',
        text: 'Revoke access',
      });
      revoke.type = 'button';
      revoke.dataset.revokeControl = '';
      revoke.disabled = requestState.pending === true;
      revoke.addEventListener('click', () => {
        void this.revokeRole(participant);
      });
      const status = appendText(row, 'p', requestState.error || requestState.success || '', 'manage-access-status');
      status.dataset.roleInlineStatus = '';
      status.setAttribute('aria-live', 'polite');
      row.append(roleControl, submit);
      if (!owner && participant.state === 'active') {
        row.appendChild(revoke);
      }
      list.appendChild(row);
    });
  }

  reconcileRoleDrafts() {
    const participantIds = new Set();
    this.state.participants.forEach((participant) => {
      const participantSessionId = participant.participantSessionId;
      const roleId = participant.roleId ?? '';
      participantIds.add(participantSessionId);
      if (!this.authoritativeRoles.has(participantSessionId)
        || this.authoritativeRoles.get(participantSessionId) !== roleId) {
        this.roleDrafts.set(participantSessionId, roleId);
      }
      this.authoritativeRoles.set(participantSessionId, roleId);
    });
    for (const participantSessionId of this.authoritativeRoles.keys()) {
      if (!participantIds.has(participantSessionId)) {
        this.authoritativeRoles.delete(participantSessionId);
        this.roleDrafts.delete(participantSessionId);
        this.roleRequestStates.delete(participantSessionId);
      }
    }
  }

  async submitRole(participant) {
    const participantSessionId = participant.participantSessionId;
    const roleId = this.roleDrafts.get(participantSessionId);
    if (!roleId || participant.roleId === 'owner') {
      return;
    }
    this.roleRequestStates.set(participantSessionId, { pending: true });
    this.renderManageAccess();
    try {
      await this.onAssignRole(participantSessionId, roleId);
      this.roleRequestStates.set(participantSessionId, { success: 'Role updated' });
    } catch (error) {
      const currentParticipant = this.state.participants.find((item) => (
        item.participantSessionId === participantSessionId
      ));
      this.roleDrafts.set(participantSessionId, currentParticipant?.roleId ?? '');
      this.roleRequestStates.set(participantSessionId, { error: error?.message || 'Failed to update Role' });
    }
    this.renderManageAccess();
  }

  async revokeRole(participant) {
    if (participant.roleId === 'owner' || participant.state !== 'active') {
      return;
    }
    if (!window.confirm(`Revoke access for ${participant.displayName || 'this participant'}? Unsynchronized local work may be discarded.`)) {
      return;
    }
    const participantSessionId = participant.participantSessionId;
    this.roleRequestStates.set(participantSessionId, { pending: true });
    this.renderManageAccess();
    try {
      await this.onRevoke(participantSessionId);
      this.roleRequestStates.set(participantSessionId, { success: 'Access revoked' });
    } catch (error) {
      this.roleDrafts.set(participantSessionId, participant.roleId ?? '');
      this.roleRequestStates.set(participantSessionId, { error: error?.message || 'Failed to revoke access' });
    }
    this.renderManageAccess();
  }
}
