import { groupReviewItems } from '../../domain/governance-proposals.js';
import { bindAppShellElements } from '../application/app-shell-elements.js';
import { GroundWorkspaceController } from '../application/ground-workspace-controller.js';
import { deriveGovernanceShellState } from '../domain/governance-shell-state.js';
import { parseGroundRoute } from '../domain/ground-route.js';
import { EditorSession } from '../infrastructure/editor-session.js';
import { GroundApiClient } from '../infrastructure/ground-api-client.js';
import {
  GroundAuthClient,
  createGroundSupabaseClient,
} from '../infrastructure/ground-auth-client.js';
import { GroundGovernanceClient } from '../infrastructure/ground-governance-client.js';
import { SupabaseCollaborationClient } from '../infrastructure/supabase-collaboration-client.js';
import { WebMcpToolRegistry } from '../infrastructure/webmcp-tool-registry.js';
import { GovernanceUiController } from '../presentation/governance-ui-controller.js';
import { GroundEntryController } from '../presentation/ground-entry-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';

const RECOVERY_PARAM = 'recover';

// Ground has no vault, no tab takeover and no WebSocket transport, so the local
// tab-lock dialog never belongs in its accessibility tree.
const removeTabLockDialog = (elements) => {
  elements.tabLockOverlay?.remove();
};

export class GroundAppShell {
  constructor({ doc = document, history = window.history, location = window.location } = {}) {
    this.doc = doc;
    this.history = history;
    this.location = location;
    this.elements = bindAppShellElements(doc);
    this.activity = null;
    this.comments = null;
    this.session = null;
    this.shellError = null;
    this.snapshot = null;
  }

  async initialize() {
    const config = globalThis.__COLLABMD_CONFIG__ ?? {};
    removeTabLockDialog(this.elements);

    this.toastController = new ToastController(this.elements.toastContainer);
    this.themeController = new ThemeController({ doc: this.doc });
    this.themeController.initialize?.();

    const supabase = createGroundSupabaseClient(config);
    const authClient = new GroundAuthClient({ supabase });
    const { userId } = await authClient.initialize();
    this.api = new GroundApiClient({ authClient });
    this.governance = new GroundGovernanceClient({ api: this.api, supabase, userId });
    this.supabase = supabase;
    this.userId = userId;

    this.entry = this.#createEntryController();
    this.governanceUi = this.#createGovernanceUi();

    // Subscribe before the workspace controller does. The controller reacts to a
    // snapshot by building the editor session, and `EditorSession` reads
    // `canEdit` once at construction, so the shell's snapshot must already be
    // current or an Owner would get a read-only editor.
    this.governance.subscribe((snapshot, transition) => {
      this.snapshot = snapshot;
      this.shellError = transition?.error ?? null;
      this.renderGovernance();
      void this.webMcpTools?.refresh();
    });

    this.controller = this.#createWorkspaceController();
    this.webMcpTools = new WebMcpToolRegistry({
      executor: this.#createWebMcpExecutor(),
      getActiveFilePath: () => this.controller.docId ?? '',
      getIsTabActive: () => true,
      getSession: () => this.session,
      governanceClient: this.governance,
    });
    this.elements.shareGroundDocument?.addEventListener('click', () => {
      void this.entry.copyShareLink(this.controller.docId);
    });

    await this.#startRoute();
  }

  #createEntryController() {
    return new GroundEntryController({
      elements: {
        createDocumentButton: this.elements.createGroundDocument,
        displayNameDialog: this.elements.displayNameDialog,
        displayNameForm: this.elements.displayNameForm,
        displayNameInput: this.elements.displayNameInput,
        groundLanding: this.elements.groundLanding,
        groundUnavailable: this.elements.groundUnavailable,
        recoveryCloseButton: this.elements.groundRecoveryClose,
        recoveryCopyButton: this.elements.groundRecoveryCopy,
        recoveryDialog: this.elements.groundRecoveryDialog,
        recoveryLinkInput: this.elements.groundRecoveryLink,
        shareButton: this.elements.shareGroundDocument,
      },
      onCreateDocument: () => {
        void this.controller.createDocument();
      },
      origin: this.location.origin,
    });
  }

  #createGovernanceUi() {
    return new GovernanceUiController({
      documentSurface: this.elements.documentSurface,
      governanceRail: this.elements.governanceRail,
      governanceStatusCopy: this.elements.governanceStatusCopy,
      governanceStatusPanel: this.elements.governanceStatusPanel,
      governanceStatusRetry: this.elements.governanceStatusRetry,
      governanceStatusTitle: this.elements.governanceStatusTitle,
      manageAccessButton: this.elements.manageAccessButton,
      manageAccessDialog: this.elements.manageAccessDialog,
      // GovernanceUiController invokes these with positional arguments.
      onAssignRole: (participantSessionId, roleId) => this.governance.assignRole({
        roleId,
        targetUserId: participantSessionId,
      }),
      onResolveProposal: (proposalId, resolution) => this.governance.resolveProposal({
        proposalId,
        resolution,
      }),
      onRetry: () => this.governance.refresh(),
      onRevoke: (participantSessionId) => this.governance.revoke({
        targetUserId: participantSessionId,
      }),
      participantBar: this.elements.participantBar,
      skipToEditor: this.elements.skipToEditor,
    });
  }

  #createWorkspaceController() {
    return new GroundWorkspaceController({
      api: this.api,
      createSession: (options) => this.#createEditorSession(options),
      entry: this.entry,
      governance: this.governance,
      history: this.history,
      origin: this.location.origin,
    });
  }

  #createEditorSession({ docId, onAuthoritativeReload, snapshot }) {
    const session = new EditorSession({
      canComment: false,
      canEdit: () => Boolean((this.snapshot ?? snapshot)?.capabilities?.includes('document.edit')),
      createCollaborationClient: (options) => new SupabaseCollaborationClient({
        ...options,
        api: this.api,
        onAuthoritativeReload,
        supabase: this.supabase,
        userId: this.userId,
      }),
      editorContainer: this.elements.editorContainer,
      getFileList: () => [],
      getGovernanceSnapshot: () => this.snapshot,
      governed: true,
      initialTheme: this.themeController.getTheme?.(),
      lineInfoElement: null,
      onAwarenessChange: () => this.renderGovernance(),
      onContentChange: () => {
        this.renderGovernance();
        void this.webMcpTools.refresh();
      },
      preferredUserName: snapshot?.displayName,
    });
    this.session = session;

    return {
      destroy: () => {
        this.activity = null;
        this.comments = null;
        this.session = null;
        session.destroy();
      },
      initialize: async () => {
        // Reveal the document surface before CodeMirror mounts. A view mounted
        // into a hidden container measures zero height and paints no lines.
        this.renderGovernance();
        await session.initialize(docId);
        this.activity = session.collaborationClient.governanceActivity;
        this.comments = session.collaborationClient.commentThreads;
        this.activity?.observe(() => this.#handleActivityChange());
        this.comments?.observe(() => this.renderGovernance());
        // Activity delivered while this session was still connecting produced no
        // observer event, so an Owner would never learn about a visitor who
        // joined during startup. Reconcile once now that the wiring is in place.
        this.#handleActivityChange();
      },
      waitForInitialSync: () => session.waitForInitialSync(null),
    };
  }

  // Every WebMCP operation goes to the Ground server, which reauthorizes it and
  // returns the committed sequence; the tool resolves only once that sequence is
  // applied locally, so an agent never sees an unpersisted document.
  #createWebMcpExecutor() {
    const settle = async (operation, input) => {
      const result = await this.api.request(operation, {
        documentId: this.controller.docId,
        ...input,
      });
      await this.session?.collaborationClient?.waitForSequence?.(result.sequence);
      return result;
    };

    return {
      apply: async ({ replacements }) => {
        const result = await settle('webmcp_apply', {
          replacements: replacements.map(({ newText, oldText }) => ({
            expectedText: oldText,
            replacementText: newText,
          })),
        });
        return { ...result, path: this.controller.docId, replacementCount: replacements.length };
      },
      propose: ({ newText, oldText }) => settle('webmcp_propose', {
        expectedText: oldText,
        replacementText: newText,
      }),
      read: async () => {
        const { activity, headSequence, text } = await this.api.request('webmcp_read', {
          documentId: this.controller.docId,
        });
        return {
          activity,
          content: text,
          kind: 'markdown',
          path: this.controller.docId,
          revision: String(headSequence),
        };
      },
    };
  }

  // A join or an access change appends Activity to the shared document, but the
  // personal access channel notifies only the affected participant. An Owner
  // therefore rereads the roster whenever the document's Activity advances.
  #handleActivityChange() {
    this.renderGovernance();
    if (this.snapshot?.capabilities?.includes('grant.manage')) {
      void this.governance.refresh().catch(() => {});
    }
  }

  renderGovernance() {
    const documentPath = this.snapshot?.documentPath ?? this.controller?.docId ?? null;
    this.governanceUi.render({
      activity: this.activity?.toJSON() ?? [],
      connectionState: { status: this.session ? 'connected' : 'disconnected', unreachable: false },
      participants: this.snapshot?.participants ?? [],
      reviewGroups: this.#reviewGroups(),
      roles: this.governance.roles,
      session: this.snapshot,
      shellState: deriveGovernanceShellState({
        currentFilePath: documentPath,
        error: this.shellError,
        requestedDocumentPath: documentPath,
        snapshot: this.snapshot,
      }),
    });
  }

  // `groupReviewItems` needs the whole governance context, which the session
  // already assembles; passing a partial one throws and blocks the render.
  #reviewGroups() {
    const context = this.session?.getGovernanceContext?.();
    return context ? groupReviewItems(context) : [];
  }

  async #startRoute() {
    const route = parseGroundRoute(this.location.pathname);
    // The recovery token arrives in the fragment so it never reaches the server.
    // `recoverOwner` replaces the address before it sends the token anywhere.
    const fragment = (this.location.hash ?? '').replace(/^#/u, '');
    const recoveryToken = new URLSearchParams(fragment).get(RECOVERY_PARAM);
    if (route.type === 'document' && recoveryToken) {
      // A used or forged token cannot establish the claimed identity, so the
      // page stays status-only rather than falling back to an ordinary join.
      await this.controller
        .recoverOwner({ docId: route.docId, recoveryToken })
        .catch(() => this.entry.showUnavailable());
      return;
    }
    await this.controller.start(route);
  }
}
