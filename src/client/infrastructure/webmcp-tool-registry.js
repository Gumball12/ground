import { getVaultFileKind } from '../../domain/file-kind.js';

const MAX_DOCUMENT_CHARACTERS = 200_000;
const MAX_REPLACEMENTS = 20;
const MAX_REPLACEMENT_CHARACTERS = 50_000;
const SUPPORTED_FILE_KINDS = new Set(['markdown', 'mermaid', 'plantuml', 'structurizr']);

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

    characterCount += replacement.oldText.length + replacement.newText.length;
  }

  if (characterCount > MAX_REPLACEMENT_CHARACTERS) {
    throw new Error(`Text replacements may contain at most ${MAX_REPLACEMENT_CHARACTERS} characters`);
  }
  return replacements;
}

export class WebMcpToolRegistry {
  constructor({
    getActiveFilePath,
    getIsTabActive,
    getSession,
    modelContext = globalThis.document?.modelContext ?? null,
    onDidEdit = null,
  }) {
    this.getActiveFilePath = getActiveFilePath;
    this.getIsTabActive = getIsTabActive;
    this.getSession = getSession;
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

    if (this.registration?.path === context.path && this.registration.session === context.session) {
      return true;
    }

    this.unregister();
    const controller = new AbortController();
    const registration = {
      controller,
      path: context.path,
      session: context.session,
    };
    this.registration = registration;

    try {
      await Promise.all([
        this.modelContext.registerTool({
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
        }, { signal: controller.signal }),
        this.modelContext.registerTool({
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
            if (!input || typeof input.path !== 'string' || typeof input.revision !== 'string') {
              throw new Error('path, revision, and replacements are required');
            }
            const replacements = validateReplacements(input.replacements);
            const { path, session } = this.getActiveContext({ expectedPath: input.path });
            const content = session.getText();
            if (content.length > MAX_DOCUMENT_CHARACTERS) {
              throw new Error(`Documents larger than ${MAX_DOCUMENT_CHARACTERS} characters cannot be edited by agents`);
            }
            const revision = await createRevision(content);
            throwIfAborted(signal);
            const current = this.getActiveContext({ expectedPath: path });
            if (
              current.session !== session
              || current.session.getText() !== content
              || revision !== input.revision
            ) {
              throw new Error('The active document changed; read it again before editing');
            }

            const replacementCount = session.applyTextReplacements(replacements);
            const nextRevision = await createRevision(session.getText());
            try {
              this.onDidEdit?.({ path, replacementCount });
            } catch (error) {
              console.error('[webmcp] Failed to report an applied edit:', error.message);
            }
            return { path, replacementCount, revision: nextRevision };
          },
        }, { signal: controller.signal }),
      ]);
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
