import { createHash, createHmac, randomBytes } from 'node:crypto';
import * as Y from 'yjs';
import { appendActivity } from '../../domain/governance-activity.js';
import { hasCapability } from '../../domain/governance-contract.js';
import { captureGroundUpdate, hydrateGroundYDoc } from './ground-yjs-state.js';

const RECOVERY_TOKEN_BYTES = 32;

export const groundError = (code) => Object.assign(new Error(code), { code });

export const requireText = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw groundError('GROUND_INVALID_REQUEST');
  }
  return value;
};

export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest();

export const createRecoveryToken = () => randomBytes(RECOVERY_TOKEN_BYTES).toString('base64url');

export const actorFrom = (participant) => ({
  displayName: participant.displayName,
  participantSessionId: participant.userId,
  roleId: participant.roleId,
});

const relativeAnchor = (ytext, index) => Y.relativePositionToJSON(
  Y.createRelativePositionFromTypeIndex(ytext, index),
);

export const anchorFor = (ytext, from, to) => ({
  anchorEnd: relativeAnchor(ytext, to),
  anchorEndLine: 1,
  anchorKind: 'text',
  anchorQuote: ytext.toString().slice(from, to),
  anchorStart: relativeAnchor(ytext, from),
  anchorStartLine: 1,
});

export const createServiceHelpers = ({
  clock,
  limits,
  manifest,
  rateLimitHmacKey,
  rateLimits,
  store,
}) => {
  const now = () => clock();

  // Only the server holds the HMAC input, so a stored window row never reveals
  // the anonymous user id or the raw network address it counts.
  const rateKeyHash = (kind, value) => createHmac('sha256', rateLimitHmacKey)
    .update(`${kind}:${value}`, 'utf8')
    .digest();

  // Creation counts the actor and the request network independently, so
  // repeatedly creating fresh anonymous users cannot walk past the boundary.
  const enforceRateLimit = async ({ networkId, scope, userId }) => {
    const window = rateLimits?.[scope];
    if (!rateLimitHmacKey || !window) {
      throw groundError('GROUND_TEMPORARILY_UNAVAILABLE');
    }
    const keyed = scope === 'create'
      ? [['user', userId], ['network', networkId]]
      : [['user', userId]];

    for (const [kind, value] of keyed) {
      const allowed = await store.takeRateLimit({
        keyHash: rateKeyHash(kind, value),
        limit: window.limit,
        now: now(),
        scope,
        windowSeconds: window.windowSeconds,
      });
      if (!allowed) {
        throw groundError('GROUND_RATE_LIMITED');
      }
    }
  };

  const requireUpdateLimit = () => {
    const { maxUpdateBytes } = limits;
    if (!Number.isInteger(maxUpdateBytes) || maxUpdateBytes <= 0) {
      throw groundError('GROUND_TEMPORARILY_UNAVAILABLE');
    }
    return maxUpdateBytes;
  };

  const sessionFor = (participant, documentId) => {
    const base = {
      displayName: participant.displayName,
      documentPath: documentId,
      participantSessionId: participant.userId,
      roleId: participant.roleId,
      state: participant.accessState,
      version: participant.roleVersion,
    };
    return participant.accessState === 'active'
      ? { ...base, capabilities: manifest.roles[participant.roleId] ?? [] }
      : base;
  };

  const requireParticipant = async ({ actorId, documentId }) => {
    const participant = await store.getSession({ documentId, userId: actorId });
    if (!participant) {
      throw groundError('GROUND_UNAVAILABLE');
    }
    return { ...participant, userId: participant.userId ?? actorId };
  };

  const requireCapability = async ({ actorId, capability, documentId }) => {
    const participant = await requireParticipant({ actorId, documentId });
    if (participant.accessState !== 'active'
      || !hasCapability(manifest, participant.roleId, capability)) {
      throw groundError('GROUND_FORBIDDEN');
    }
    return participant;
  };

  const loadContext = async (documentId) => {
    const state = await store.loadState({ documentId });
    return {
      context: hydrateGroundYDoc({ snapshot: state.snapshot, updates: state.updates }),
      state,
    };
  };

  const commitCapturedUpdate = ({
    documentId, operationKind, participant, source, update,
  }) => store.commitUpdate({
    actorId: participant.userId,
    documentId,
    expectedRoleVersion: participant.roleVersion,
    maxUpdateBytes: requireUpdateLimit(),
    now: now(),
    operationKind,
    source,
    update,
  });

  const captureAccessActivity = async ({ action, actor, documentId, outcome, target }) => {
    const { context } = await loadContext(documentId);
    return captureGroundUpdate(context, ({ activity }) => {
      appendActivity(activity, {
        action,
        actor,
        outcome,
        source: 'access_management',
        target,
      });
    });
  };

  return {
    captureAccessActivity,
    commitCapturedUpdate,
    enforceRateLimit,
    loadContext,
    manifest,
    now,
    requireCapability,
    requireParticipant,
    requireUpdateLimit,
    sessionFor,
    store,
  };
};
