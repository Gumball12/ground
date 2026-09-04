// Ground reuses the local GovernanceClient listener convention: every listener
// receives `(snapshot, transition)` so the existing governance presentation can
// consume a hosted session unchanged. Roles always come from the server manifest.
const STATUS_BY_CODE = Object.freeze({
  GROUND_UNAUTHENTICATED: 'invalid-session',
  GROUND_UNAVAILABLE: 'unavailable',
});

const MANAGE_CAPABILITY = 'grant.manage';

export class GroundGovernanceClient {
  constructor({ api, supabase, userId }) {
    this.api = api;
    this.supabase = supabase;
    this.userId = userId;
    this.channel = null;
    this.docId = null;
    this.generation = 0;
    this.listeners = new Set();
    this.roles = {};
    this.rolesLoaded = false;
    this.snapshot = null;
    this.version = -1;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start({ displayName, docId }) {
    const generation = this.#begin(docId);
    try {
      const { session } = await this.api.request('join_document', {
        displayName,
        documentId: docId,
      });
      const snapshot = await this.#applySession(session, { docId, generation });
      if (snapshot) {
        this.#subscribeAccess({ docId, generation });
      }
      return snapshot;
    } catch (error) {
      this.#failed(error, { docId, generation });
      throw error;
    }
  }

  async refresh() {
    const docId = this.docId;
    if (!docId) {
      return null;
    }

    const generation = this.generation;
    try {
      const { session } = await this.api.request('get_session', { documentId: docId });
      return await this.#applySession(session, { docId, generation });
    } catch (error) {
      this.#failed(error, { docId, generation });
      throw error;
    }
  }

  async assignRole({ roleId, targetUserId }) {
    return this.#decide('assign_role', {
      expectedOwnerVersion: this.snapshot?.version,
      roleId,
      targetUserId,
    });
  }

  async revoke({ targetUserId }) {
    return this.#decide('revoke_participant', {
      expectedOwnerVersion: this.snapshot?.version,
      targetUserId,
    });
  }

  async resolveProposal({ proposalId, resolution }) {
    return this.#request('resolve_proposal', { proposalId, resolution });
  }

  // Recovery precedes `start`, so the document id comes from the caller. Going
  // through `#request` here would send the `null` this client still holds.
  async recover({ displayName, docId, recoveryToken }) {
    return this.api.request('recover_owner', {
      displayName,
      documentId: docId,
      recoveryToken,
    });
  }

  destroy() {
    this.generation += 1;
    this.#removeChannel();
    this.docId = null;
    this.snapshot = null;
    this.version = -1;
  }

  // An Owner decision changes the participant list, which the personal access
  // channel reports only to the affected participant, so the Owner refreshes.
  async #decide(operation, input) {
    const result = await this.#request(operation, input);
    await this.refresh().catch(() => {});
    return result;
  }

  async #request(operation, input) {
    return this.api.request(operation, { documentId: this.docId, ...input });
  }

  async #applySession(session, context) {
    if (!this.#isCurrent(context)) {
      return null;
    }
    await this.#ensureRoles();
    const participants = await this.#readParticipants(session, context);
    if (!this.#isCurrent(context) || session.version < this.version) {
      return null;
    }

    const snapshot = Object.freeze({ ...session, participants });
    this.snapshot = snapshot;
    this.version = session.version;
    this.#publish(snapshot, { documentPath: context.docId, status: 'snapshot' });
    return snapshot;
  }

  async #readParticipants(session, context) {
    if (!session.capabilities?.includes(MANAGE_CAPABILITY)) {
      return [];
    }
    const { participants } = await this.api.request('list_participants', {
      documentId: context.docId,
    });
    return participants;
  }

  async #ensureRoles() {
    if (this.rolesLoaded) {
      return;
    }
    const { roles } = await this.api.request('list_roles');
    this.roles = Object.fromEntries(roles.map(({ capabilities, roleId }) => [roleId, capabilities]));
    this.rolesLoaded = true;
  }

  #subscribeAccess({ docId, generation }) {
    this.channel = this.supabase
      .channel(`ground-access:${this.userId}`, { config: { private: true } })
      .on('broadcast', { event: 'access' }, ({ payload }) => {
        if (payload?.documentId !== docId || !this.#isCurrent({ docId, generation })) {
          return undefined;
        }
        return this.refresh().catch(() => {});
      })
      .subscribe();
  }

  #begin(docId) {
    this.generation += 1;
    this.#removeChannel();
    this.docId = docId;
    this.snapshot = null;
    this.version = -1;
    return this.generation;
  }

  #failed(error, context) {
    if (!this.#isCurrent(context)) {
      return;
    }
    this.snapshot = null;
    this.#publish(null, {
      documentPath: context.docId,
      error,
      status: STATUS_BY_CODE[error?.code] ?? 'retryable-error',
    });
  }

  #removeChannel() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  #isCurrent({ docId, generation }) {
    return this.docId === docId && this.generation === generation;
  }

  #publish(snapshot, transition) {
    for (const listener of this.listeners) {
      listener(snapshot, transition);
    }
  }
}
