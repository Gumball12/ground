import { appendActivity } from '../../domain/governance-activity.js';
import { createProposal, resolveProposal } from '../../domain/governance-proposals.js';
import {
  actorFrom,
  anchorFor,
  groundError,
  requireText,
} from './ground-service-support.js';
import { captureGroundUpdate, encodeGroundSnapshot } from './ground-yjs-state.js';

const encodeBase64 = (bytes) => Buffer.from(bytes ?? []).toString('base64');

// The editor surface may only declare its own two kinds. Every other kind in the
// domain vocabulary is produced by a server-driven operation, never by a client
// update, so accepting one here would let a client forge an audit row.
const EDITOR_OPERATION_KINDS = Object.freeze(['document_edit', 'proposal_create']);

const COMMIT_ATTEMPTS = 3;

const readReplacements = ({ expectedText, replacementText, replacements }) => {
  if (replacements === undefined) {
    return [{ expectedText, replacementText }];
  }
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw groundError('GROUND_INVALID_REQUEST');
  }
  return replacements;
};

// A text-only request can name exactly one occurrence. A missing or repeated
// occurrence means the caller composed against text the document no longer
// holds in that form, so both are stale.
const locateUniqueText = (text, expectedText) => {
  const from = text.indexOf(requireText(expectedText));
  if (from < 0 || text.indexOf(expectedText, from + 1) >= 0) {
    throw groundError('GROUND_STALE_STATE');
  }
  return from;
};

const replaceUniqueText = ({ context, expectedText, replacementText }) => {
  const from = locateUniqueText(context.ytext.toString(), expectedText);
  context.ytext.delete(from, expectedText.length);
  if (replacementText) {
    context.ytext.insert(from, replacementText);
  }
};

export const createGroundDocumentOperations = ({ helpers }) => {
  const {
    commitCapturedUpdate,
    compactionThreshold,
    loadContext,
    now,
    requireCapability,
    requireCommitLimits,
    store,
  } = helpers;

  // Folding the log costs one snapshot encode of a Y.Doc the read already
  // built. A failure leaves the previous snapshot and log usable, so it must
  // never reach the reader.
  const compactWhenLogIsLong = async ({ context, documentId, state }) => {
    const threshold = compactionThreshold();
    if (!threshold || state.headSequence - state.snapshotSequence < threshold) {
      return;
    }
    try {
      await store.compactDocument({
        candidateSequence: state.headSequence,
        documentId,
        snapshot: encodeGroundSnapshot(context),
      });
    } catch {
      // The next read tries again.
    }
  };

  // A server-composed edit is validated against the document it loaded, and its
  // commit names that head. A commit landing in between yields
  // GROUND_STALE_STATE, so the edit is recomposed against the new head a bounded
  // number of times; a target that no longer matches fails on its own instead.
  const commitComposed = async ({ compose, documentId, operationKind, participant, source }) => {
    for (let attempt = 1; ; attempt += 1) {
      const { context, state } = await loadContext(documentId);
      const update = captureGroundUpdate(context, (mutable) => compose({ context: mutable, state }));
      try {
        return await commitCapturedUpdate({
          documentId,
          expectedHeadSequence: state.headSequence,
          operationKind,
          participant,
          source,
          update,
        });
      } catch (error) {
        if (error?.code !== 'GROUND_STALE_STATE' || attempt >= COMMIT_ATTEMPTS) {
          throw error;
        }
      }
    }
  };

  return {
    append_update: async ({
      actorId,
      documentId,
      expectedRoleVersion,
      operationKind = 'document_edit',
      update,
    }) => {
      if (!EDITOR_OPERATION_KINDS.includes(operationKind)) {
        throw groundError('GROUND_INVALID_REQUEST');
      }
      const participant = await requireCapability({
        actorId,
        capability: 'document.edit',
        documentId,
      });
      return store.commitUpdate({
        actorId,
        documentId,
        expectedRoleVersion: expectedRoleVersion ?? participant.roleVersion,
        now: now(),
        operationKind,
        source: 'document_editor',
        update: Buffer.from(requireText(update), 'base64'),
        ...requireCommitLimits(),
      });
    },

    // Yjs bytes cross the API as base64 in both directions. Returning raw
    // Uint8Arrays serializes them as numeric-key JSON objects, which inflated a
    // twelve-character document to a 10,051-byte response in a real local run.
    hydrate_document: async ({ actorId, documentId }) => {
      await requireCapability({ actorId, capability: 'document.read', documentId });
      const { context, state } = await loadContext(documentId);
      const hydrated = {
        headSequence: state.headSequence,
        snapshot: encodeBase64(state.snapshot),
        snapshotSequence: state.snapshotSequence,
        updates: state.updates.map(({ sequence, update }) => ({
          sequence,
          update: encodeBase64(update),
        })),
      };
      await compactWhenLogIsLong({ context, documentId, state });
      return hydrated;
    },

    resolve_proposal: async ({ actorId, documentId, proposalId, resolution }) => {
      const owner = await requireCapability({
        actorId,
        capability: 'conflict.resolve',
        documentId,
      });
      requireCommitLimits();
      return commitComposed({
        compose: ({ context }) => resolveProposal(context, {
          actor: actorFrom(owner),
          proposalId: requireText(proposalId),
          resolution: requireText(resolution),
        }),
        documentId,
        operationKind: 'proposal_resolve',
        participant: owner,
        source: 'owner_decision',
      });
    },

    // A WebMCP apply may carry several replacements. They are captured as one
    // update, so a stale target aborts the whole edit and commits no sequence.
    webmcp_apply: async ({ actorId, documentId, expectedText, replacementText, replacements }) => {
      const edits = readReplacements({ expectedText, replacementText, replacements });
      const participant = await requireCapability({
        actorId,
        capability: 'document.edit',
        documentId,
      });
      requireCommitLimits();
      return commitComposed({
        compose: ({ context }) => {
          for (const edit of edits) {
            replaceUniqueText({
              context,
              expectedText: edit.expectedText,
              replacementText: edit.replacementText,
            });
          }
          appendActivity(context.activity, {
            action: 'document_edit',
            actor: actorFrom(participant),
            outcome: 'applied',
            source: 'webmcp_apply',
            target: 'document',
          });
        },
        documentId,
        operationKind: 'document_edit',
        participant,
        source: 'webmcp_apply',
      });
    },

    webmcp_propose: async ({ actorId, documentId, expectedText, replacementText }) => {
      const participant = await requireCapability({
        actorId,
        capability: 'document.suggest',
        documentId,
      });
      requireCommitLimits();
      return commitComposed({
        compose: ({ context, state }) => {
          const from = locateUniqueText(context.ytext.toString(), expectedText);
          createProposal(context, {
            actor: actorFrom(participant),
            anchor: anchorFor(context.ytext, from, from + expectedText.length),
            baseRevision: String(state.headSequence),
            expectedText,
            replacementText: replacementText ?? '',
            source: 'webmcp_proposal',
          });
        },
        documentId,
        operationKind: 'proposal_create',
        participant,
        source: 'webmcp_proposal',
      });
    },

    webmcp_read: async ({ actorId, documentId }) => {
      await requireCapability({ actorId, capability: 'document.read', documentId });
      const { context, state } = await loadContext(documentId);
      return {
        activity: context.activity.toJSON(),
        headSequence: state.headSequence,
        text: context.ytext.toString(),
      };
    },
  };
};
