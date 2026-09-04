// Owns the Ground route, Access and editor state machine. Every collaborator is
// injected, so this module imports no presentation or infrastructure adapter.
// The token travels in the fragment, which a browser never sends to the server,
// so the one-time secret cannot reach a request log or a proxy.
const recoveryUrl = ({ docId, origin, recoveryToken }) => (
  `${origin}/${docId}#recover=${recoveryToken}`
);

const CREATE_FAILURE_MESSAGES = Object.freeze({
  GROUND_RATE_LIMITED: 'Too many documents were created recently. Try again later.',
});
const CREATE_FAILURE_FALLBACK = 'The document could not be created. Try again.';

export class GroundWorkspaceController {
  constructor({ api, createSession, entry, governance, history, notify = () => {}, origin }) {
    this.api = api;
    this.createSession = createSession;
    this.entry = entry;
    this.governance = governance;
    this.history = history;
    this.notify = notify;
    this.origin = origin;
    this.displayName = '';
    this.docId = null;
    this.session = null;
    this.sessionVersion = null;
    this.unsubscribe = governance.subscribe((snapshot, transition) => {
      void this.#applySnapshot(snapshot, transition);
    });
  }

  async start(route) {
    if (route.type === 'landing') {
      this.entry.showLanding();
      return;
    }
    if (route.type !== 'document') {
      this.entry.showUnavailable();
      return;
    }
    await this.#openDocument(route.docId);
  }

  async createDocument() {
    const displayName = await this.#requireDisplayName();
    let created;
    try {
      created = await this.api.request('create_document', { displayName });
    } catch (error) {
      // The name prompt has already closed, so a refused creation needs its own
      // notice or the landing page looks as if nothing had been asked of it.
      this.notify(CREATE_FAILURE_MESSAGES[error?.code] ?? CREATE_FAILURE_FALLBACK);
      return;
    }
    const { documentId, recoveryToken } = created;
    this.history.pushState({ docId: documentId }, '', `/${documentId}`);
    this.entry.showRecoveryLink(recoveryUrl({
      docId: documentId,
      origin: this.origin,
      recoveryToken,
    }));
    await this.#openDocument(documentId);
  }

  // The used token leaves the address bar before the request, so a reload or a
  // shared screenshot can never replay it.
  async recoverOwner({ docId, recoveryToken }) {
    this.history.replaceState({ docId }, '', `/${docId}`);
    const displayName = await this.#requireDisplayName();
    const recovered = await this.governance.recover({ displayName, docId, recoveryToken });
    this.entry.showRecoveryLink(recoveryUrl({
      docId,
      origin: this.origin,
      recoveryToken: recovered.recoveryToken,
    }));
    await this.#openDocument(docId);
  }

  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.#destroySession();
    this.governance.destroy();
  }

  async #openDocument(docId) {
    this.docId = docId;
    const displayName = await this.#requireDisplayName();
    const snapshot = await this.governance.start({ displayName, docId });
    await this.#applySnapshot(snapshot, { documentPath: docId, status: 'snapshot' });
  }

  async #requireDisplayName() {
    this.displayName ||= await this.entry.requestDisplayName();
    return this.displayName;
  }

  async #applySnapshot(snapshot, transition) {
    if (transition?.documentPath !== this.docId) {
      return;
    }
    if (!snapshot) {
      this.#destroySession();
      this.entry.showUnavailable();
      return;
    }
    if (snapshot.state !== 'active') {
      this.#destroySession();
      this.entry.showStatus(snapshot.state);
      return;
    }
    await this.#showEditor(snapshot);
  }

  async #showEditor(snapshot) {
    if (this.session && this.sessionVersion === snapshot.version) {
      return;
    }
    // A new Role version carries capabilities the editor session read once at
    // construction, so the session is rebuilt from authoritative state the same
    // way a rejected edit rebuilds it.
    this.#destroySession();
    const session = this.createSession({
      docId: this.docId,
      onAuthoritativeReload: () => {
        void this.#rebuild();
      },
      snapshot,
    });
    this.session = session;
    this.sessionVersion = snapshot.version;
    try {
      await session.initialize(this.docId);
      await session.waitForInitialSync();
    } catch (error) {
      // A session that never connected must not block the next snapshot from
      // building a fresh one, and the participant needs the retry the status
      // panel offers rather than a page that stays blank.
      if (this.session === session) {
        this.#destroySession();
        this.governance.reportFailure(error);
      }
      return;
    }
    if (this.session === session) {
      this.entry.showDocument();
    }
  }

  // A rejected local mutation means the editor may hold text the server refused,
  // so the session is discarded and rebuilt from authoritative server state.
  async #rebuild() {
    const docId = this.docId;
    this.#destroySession();
    const snapshot = await this.governance.refresh();
    if (this.docId !== docId) {
      return;
    }
    await this.#applySnapshot(snapshot, { documentPath: docId, status: 'snapshot' });
  }

  #destroySession() {
    this.session?.destroy();
    this.session = null;
    this.sessionVersion = null;
  }
}
