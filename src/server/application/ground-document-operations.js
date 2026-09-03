import { appendActivity } from '../../domain/governance-activity.js';
import { createProposal, resolveProposal } from '../../domain/governance-proposals.js';
import {
  actorFrom,
  anchorFor,
  groundError,
  requireText,
} from './ground-service-support.js';
import { captureGroundUpdate } from './ground-yjs-state.js';

const encodeBase64 = (bytes) => Buffer.from(bytes ?? []).toString('base64');

const replaceUniqueText = ({ context, expectedText, replacementText }) => {
  const text = context.ytext.toString();
  const from = text.indexOf(requireText(expectedText));
  if (from < 0 || text.indexOf(expectedText, from + 1) >= 0) {
    throw groundError('GROUND_STALE_STATE');
  }
  context.ytext.delete(from, expectedText.length);
  if (replacementText) {
    context.ytext.insert(from, replacementText);
  }
};

export const createGroundDocumentOperations = ({ helpers }) => {
  const {
    commitCapturedUpdate,
    loadContext,
    now,
    requireCapability,
    requireUpdateLimit,
    store,
  } = helpers;

  return {
    append_update: async ({ actorId, documentId, expectedRoleVersion, update }) => {
      const participant = await requireCapability({
        actorId,
        capability: 'document.edit',
        documentId,
      });
      return store.commitUpdate({
        actorId,
        documentId,
        expectedRoleVersion: expectedRoleVersion ?? participant.roleVersion,
        maxUpdateBytes: requireUpdateLimit(),
        now: now(),
        operationKind: 'document_edit',
        source: 'document_editor',
        update: Buffer.from(requireText(update), 'base64'),
      });
    },

    // Yjs bytes cross the API as base64 in both directions. Returning raw
    // Uint8Arrays serializes them as numeric-key JSON objects, which inflated a
    // twelve-character document to a 10,051-byte response in a real local run.
    hydrate_document: async ({ actorId, documentId }) => {
      await requireCapability({ actorId, capability: 'document.read', documentId });
      const { state } = await loadContext(documentId);
      return {
        headSequence: state.headSequence,
        snapshot: encodeBase64(state.snapshot),
        snapshotSequence: state.snapshotSequence,
        updates: state.updates.map(({ sequence, update }) => ({
          sequence,
          update: encodeBase64(update),
        })),
      };
    },

    resolve_proposal: async ({ actorId, documentId, proposalId, resolution }) => {
      const owner = await requireCapability({
        actorId,
        capability: 'conflict.resolve',
        documentId,
      });
      requireUpdateLimit();
      const { context } = await loadContext(documentId);
      const update = captureGroundUpdate(context, (mutable) => resolveProposal(mutable, {
        actor: actorFrom(owner),
        proposalId: requireText(proposalId),
        resolution: requireText(resolution),
      }));
      return commitCapturedUpdate({
        documentId,
        operationKind: 'proposal_resolve',
        participant: owner,
        source: 'owner_decision',
        update,
      });
    },

    webmcp_apply: async ({ actorId, documentId, expectedText, replacementText }) => {
      const participant = await requireCapability({
        actorId,
        capability: 'document.edit',
        documentId,
      });
      requireUpdateLimit();
      const { context } = await loadContext(documentId);
      const update = captureGroundUpdate(context, (mutable) => {
        replaceUniqueText({ context: mutable, expectedText, replacementText });
        appendActivity(mutable.activity, {
          action: 'document_edit',
          actor: actorFrom(participant),
          outcome: 'applied',
          source: 'webmcp_apply',
          target: 'document',
        });
      });
      return commitCapturedUpdate({
        documentId,
        operationKind: 'document_edit',
        participant,
        source: 'webmcp_apply',
        update,
      });
    },

    webmcp_propose: async ({ actorId, documentId, expectedText, replacementText }) => {
      const participant = await requireCapability({
        actorId,
        capability: 'document.suggest',
        documentId,
      });
      requireUpdateLimit();
      const { context, state } = await loadContext(documentId);
      const from = context.ytext.toString().indexOf(requireText(expectedText));
      if (from < 0) {
        throw groundError('GROUND_STALE_STATE');
      }
      const update = captureGroundUpdate(context, (mutable) => {
        createProposal(mutable, {
          actor: actorFrom(participant),
          anchor: anchorFor(mutable.ytext, from, from + expectedText.length),
          baseRevision: String(state.headSequence),
          expectedText,
          replacementText: replacementText ?? '',
          source: 'webmcp_proposal',
        });
      });
      return commitCapturedUpdate({
        documentId,
        operationKind: 'proposal_create',
        participant,
        source: 'webmcp_proposal',
        update,
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
