import { appendActivity } from '../../../domain/governance-activity.js';
import { groupReviewItems, resolveProposal } from '../../../domain/governance-proposals.js';
import { deriveGovernanceShellState } from '../../domain/governance-shell-state.js';

const actorFromSnapshot = (snapshot) => snapshot ? {
  displayName: snapshot.displayName,
  kind: snapshot.kind,
  participantSessionId: snapshot.participantSessionId,
  roleId: snapshot.roleId ?? 'pending',
} : null;

const markerAnchor = (group) => {
  if (group.unlocated || !group.proposals[0]) {
    return null;
  }
  const proposal = group.proposals[0];
  return {
    endIndex: group.to,
    endLine: proposal.anchorEndLine,
    kind: proposal.anchorKind,
    quote: proposal.anchorQuote,
    startIndex: group.from,
    startLine: proposal.anchorStartLine,
  };
};

const governanceRolesSessionKey = (shell) => {
  const snapshot = shell.governanceSnapshot;
  if (shell.governanceLoad?.phase !== 'ready'
    || snapshot?.state !== 'active'
    || !snapshot?.participantSessionId
    || snapshot.documentPath !== shell.currentFilePath
    || !shell.governanceClient?.credential) {
    return '';
  }
  return `${snapshot.documentPath}::${snapshot.participantSessionId}`;
};

export const governanceFeature = {
  async applyGovernanceSnapshotTransition(previous, next) {
    if (this.governanceLoad?.phase !== 'ready'
      && !['invalid-session', 'retryable-error'].includes(next?.state)) {
      return 0;
    }
    await this.workspaceCoordinator?.applyGovernanceTransition(previous, next);
    return this.appendGovernanceLifecycleActivity(next);
  },

  appendGovernanceLifecycleActivity(snapshot) {
    if (snapshot?.roleId !== 'owner'
      || snapshot.state !== 'active'
      || snapshot.documentPath !== this.currentFilePath) {
      return 0;
    }
    const context = this.session?.getGovernanceContext?.();
    if (!context || !Array.isArray(snapshot.participants)) {
      return 0;
    }

    const existing = new Set(context.activity.toArray().map((record) => (
      `${record.action}:${record.target}:${record.createdAt}`
    )));
    const records = [];
    for (const participant of snapshot.participants) {
      const actor = actorFromSnapshot(participant);
      const record = {
        action: 'participant_joined',
        actor,
        createdAt: participant.joinedAt,
        outcome: 'joined',
        source: 'access_management',
        target: participant.participantSessionId,
      };
      const key = `${record.action}:${record.target}:${record.createdAt}`;
      if (!existing.has(key)) {
        existing.add(key);
        records.push(record);
      }
    }
    if (records.length === 0) {
      return 0;
    }

    context.ydoc.transact(() => {
      records.forEach((record) => appendActivity(context.activity, record));
    }, 'governance-lifecycle-ui');
    return records.length;
  },

  bindGovernanceSession(session) {
    if (this._governanceActivity && this._handleGovernanceActivityChange) {
      this._governanceActivity.unobserve(this._handleGovernanceActivityChange);
    }
    if (this._governanceComments && this._handleGovernanceActivityChange) {
      this._governanceComments.unobserve(this._handleGovernanceActivityChange);
    }
    const context = session?.getGovernanceContext?.();
    this._governanceActivity = context?.activity ?? null;
    this._governanceComments = context?.comments ?? null;
    this._handleGovernanceActivityChange = () => this.renderGovernanceUi();
    this._governanceActivity?.observe(this._handleGovernanceActivityChange);
    this._governanceComments?.observe(this._handleGovernanceActivityChange);
    this.renderGovernanceUi();
  },

  getGovernanceReviewGroups() {
    const context = this.session?.getGovernanceContext?.();
    if (!context) {
      return [];
    }
    return groupReviewItems(context).map((group) => ({
      ...group,
      anchor: markerAnchor(group),
    }));
  },

  renderGovernanceUi() {
    const rolesSessionKey = governanceRolesSessionKey(this);
    if (rolesSessionKey !== this._governanceRolesSessionKey) {
      this._governanceRolesSessionKey = rolesSessionKey;
      this._governanceRolesAttemptedKey = '';
      this.governanceRoles = null;
    }
    const reviewGroups = this.getGovernanceReviewGroups();
    const context = this.session?.getGovernanceContext?.();
    const shellState = deriveGovernanceShellState({
      currentFilePath: this.currentFilePath,
      error: this.governanceLoad?.error ?? null,
      requestedDocumentPath: this.governanceLoad?.documentPath ?? null,
      snapshot: this.governanceSnapshot,
    });
    this.governanceUi?.render({
      activity: context?.activity?.toArray?.() ?? [],
      // The local room's roster is its live membership, so the bar and Manage
      // Access read the same list here.
      connectedParticipants: this.governanceSnapshot?.participants ?? [],
      connectionState: this.connectionState,
      participants: this.governanceSnapshot?.participants ?? [],
      reviewGroups,
      roles: this.governanceRoles ?? {},
      session: this.governanceSnapshot,
      shellState,
    });
    if (rolesSessionKey && this._governanceRolesAttemptedKey !== rolesSessionKey) {
      void this.loadGovernanceRoles(rolesSessionKey);
    }
  },

  async loadGovernanceRoles(rolesSessionKey = governanceRolesSessionKey(this)) {
    if (!rolesSessionKey) {
      return {};
    }
    if (this._governanceRolesAttemptedKey === rolesSessionKey) {
      return this._governanceRolesPromise ?? this.governanceRoles ?? {};
    }
    this._governanceRolesAttemptedKey = rolesSessionKey;
    const request = this.governanceRequest('/api/governance/roles')
      .then((payload) => {
        if (this._governanceRolesSessionKey !== rolesSessionKey) {
          return {};
        }
        this.governanceRoles = payload.roles ?? {};
        this.renderGovernanceUi();
        return this.governanceRoles;
      })
      .catch(() => {
        if (this._governanceRolesSessionKey === rolesSessionKey) {
          this.toastController?.show('Access controls could not be loaded.', {
            actionLabel: 'Retry',
            dismissible: true,
            duration: 0,
            onAction: () => {
              if (this._governanceRolesSessionKey !== rolesSessionKey) {
                return;
              }
              this._governanceRolesAttemptedKey = '';
              void this.loadGovernanceRoles(rolesSessionKey);
            },
            tone: 'error',
          });
        }
        return {};
      })
      .finally(() => {
        if (this._governanceRolesPromise === request) {
          this._governanceRolesPromise = null;
        }
      });
    this._governanceRolesPromise = request;
    return request;
  },

  async governanceRequest(path, options = {}) {
    const response = await this.governanceClient.fetchImpl(path, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.governanceClient.credential}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Governance request failed');
    }
    return payload;
  },

  appendGovernanceAccessActivity(transition) {
    const context = this.session?.getGovernanceContext?.();
    if (!context || typeof transition?.id !== 'string' || !transition.id) {
      return false;
    }
    if (context.activity.toArray().some((record) => record.id === transition.id)) {
      return false;
    }
    context.ydoc.transact(() => {
      appendActivity(context.activity, transition);
    }, 'governance-grant-ui');
    return true;
  },

  async assignGovernanceRole(participantSessionId, roleId) {
    const response = await this.governanceRequest(`/api/governance/grants/${encodeURIComponent(participantSessionId)}`, {
      body: JSON.stringify({ roleId }),
      method: 'PUT',
    });
    this.appendGovernanceAccessActivity(response.transition);
    await this.governanceClient.refresh();
  },

  async revokeGovernanceGrant(participantSessionId) {
    const response = await this.governanceRequest(`/api/governance/grants/${encodeURIComponent(participantSessionId)}`, {
      method: 'DELETE',
    });
    this.appendGovernanceAccessActivity(response.transition);
    await this.governanceClient.refresh();
  },

  async resolveGovernanceProposal(proposalId, resolution) {
    const authorization = await this.governanceClient.authorize('conflict.resolve', this.currentFilePath);
    const context = this.session?.getGovernanceContext?.();
    const actor = authorization.actor;
    if (!authorization.ok || !context || !actor) {
      this.toastController?.show(authorization.message || 'Conflict resolution is not allowed');
      return;
    }
    try {
      resolveProposal(context, { actor, proposalId, resolution });
      this.renderGovernanceUi();
    } catch (error) {
      this.toastController?.show(error.message || 'Failed to resolve Proposal');
    }
  },

  selectGovernanceProposal(proposalId) {
    this.governanceUi?.selectTab('review', { focus: false });
    const proposal = this.elements.governanceRail?.querySelector(`[data-proposal-id="${CSS.escape(proposalId)}"]`);
    proposal?.scrollIntoView?.({ block: 'nearest' });
    proposal?.querySelector('[data-proposal-select]')?.focus();
  },
};
