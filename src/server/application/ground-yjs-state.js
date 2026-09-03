import * as Y from 'yjs';
import { appendActivity } from '../../domain/governance-activity.js';

const GROUND_TEXT_KEY = 'codemirror';
const GROUND_ACTIVITY_KEY = 'governanceActivity';
const GROUND_COMMENTS_KEY = 'comments';

const contextFor = (ydoc) => ({
  activity: ydoc.getArray(GROUND_ACTIVITY_KEY),
  comments: ydoc.getArray(GROUND_COMMENTS_KEY),
  ydoc,
  ytext: ydoc.getText(GROUND_TEXT_KEY),
});

export const createGroundYDoc = (text = '') => {
  const context = contextFor(new Y.Doc());
  if (text) {
    context.ytext.insert(0, text);
  }
  return context;
};

export const hydrateGroundYDoc = ({ snapshot, updates = [] }) => {
  const ydoc = new Y.Doc();
  if (snapshot) {
    Y.applyUpdate(ydoc, snapshot);
  }
  updates
    .toSorted((first, second) => first.sequence - second.sequence)
    .forEach(({ update }) => Y.applyUpdate(ydoc, update));
  return contextFor(ydoc);
};

export const encodeGroundSnapshot = (context) => Y.encodeStateAsUpdate(context.ydoc);

export const captureGroundUpdate = (context, mutate) => {
  const before = Y.encodeStateVector(context.ydoc);
  mutate(context);
  return Y.encodeStateAsUpdate(context.ydoc, before);
};

export const createInitialGroundSnapshot = ({ actor, createdAt, text }) => {
  const context = createGroundYDoc(text);
  appendActivity(context.activity, {
    action: 'participant_joined',
    actor,
    ...(Number.isFinite(createdAt) ? { createdAt } : {}),
    outcome: 'active',
    source: 'access_management',
    target: actor.participantSessionId,
  });
  return encodeGroundSnapshot(context);
};
