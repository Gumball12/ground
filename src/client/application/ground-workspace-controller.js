// Owns the Ground route, Access and editor state machine. Every collaborator is
// injected, so this module imports no presentation or infrastructure adapter.
const recoveryUrl = ({ docId, origin, recoveryToken }) => (
  `${origin}/${docId}?recover=${recoveryToken}`
);

export class GroundWorkspaceController {
  constructor({ api, createSession, entry, governance, history, origin }) {
    this.api = api;
    this.createSession = createSession;
    this.entry = entry;
    this.governance = governance;
    this.history = history;
    this.origin = origin;
    this.displayName = '';
    this.docId = null;
    this.session = null;
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
    const { documentId, recoveryToken } = await this.api.request('create_document', {
      displayName,
    });
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
    const recovered = await this.governance.recover({ displayName, recoveryToken });
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
    if (this.session) {
      return;
    }
    const session = this.createSession({
      docId: this.docId,
      onAuthoritativeReload: () => {
        void this.#rebuild();
      },
      snapshot,
    });
    this.session = session;
    await session.initialize(this.docId);
    await session.waitForInitialSync();
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
  }
}
