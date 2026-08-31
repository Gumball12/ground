const CAPABILITY_LABELS = Object.freeze({
  'conflict.resolve': 'Resolve conflicts',
  'document.comment': 'Comment',
  'document.edit': 'Edit',
  'document.read': 'Read',
  'document.suggest': 'Suggest',
  'grant.manage': 'Manage grants',
});

const STATE_LABELS = Object.freeze({
  active: 'Active',
  expired: 'Expired',
  pending: 'Pending',
  revoked: 'Revoked',
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

const activityMatches = (record, filter) => {
  if (filter === 'access') {
    return String(record.action).startsWith('grant_');
  }
  return record.actor?.kind === filter;
};

export class GovernanceUiController {
  constructor({
    governanceRail,
    manageAccessButton,
    manageAccessDialog,
    onAssignRole = () => {},
    onResolveProposal = () => {},
    onRevoke = () => {},
    onSelectProposal = () => {},
    participantBar,
  }) {
    this.governanceRail = governanceRail;
    this.manageAccessButton = manageAccessButton;
    this.manageAccessDialog = manageAccessDialog;
    this.onAssignRole = onAssignRole;
    this.onResolveProposal = onResolveProposal;
    this.onRevoke = onRevoke;
    this.onSelectProposal = onSelectProposal;
    this.participantBar = participantBar;
    this.activeTab = 'review';
    this.activityFilters = new Set();
    this.state = {
      activity: [],
      participants: [],
      reviewGroups: [],
      roles: {},
      session: null,
    };

    this.manageAccessButton?.addEventListener('click', () => {
      this.manageAccessDialog?.showModal?.();
    });
    this.manageAccessDialog?.querySelector('[data-manage-access-close]')?.addEventListener('click', () => {
      this.manageAccessDialog?.close?.();
    });
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
      participants: Array.isArray(state.participants) ? state.participants : [],
      reviewGroups: Array.isArray(state.reviewGroups) ? state.reviewGroups : [],
      roles: state.roles && typeof state.roles === 'object' ? state.roles : {},
      session: state.session ?? null,
    };

    if (this.participantBar) {
      this.participantBar.hidden = false;
    }
    if (this.governanceRail) {
      this.governanceRail.hidden = false;
    }
    this.renderParticipants();
    this.renderReview();
    this.renderActivity();
    this.renderRoles();
    this.renderManageAccess();
    this.selectTab(this.activeTab, { focus: false });
  }

  hide() {
    if (this.participantBar) {
      this.participantBar.hidden = true;
      this.participantBar.replaceChildren();
    }
    if (this.governanceRail) {
      this.governanceRail.hidden = true;
    }
    if (this.manageAccessButton) {
      this.manageAccessButton.hidden = true;
    }
    this.manageAccessDialog?.close?.();
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
    if (!this.participantBar) {
      return;
    }
    const fragment = document.createDocumentFragment();
    const label = appendText(fragment, 'span', 'Participants', 'governance-kicker');
    label.id = 'participantBarLabel';
    this.participantBar.setAttribute('aria-labelledby', label.id);

    const list = createElement('div', { className: 'participant-list' });
    this.state.participants.forEach((participant) => {
      const self = participant.participantSessionId === this.state.session?.participantSessionId;
      list.appendChild(this.createParticipant(participant, { self }));
    });
    fragment.appendChild(list);
    this.participantBar.replaceChildren(fragment);

    const canManage = this.state.session?.state === 'active'
      && this.state.roles[this.state.session?.roleId]?.includes('grant.manage') === true;
    if (this.manageAccessButton) {
      this.manageAccessButton.hidden = !canManage;
      this.participantBar.appendChild(this.manageAccessButton);
    }
  }

  createParticipant(participant, { self = false } = {}) {
    const item = createElement('article', { className: 'participant-item' });
    item.dataset.participantSessionId = participant.participantSessionId;
    item.dataset.participantKind = participant.kind === 'ai' ? 'ai' : 'human';
    item.dataset.grantState = STATE_LABELS[participant.state] ? participant.state : 'pending';
    if (self) {
      item.dataset.self = 'true';
    }

    const avatar = appendText(
      item,
      'span',
      participant.kind === 'ai' ? 'AI' : String(participant.displayName || '?').slice(0, 1).toUpperCase(),
      'user-avatar governance-avatar',
    );
    avatar.setAttribute('aria-hidden', 'true');

    const identity = createElement('span', { className: 'participant-identity' });
    appendText(identity, 'strong', participant.displayName || 'Unnamed', 'participant-name');
    const metadata = createElement('span', { className: 'participant-metadata' });
    appendText(metadata, 'span', participant.kind === 'ai' ? 'AI' : 'Human');
    appendText(metadata, 'span', titleCase(participant.roleId || 'Unassigned'));
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
    appendText(item, 'p', `${proposal.expectedText} → ${proposal.replacementText}`, 'proposal-change');
    appendText(item, 'p', `By ${proposal.createdByDisplayName || 'Unknown'} · ${titleCase(proposal.status)}`, 'proposal-meta');

    const actions = createElement('div', { className: 'proposal-actions' });
    const canResolve = this.state.session?.state === 'active'
      && this.state.roles[this.state.session?.roleId]?.includes('conflict.resolve') === true;
    for (const [resolution, label] of [['keep_current', 'Keep current'], ['apply_proposed', 'Apply']]) {
      const button = createElement('button', {
        className: resolution === 'apply_proposed'
          ? 'ui-button ui-button--primary ui-button--compact'
          : 'ui-button ui-button--secondary ui-button--compact',
        text: label,
      });
      button.type = 'button';
      button.dataset.proposalResolution = resolution;
      button.disabled = !canResolve || (unlocated && resolution === 'apply_proposed');
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
    const filters = createElement('div', { className: 'activity-filters' });
    filters.setAttribute('aria-label', 'Activity filters');
    for (const [filter, label] of [['human', 'Human'], ['ai', 'AI'], ['access', 'Access']]) {
      const button = createElement('button', { className: 'ui-chip-button', text: label });
      button.type = 'button';
      button.dataset.activityFilter = filter;
      button.setAttribute('aria-pressed', String(this.activityFilters.has(filter)));
      button.addEventListener('click', () => {
        if (this.activityFilters.has(filter)) {
          this.activityFilters.delete(filter);
        } else {
          this.activityFilters.add(filter);
        }
        this.renderActivity();
      });
      filters.appendChild(button);
    }
    panel.appendChild(filters);

    const records = this.activityFilters.size === 0
      ? this.state.activity
      : this.state.activity.filter((record) => (
        [...this.activityFilters].some((filter) => activityMatches(record, filter))
      ));
    const list = createElement('ol', { className: 'activity-list' });
    records.toReversed().forEach((record) => {
      const item = createElement('li', { className: 'activity-item' });
      item.dataset.activityId = record.id;
      appendText(item, 'strong', record.actor?.displayName || 'Unknown');
      appendText(
        item,
        'span',
        `${record.actor?.kind === 'ai' ? 'AI' : titleCase(record.actor?.kind || 'unknown')} · ${titleCase(record.actor?.roleId || 'unknown')}`,
        'activity-meta',
      );
      appendText(item, 'span', titleCase(record.action));
      appendText(item, 'span', `${titleCase(record.outcome)} · ${record.target}`, 'activity-meta');
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
    if (records.length === 0) {
      appendText(panel, 'p', 'No matching activity.', 'ui-empty-state ui-empty-state--compact');
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
    const caption = appendText(table, 'caption', 'Role capabilities');
    caption.className = 'sr-only';
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
      const row = createElement('div', { className: 'manage-access-row' });
      row.dataset.participantSessionId = participant.participantSessionId;
      row.dataset.owner = String(owner);
      const identity = createElement('div', { className: 'manage-access-identity' });
      appendText(identity, 'strong', participant.displayName || 'Unnamed');
      appendText(identity, 'span', `${participant.kind === 'ai' ? 'AI' : 'Human'} · ${STATE_LABELS[participant.state] || 'Pending'}`);
      row.appendChild(identity);

      const roleControl = document.createElement('select');
      roleControl.className = 'ui-input';
      roleControl.dataset.roleControl = '';
      roleControl.setAttribute('aria-label', `Role for ${participant.displayName}`);
      roleControl.disabled = owner;
      const placeholder = appendText(roleControl, 'option', owner ? 'Owner' : 'Assign role');
      placeholder.value = '';
      placeholder.selected = owner || !participant.roleId;
      roleIds.forEach((roleId) => {
        const option = appendText(roleControl, 'option', titleCase(roleId));
        option.value = roleId;
        option.selected = participant.roleId === roleId;
      });

      const expiryControl = document.createElement('input');
      expiryControl.className = 'ui-input';
      expiryControl.dataset.expiryControl = '';
      expiryControl.type = 'number';
      expiryControl.min = '1';
      expiryControl.max = '1440';
      expiryControl.value = '60';
      expiryControl.disabled = owner;
      expiryControl.setAttribute('aria-label', `Grant minutes for ${participant.displayName}`);
      roleControl.addEventListener('change', () => {
        if (roleControl.value) {
          this.onAssignRole(participant.participantSessionId, roleControl.value, Number(expiryControl.value));
        }
      });

      const revoke = createElement('button', {
        className: 'ui-button ui-button--danger ui-button--compact',
        text: owner ? 'Owner' : 'Revoke',
      });
      revoke.type = 'button';
      revoke.dataset.revokeControl = '';
      revoke.disabled = owner || participant.state !== 'active';
      revoke.addEventListener('click', () => this.onRevoke(participant.participantSessionId));
      row.append(roleControl, expiryControl, revoke);
      list.appendChild(row);
    });
  }
}
