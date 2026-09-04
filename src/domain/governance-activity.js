import * as Y from 'yjs';

export const GOVERNANCE_ACTIVITY_SOURCES = Object.freeze([
  'document_editor',
  'webmcp_apply',
  'webmcp_proposal',
  'owner_decision',
  'access_management',
  'system_reconciliation',
]);

const requiredString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return value;
};

const createActivityId = () => (
  `activity-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`
);

export const appendActivity = (activityArray, record = {}) => {
  if (!(activityArray instanceof Y.Array)) {
    throw new TypeError('Activity must be a Y.Array.');
  }

  const kind = record.actor?.kind;
  const actor = Object.freeze({
    displayName: requiredString(record.actor?.displayName, 'Actor displayName'),
    ...(typeof kind === 'string' && kind.length > 0 ? { kind } : {}),
    participantSessionId: requiredString(record.actor?.participantSessionId, 'Actor participantSessionId'),
    roleId: requiredString(record.actor?.roleId, 'Actor roleId'),
  });
  const source = requiredString(record.source, 'Activity source');
  if (!GOVERNANCE_ACTIVITY_SOURCES.includes(source)) {
    throw new TypeError(`Unknown Activity source: ${source}.`);
  }
  const activity = Object.freeze({
    action: requiredString(record.action, 'Activity action'),
    actor,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    id: typeof record.id === 'string' && record.id ? record.id : createActivityId(),
    outcome: requiredString(record.outcome, 'Activity outcome'),
    source,
    target: requiredString(record.target, 'Activity target'),
  });

  activityArray.push([activity]);
  return activity;
};
