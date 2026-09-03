import { getVaultFileKind } from '../../domain/file-kind.js';

const MAX_DOCUMENT_CHARACTERS = 200_000;
const MAX_REPLACEMENTS = 20;
const MAX_REPLACEMENT_CHARACTERS = 50_000;
const SUPPORTED_FILE_KINDS = new Set(['markdown', 'mermaid', 'plantuml', 'structurizr']);
const TOOL_CAPABILITIES = Object.freeze({
  collabmd_apply_text_edits: 'document.edit',
  collabmd_propose_text_edit: 'document.suggest',
  collabmd_read_active_document: 'document.read',
});

const visibleToolsForSnapshot = (snapshot) => {
  if (snapshot?.state !== 'active' || !Array.isArray(snapshot.capabilities)) {
    return [];
  }
  return Object.entries(TOOL_CAPABILITIES)
    .filter(([, capability]) => snapshot.capabilities.includes(capability))
    .map(([name]) => name);
};

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Tool execution was cancelled', 'AbortError');
  }
}

async function createRevision(content) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateReplacements(replacements) {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error('At least one text replacement is required');
  }
  if (replacements.length > MAX_REPLACEMENTS) {
    throw new Error(`At most ${MAX_REPLACEMENTS} text replacements are allowed`);
  }

  let characterCount = 0;
  const targets = new Set();
  for (const replacement of replacements) {
    if (
      !replacement
      || typeof replacement.oldText !== 'string'
      || typeof replacement.newText !== 'string'
      || replacement.oldText.length === 0
    ) {
      throw new Error('Each replacement requires non-empty oldText and string newText');
    }
    if (replacement.oldText === replacement.newText) {
      throw new Error('A replacement must change the document');
    }
    if (targets.has(replacement.oldText)) {
      throw new Error('Requested text replacements must not target the same text twice');
    }

    characterCount += replacement.oldText.length + replacement.newText.length;
    targets.add(replacement.oldText);
  }

  if (characterCount > MAX_REPLACEMENT_CHARACTERS) {
    throw new Error(`Text replacements may contain at most ${MAX_REPLACEMENT_CHARACTERS} characters`);
  }
  return replacements;
}

function governanceError(result, capability) {
  const error = new Error(`${result?.code ?? 'CAPABILITY_DENIED'}: ${result?.message ?? `Missing ${capability}`}`);
  error.code = result?.code ?? 'CAPABILITY_DENIED';
  return error;
}

async function requireFreshCapability(governanceClient, name, path) {
  const capability = TOOL_CAPABILITIES[name];
  const result = await governanceClient.authorize(capability, path);
  if (!result?.ok) {
    throw governanceError(result, capability);
  }
  const actor = result.actor;
  const session = result.session;
  if (
    session?.state !== 'active'
    || session.documentPath !== path
    || typeof session.participantSessionId !== 'string'
    || typeof session.roleId !== 'string'
    || actor?.participantSessionId !== session.participantSessionId
    || actor?.roleId !== session.roleId
    || typeof actor.displayName !== 'string'
    || typeof actor.kind !== 'string'
  ) {
    throw governanceError({
      code: 'GOVERNANCE_SESSION_INVALID',
      message: 'The current governance session is no longer active',
    }, capability);
  }
  return actor;
}

export class WebMcpToolRegistry {
  constructor({
    getActiveFilePath,
    getIsTabActive,
    getSession,
    governanceClient,
    modelContext = globalThis.document?.modelContext ?? null,
    onDidEdit = null,
  }) {
    this.getActiveFilePath = getActiveFilePath;
    this.getIsTabActive = getIsTabActive;
    this.getSession = getSession;
    this.governanceClient = governanceClient;
    this.modelContext = modelContext;
    this.onDidEdit = onDidEdit;
    this.registration = null;
  }

  getActiveContext({ expectedPath = null } = {}) {
    const path = this.getActiveFilePath();
    const kind = getVaultFileKind(path);
    const session = this.getSession();
    if (
      !this.getIsTabActive()
      || !path
      || (expectedPath && path !== expectedPath)
      || !SUPPORTED_FILE_KINDS.has(kind)
      || !session
      || !session.isInitialSyncComplete?.()
    ) {
      throw new Error('No supported, synchronized CollabMD document is active');
    }
    return { kind, path, session };
  }

  async refresh() {
    if (typeof this.modelContext?.registerTool !== 'function') {
      return false;
    }

    let context;
    try {
      context = this.getActiveContext();
    } catch {
      this.unregister();
      return false;
    }

    const visibleTools = visibleToolsForSnapshot(this.governanceClient?.snapshot);
    if (visibleTools.length === 0) {
      this.unregister();
      return false;
    }

    const visibilityKey = visibleTools.join(',');
    if (
      this.registration?.path === context.path
      && this.registration.session === context.session
      && this.registration.visibilityKey === visibilityKey
    ) {
      return true;
    }

    this.unregister();
    const controller = new AbortController();
    const registration = {
      controller,
      path: context.path,
      session: context.session,
      visibilityKey,
    };
    this.registration = registration;

    try {
      const registrations = {
        collabmd_read_active_document: {
          name: 'collabmd_read_active_document',
          description: 'Read the active synchronized CollabMD text document before proposing edits.',
          inputSchema: {
            additionalProperties: false,
            type: 'object',
          },
          annotations: {
            readOnlyHint: true,
            untrustedContentHint: true,
          },
          execute: async (_input, { signal } = {}) => {
            throwIfAborted(signal);
            await requireFreshCapability(
              this.governanceClient,
              'collabmd_read_active_document',
              registration.path,
            );
            throwIfAborted(signal);
            const { kind, path, session } = this.getActiveContext({ expectedPath: registration.path });
            const content = session.getText();
            if (content.length > MAX_DOCUMENT_CHARACTERS) {
              throw new Error(`Documents larger than ${MAX_DOCUMENT_CHARACTERS} characters are not available to agents`);
            }
            const revision = await createRevision(content);
            throwIfAborted(signal);
            const current = this.getActiveContext({ expectedPath: path });
            if (current.session !== session || current.session.getText() !== content) {
              throw new Error('The active document changed while it was being read');
            }
            return { content, kind, path, revision };
          },
        },
        collabmd_apply_text_edits: {
          name: 'collabmd_apply_text_edits',
          description: 'Apply bounded exact-text replacements to the active synchronized CollabMD document as the logged-in collaborator.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              replacements: {
                items: {
                  additionalProperties: false,
                  properties: {
                    newText: { type: 'string' },
                    oldText: { minLength: 1, type: 'string' },
                  },
                  required: ['oldText', 'newText'],
                  type: 'object',
                },
                maxItems: MAX_REPLACEMENTS,
                minItems: 1,
                type: 'array',
              },
              revision: { type: 'string' },
            },
            required: ['path', 'revision', 'replacements'],
            type: 'object',
          },
          execute: async (input, { signal } = {}) => {
            throwIfAborted(signal);
            if (!input || typeof input.path !== 'string') {
              throw new Error('path, revision, and replacements are required');
            }
            const actor = await requireFreshCapability(
              this.governanceClient,
              'collabmd_apply_text_edits',
              input.path,
            );
            throwIfAborted(signal);
            const { path, session } = this.getActiveContext({ expectedPath: input.path });
            if (typeof input.revision !== 'string') {
              throw new Error('path, revision, and replacements are required');
            }
            const replacements = validateReplacements(input.replacements);
            const content = session.getText();
            if (content.length > MAX_DOCUMENT_CHARACTERS) {
              throw new Error(`Documents larger than ${MAX_DOCUMENT_CHARACTERS} characters cannot be edited by agents`);
            }
            const current = this.getActiveContext({ expectedPath: path });
            if (current.session !== session) {
              throw new Error('The active document changed; read it again before editing');
            }

            const result = session.applyGovernedTextEdits({
              actor,
              edits: replacements.map((edit) => ({ ...edit, revision: input.revision })),
            });
            const nextRevision = await createRevision(session.getText());
            if (result.replacementCount > 0) {
              try {
                this.onDidEdit?.({ path, replacementCount: result.replacementCount });
              } catch (error) {
                console.error('[webmcp] Failed to report an applied edit:', error.message);
              }
            }
            return { ...result, path, revision: nextRevision };
          },
        },
        collabmd_propose_text_edit: {
          name: 'collabmd_propose_text_edit',
          description: 'Propose one exact-text replacement for the active synchronized CollabMD document without changing its text.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              newText: { type: 'string' },
              oldText: { minLength: 1, type: 'string' },
              path: { type: 'string' },
              revision: { type: 'string' },
            },
            required: ['path', 'revision', 'oldText', 'newText'],
            type: 'object',
          },
          execute: async (input, { signal } = {}) => {
            throwIfAborted(signal);
            if (!input || typeof input.path !== 'string') {
              throw new Error('path, revision, oldText, and newText are required');
            }
            const actor = await requireFreshCapability(
              this.governanceClient,
              'collabmd_propose_text_edit',
              input.path,
            );
            throwIfAborted(signal);
            const { path, session } = this.getActiveContext({ expectedPath: input.path });
            if (typeof input.revision !== 'string') {
              throw new Error('path, revision, oldText, and newText are required');
            }
            const [{ oldText, newText }] = validateReplacements([input]);
            const content = session.getText();
            if (content.length > MAX_DOCUMENT_CHARACTERS) {
              throw new Error(`Documents larger than ${MAX_DOCUMENT_CHARACTERS} characters cannot be proposed by agents`);
            }
            if (await createRevision(content) !== input.revision) {
              throw new Error('The active document changed; read it again before proposing');
            }
            const current = this.getActiveContext({ expectedPath: path });
            if (current.session !== session || current.session.getText() !== content) {
              throw new Error('The active document changed; read it again before proposing');
            }
            return session.proposeTextEdit({
              actor,
              newText,
              oldText,
              revision: input.revision,
            });
          },
        },
      };
      await Promise.all(visibleTools.map((name) => this.modelContext.registerTool(
        registrations[name],
        { signal: controller.signal },
      )));
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
        console.error('[webmcp] Failed to register tools:', error.message);
      }
      if (this.registration === registration) {
        this.registration = null;
      }
      return false;
    }
  }

  unregister() {
    this.registration?.controller.abort();
    this.registration = null;
  }
}
