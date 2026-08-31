import * as Y from 'yjs';

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

  const actor = Object.freeze({
    displayName: requiredString(record.actor?.displayName, 'Actor displayName'),
    kind: requiredString(record.actor?.kind, 'Actor kind'),
    participantSessionId: requiredString(record.actor?.participantSessionId, 'Actor participantSessionId'),
    roleId: requiredString(record.actor?.roleId, 'Actor roleId'),
  });
  const activity = Object.freeze({
    action: requiredString(record.action, 'Activity action'),
    actor,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    id: typeof record.id === 'string' && record.id ? record.id : createActivityId(),
    outcome: requiredString(record.outcome, 'Activity outcome'),
    target: requiredString(record.target, 'Activity target'),
  });

  activityArray.push([activity]);
  return activity;
};
