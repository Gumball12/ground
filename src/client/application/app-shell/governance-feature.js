import { appendActivity } from '../../../domain/governance-activity.js';
import { groupReviewItems, resolveProposal } from '../../../domain/governance-proposals.js';

const GOVERNED_SURFACE_KEYS = Object.freeze([
  'backlinksHeaderPanel',
  'backlinksInlinePanel',
  'backlinksPanel',
  'diffPage',
  'fileHistoryButton',
  'fileSearch',
  'gitSearch',
  'gitSidebarTab',
  'quickSwitcher',
  'reviewFileChangesButton',
  'searchFilesButton',
  'sidebar',
  'sidebarBackdrop',
  'sidebarToggle',
  'toolbarSearchButton',
]);

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
  if (!snapshot?.participantSessionId
    || snapshot.documentPath !== shell.currentFilePath
    || !shell.governanceClient?.credential) {
    return '';
  }
  return `${snapshot.documentPath}::${snapshot.participantSessionId}`;
};

export const governanceFeature = {
  async applyGovernanceSnapshotTransition(previous, next) {
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
      const candidates = [{
        action: 'participant_joined',
        actor,
        createdAt: participant.joinedAt,
        outcome: 'joined',
        target: participant.participantSessionId,
      }];
      if (participant.state === 'expired') {
        candidates.push({
          action: 'grant_expired',
          actor,
          createdAt: participant.expiresAt,
          outcome: 'expired',
          target: participant.participantSessionId,
        });
      }
      for (const record of candidates) {
        const key = `${record.action}:${record.target}:${record.createdAt}`;
        if (!existing.has(key)) {
          existing.add(key);
          records.push(record);
        }
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

  syncGovernedSurfaces(governed = this.isGovernedMode?.() === true) {
    const elements = GOVERNED_SURFACE_KEYS
      .map((key) => this.elements?.[key])
      .filter(Boolean);

    if (governed) {
      this._governanceSurfaceState ??= new Map();
      elements.forEach((element) => {
        if (!this._governanceSurfaceState.has(element)) {
          this._governanceSurfaceState.set(element, {
            hidden: element.hidden,
            inert: element.inert,
          });
        }
        element.hidden = true;
        element.inert = true;
      });
      document.body.dataset.governed = 'true';
      return;
    }

    this._governanceSurfaceState?.forEach((state, element) => {
      element.hidden = state.hidden;
      element.inert = state.inert;
    });
    this._governanceSurfaceState?.clear();
    document.body.removeAttribute('data-governed');
  },

  bindGovernanceSession(session) {
    if (this._governanceActivity && this._handleGovernanceActivityChange) {
      this._governanceActivity.unobserve(this._handleGovernanceActivityChange);
    }
    this._governanceActivity = session?.getGovernanceContext?.()?.activity ?? null;
    this._handleGovernanceActivityChange = () => this.renderGovernanceUi();
    this._governanceActivity?.observe(this._handleGovernanceActivityChange);
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
    const governed = this.isGovernedMode?.() === true;
    const rolesSessionKey = governanceRolesSessionKey(this);
    if (rolesSessionKey !== this._governanceRolesSessionKey) {
      this._governanceRolesSessionKey = rolesSessionKey;
      this._governanceRolesAttemptedKey = '';
      this.governanceRoles = null;
    }
    this.syncGovernedSurfaces(governed);
    if (!governed) {
      this.commentUi?.setReviewGroups?.([]);
      this.governanceUi?.hide();
      return;
    }

    const reviewGroups = this.getGovernanceReviewGroups();
    const context = this.session?.getGovernanceContext?.();
    this.commentUi?.setReviewGroups?.(reviewGroups);
    this.governanceUi?.render({
      activity: context?.activity?.toArray?.() ?? [],
      participants: this.governanceSnapshot?.participants ?? [],
      reviewGroups,
      roles: this.governanceRoles ?? {},
      session: this.governanceSnapshot,
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
      .catch((error) => {
        if (this._governanceRolesSessionKey === rolesSessionKey) {
          this._governanceRolesAttemptedKey = '';
          this.toastController?.show(error.message || 'Failed to load governance Roles');
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

  appendGovernanceGrantActivity(action, target) {
    const context = this.session?.getGovernanceContext?.();
    const actor = actorFromSnapshot(this.governanceSnapshot);
    if (!context || !actor) {
      return;
    }
    context.ydoc.transact(() => {
      appendActivity(context.activity, {
        action,
        actor,
        outcome: 'applied',
        target,
      });
    }, 'governance-grant-ui');
  },

  async assignGovernanceRole(participantSessionId, roleId, expiresInMinutes) {
    try {
      await this.governanceRequest(`/api/governance/grants/${encodeURIComponent(participantSessionId)}`, {
        body: JSON.stringify({ expiresInMinutes, roleId }),
        method: 'PUT',
      });
      this.appendGovernanceGrantActivity('grant_assigned', participantSessionId);
      await this.governanceClient.refresh();
    } catch (error) {
      this.toastController?.show(error.message || 'Failed to assign Role');
    }
  },

  async revokeGovernanceGrant(participantSessionId) {
    try {
      await this.governanceRequest(`/api/governance/grants/${encodeURIComponent(participantSessionId)}`, {
        method: 'DELETE',
      });
      this.appendGovernanceGrantActivity('grant_revoked', participantSessionId);
      await this.governanceClient.refresh();
    } catch (error) {
      this.toastController?.show(error.message || 'Failed to revoke Grant');
    }
  },

  async resolveGovernanceProposal(proposalId, resolution) {
    const authorization = await this.governanceClient.authorize('conflict.resolve', this.currentFilePath);
    const context = this.session?.getGovernanceContext?.();
    const actor = actorFromSnapshot(authorization.snapshot ?? this.governanceSnapshot);
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
