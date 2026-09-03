const SESSION_STORAGE_KEY = 'collabmd-governance-session';

const parseStoredSession = (storage) => {
  try {
    const value = JSON.parse(storage.getItem(SESSION_STORAGE_KEY) || 'null');
    return typeof value?.credential === 'string'
      && typeof value?.participantSessionId === 'string'
      && typeof value?.documentPath === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
};

const createGovernanceError = (code, message) => Object.assign(new Error(message), { code });

const readJson = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

export class GovernanceClient {
  constructor({ fetchImpl = globalThis.fetch.bind(globalThis), pollIntervalMs = 1000, storage = sessionStorage } = {}) {
    this.fetchImpl = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
    this.storage = storage;
    this.credential = '';
    this.currentVersion = -1;
    this.documentPath = null;
    this.failureStatus = null;
    this.generation = 0;
    this.listeners = new Set();
    this.pollTimer = null;
    this.snapshot = null;
  }

  async restoreOrCreate({ documentPath, displayName, kind }) {
    const generation = this.#beginDocument(documentPath);
    const stored = parseStoredSession(this.storage);
    if (stored && stored.documentPath !== documentPath) {
      this.storage.removeItem(SESSION_STORAGE_KEY);
    }
    if (stored?.documentPath === documentPath) {
      this.credential = stored.credential;
      const restored = await this.#getSession({ documentPath, generation, publishFailure: false });
      if (restored.status === 'snapshot') {
        this.#startPolling({ documentPath, generation });
        return restored.snapshot;
      }
      if (restored.status === 'stale') {
        return null;
      }
      if (restored.status === 'retryable-error') {
        throw restored.error;
      }
    }

    let response;
    let payload;
    try {
      response = await this.fetchImpl('/api/governance/session', {
        body: JSON.stringify({ displayName, documentPath, kind }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      payload = await readJson(response);
    } catch (cause) {
      const error = createGovernanceError('GOVERNANCE_RETRYABLE', 'Failed to create governance session');
      error.cause = cause;
      if (this.#isCurrent(documentPath, generation)) {
        this.#publishFailure('retryable-error', error, documentPath);
      }
      throw error;
    }
    if (!this.#isCurrent(documentPath, generation)) {
      return null;
    }
    if (!response.ok) {
      const error = createGovernanceError(
        response.status === 401 ? 'GOVERNANCE_SESSION_INVALID' : 'GOVERNANCE_RETRYABLE',
        payload.error || 'Failed to create governance session',
      );
      this.#publishFailure(
        response.status === 401 ? 'invalid-session' : 'retryable-error',
        error,
        documentPath,
      );
      throw error;
    }

    const { credential, ...snapshot } = payload;
    if (typeof credential !== 'string' || !credential) {
      const error = createGovernanceError('GOVERNANCE_RETRYABLE', 'Invalid governance session response');
      this.#publishFailure('retryable-error', error, documentPath);
      throw error;
    }
    this.credential = credential;
    this.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      credential: this.credential,
      documentPath: snapshot.documentPath,
      participantSessionId: snapshot.participantSessionId,
    }));
    const applied = this.#applySnapshot(snapshot, { documentPath, generation });
    if (!applied) {
      const error = createGovernanceError('GOVERNANCE_RETRYABLE', 'Invalid governance session response');
      this.#publishFailure('retryable-error', error, documentPath);
      throw error;
    }
    this.#startPolling({ documentPath, generation });
    return applied;
  }

  async authorize(capability, documentPath) {
    const credential = this.credential;
    const generation = this.generation;
    let response;
    let result;
    try {
      response = await this.fetchImpl('/api/governance/authorize', {
        body: JSON.stringify({ capability, documentPath }),
        headers: {
          Authorization: `Bearer ${credential}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      result = await readJson(response);
    } catch (cause) {
      const error = createGovernanceError('GOVERNANCE_RETRYABLE', 'Failed to authorize governance capability');
      error.cause = cause;
      if (this.#isAuthorizationCurrent({ credential, documentPath, generation }) && this.documentPath) {
        this.#publishFailure('retryable-error', error, documentPath);
      }
      return { code: error.code, message: error.message, ok: false };
    }
    if (!this.#isAuthorizationCurrent({ credential, documentPath, generation })) {
      return {
        code: 'GOVERNANCE_REQUEST_STALE',
        message: 'Governance authorization response is stale',
        ok: false,
      };
    }
    if (!response.ok) {
      const invalid = response.status === 401;
      const error = createGovernanceError(
        invalid ? 'GOVERNANCE_SESSION_INVALID' : 'GOVERNANCE_RETRYABLE',
        result.error || 'Failed to authorize governance capability',
      );
      if (this.documentPath) {
        this.#publishFailure(invalid ? 'invalid-session' : 'retryable-error', error, documentPath);
      }
      return { code: error.code, message: error.message, ok: false };
    }
    return result;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    const documentPath = this.documentPath;
    if (!documentPath || !this.credential) {
      return null;
    }

    const generation = ++this.generation;
    this.#startPolling({ documentPath, generation });
    const result = await this.#getSession({ documentPath, generation });
    if (result.status === 'snapshot') {
      return result.snapshot;
    }
    if (result.status === 'stale') {
      return null;
    }
    throw result.error;
  }

  destroy() {
    this.generation += 1;
    this.#stopPolling();
    this.credential = '';
    this.currentVersion = -1;
    this.documentPath = null;
    this.failureStatus = null;
    this.snapshot = null;
  }

  async #getSession({ documentPath, generation, publishFailure = true }) {
    const credential = this.credential;
    let response;
    let snapshot;
    try {
      response = await this.fetchImpl('/api/governance/session', {
        headers: credential ? { Authorization: `Bearer ${credential}` } : {},
      });
      snapshot = await readJson(response);
    } catch (cause) {
      if (!this.#isCurrent(documentPath, generation)) {
        return { status: 'stale' };
      }
      const error = createGovernanceError('GOVERNANCE_RETRYABLE', 'Failed to refresh governance session');
      error.cause = cause;
      this.#publishFailure('retryable-error', error, documentPath, { publish: publishFailure });
      return { error, status: 'retryable-error' };
    }
    if (!this.#isCurrent(documentPath, generation)) {
      return { status: 'stale' };
    }
    if (!response.ok) {
      const invalid = response.status === 401;
      const error = createGovernanceError(
        invalid ? 'GOVERNANCE_SESSION_INVALID' : 'GOVERNANCE_RETRYABLE',
        snapshot.error || 'Failed to refresh governance session',
      );
      this.#publishFailure(invalid ? 'invalid-session' : 'retryable-error', error, documentPath, {
        publish: publishFailure,
      });
      return { error, status: invalid ? 'invalid-session' : 'retryable-error' };
    }
    if (snapshot?.documentPath !== documentPath || !Number.isInteger(snapshot?.version)) {
      const error = createGovernanceError('GOVERNANCE_RETRYABLE', 'Invalid governance session response');
      this.#publishFailure('retryable-error', error, documentPath, { publish: publishFailure });
      return { error, status: 'retryable-error' };
    }

    const applied = this.#applySnapshot(snapshot, { documentPath, generation });
    return applied
      ? { snapshot: applied, status: 'snapshot' }
      : { status: 'stale' };
  }

  #applySnapshot(snapshot, { documentPath, generation }) {
    if (!this.#isCurrent(documentPath, generation)
      || snapshot.version < this.currentVersion) {
      return null;
    }
    if (snapshot.version === this.currentVersion && this.snapshot) {
      return this.snapshot;
    }

    this.currentVersion = snapshot.version;
    this.failureStatus = null;
    this.snapshot = snapshot;
    this.#publish(snapshot, { documentPath, status: 'snapshot' });
    return snapshot;
  }

  #publishFailure(status, error, documentPath, { publish = true } = {}) {
    const duplicate = this.snapshot === null && this.failureStatus === status;
    this.snapshot = null;
    this.failureStatus = status;
    if (status === 'invalid-session') {
      this.credential = '';
      this.currentVersion = -1;
      this.storage.removeItem(SESSION_STORAGE_KEY);
      this.#stopPolling();
    }
    if (publish && !duplicate) {
      this.#publish(null, { documentPath, error, status });
    }
  }

  #publish(snapshot, transition) {
    for (const listener of this.listeners) {
      listener(snapshot, transition);
    }
  }

  #startPolling({ documentPath, generation }) {
    this.#stopPolling();
    this.pollTimer = setInterval(() => {
      void this.#getSession({ documentPath, generation }).catch(() => {});
    }, this.pollIntervalMs);
  }

  #beginDocument(documentPath) {
    this.generation += 1;
    this.#stopPolling();
    this.credential = '';
    this.currentVersion = -1;
    this.documentPath = documentPath;
    this.failureStatus = null;
    this.snapshot = null;
    return this.generation;
  }

  #isAuthorizationCurrent({ credential, documentPath, generation }) {
    return this.generation === generation
      && this.credential === credential
      && (!this.documentPath || this.documentPath === documentPath);
  }

  #isCurrent(documentPath, generation) {
    return this.documentPath === documentPath && this.generation === generation;
  }

  #stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
