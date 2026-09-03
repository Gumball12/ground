import { createGroundDocumentId, normalizeGroundDisplayName } from '../../domain/ground-hosted-contract.js';
import {
  actorFrom,
  createRecoveryToken,
  groundError,
  hashToken,
  requireText,
} from './ground-service-support.js';
import { createInitialGroundSnapshot } from './ground-yjs-state.js';

const CREATE_ATTEMPTS = 3;

export const createGroundAccessOperations = ({
  createDocumentId = createGroundDocumentId,
  helpers,
  initialText = '',
}) => {
  const {
    captureAccessActivity,
    manifest,
    now,
    requireCapability,
    requireParticipant,
    sessionFor,
    store,
  } = helpers;

  const transition = async ({
    action, apply, actorId, documentId, expectedOwnerVersion, outcome, targetUserId,
  }) => {
    const owner = await requireCapability({ actorId, capability: 'grant.manage', documentId });
    const target = await requireParticipant({ actorId: targetUserId, documentId });
    const activityUpdate = await captureAccessActivity({
      action,
      actor: actorFrom(owner),
      documentId,
      outcome,
      target: targetUserId,
    });
    const result = await apply({
      activityUpdate,
      expectedOwnerVersion: expectedOwnerVersion ?? owner.roleVersion,
    });
    return {
      sequence: result.sequence,
      session: sessionFor({ ...target, ...result.participant, userId: targetUserId }, documentId),
    };
  };

  return {
    assign_role: ({ actorId, documentId, expectedOwnerVersion, roleId, targetUserId }) => {
      if (!manifest.roles[requireText(roleId)] || roleId === 'owner') {
        throw groundError('GROUND_INVALID_REQUEST');
      }
      return transition({
        action: 'role_assigned',
        actorId,
        apply: ({ activityUpdate, expectedOwnerVersion: expected }) => store.assignRole({
          activityUpdate,
          documentId,
          expectedOwnerVersion: expected,
          now: now(),
          ownerId: actorId,
          roleId,
          targetUserId,
        }),
        documentId,
        expectedOwnerVersion,
        outcome: 'active',
        targetUserId,
      });
    },

    create_document: async ({ actorId, displayName }) => {
      const ownerName = normalizeGroundDisplayName(displayName);
      const recoveryToken = createRecoveryToken();
      const snapshot = createInitialGroundSnapshot({
        actor: { displayName: ownerName, participantSessionId: actorId, roleId: 'owner' },
        text: initialText,
      });

      for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
        const documentId = createDocumentId();
        try {
          const participant = await store.create({
            displayName: ownerName,
            documentId,
            now: now(),
            ownerId: actorId,
            recoveryTokenHash: hashToken(recoveryToken),
            snapshot,
          });
          return {
            documentId,
            recoveryToken,
            session: sessionFor(
              { ...participant, displayName: ownerName, userId: actorId },
              documentId,
            ),
          };
        } catch (error) {
          if (error?.code !== 'GROUND_DOCUMENT_ID_TAKEN') {
            throw error;
          }
        }
      }

      throw groundError('GROUND_TEMPORARILY_UNAVAILABLE');
    },

    get_session: async ({ actorId, documentId }) => ({
      session: sessionFor(await requireParticipant({ actorId, documentId }), documentId),
    }),

    join_document: async ({ actorId, displayName, documentId }) => {
      const visitorName = normalizeGroundDisplayName(displayName);
      const activityUpdate = await captureAccessActivity({
        action: 'participant_joined',
        actor: { displayName: visitorName, participantSessionId: actorId, roleId: 'pending' },
        documentId,
        outcome: 'pending',
        target: actorId,
      });
      const participant = await store.join({
        activityUpdate,
        displayName: visitorName,
        documentId,
        now: now(),
        userId: actorId,
      });
      return { session: sessionFor({ ...participant, userId: actorId }, documentId) };
    },

    list_participants: async ({ actorId, documentId }) => {
      await requireCapability({ actorId, capability: 'grant.manage', documentId });
      return {
        participants: (await store.listParticipants({ documentId })).map((participant) => ({
          displayName: participant.displayName,
          participantSessionId: participant.userId,
          roleId: participant.roleId,
          state: participant.accessState,
          version: participant.roleVersion,
        })),
      };
    },

    list_roles: async () => ({
      roles: Object.keys(manifest.roles).toSorted().map((roleId) => ({
        capabilities: manifest.roles[roleId],
        roleId,
      })),
    }),

    recover_owner: async ({ actorId, displayName, documentId, recoveryToken }) => {
      const ownerName = normalizeGroundDisplayName(displayName);
      const nextToken = createRecoveryToken();
      const activityUpdate = await captureAccessActivity({
        action: 'owner_recovered',
        actor: { displayName: ownerName, participantSessionId: actorId, roleId: 'owner' },
        documentId,
        outcome: 'active',
        target: actorId,
      });
      const result = await store.recover({
        activityUpdate,
        actorId,
        displayName: ownerName,
        documentId,
        nextTokenHash: hashToken(nextToken),
        now: now(),
        tokenHash: hashToken(requireText(recoveryToken)),
      });
      return { recoveryToken: nextToken, sequence: result.sequence };
    },

    revoke_participant: ({ actorId, documentId, expectedOwnerVersion, targetUserId }) => transition({
      action: 'access_revoked',
      actorId,
      apply: ({ activityUpdate, expectedOwnerVersion: expected }) => store.revoke({
        activityUpdate,
        documentId,
        expectedOwnerVersion: expected,
        now: now(),
        ownerId: actorId,
        targetUserId,
      }),
      documentId,
      expectedOwnerVersion,
      outcome: 'revoked',
      targetUserId,
    }),
  };
};
