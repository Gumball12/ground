import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { appendActivity } from '../../src/domain/governance-activity.js';

test('appendActivity stores an action-time actor snapshot', () => {
  const doc = new Y.Doc();
  const activity = doc.getArray('governanceActivity');
  const actor = {
    displayName: 'Reviewer',
    kind: 'ai',
    participantSessionId: 'reviewer-session',
    roleId: 'reviewer',
  };

  const record = appendActivity(activity, {
    action: 'proposal_created',
    actor,
    createdAt: 1_000,
    id: 'activity-1',
    outcome: 'open',
    target: 'proposal-1',
  });
  actor.displayName = 'Changed later';
  actor.roleId = 'editor';

  assert.deepEqual(record, {
    action: 'proposal_created',
    actor: {
      displayName: 'Reviewer',
      kind: 'ai',
      participantSessionId: 'reviewer-session',
      roleId: 'reviewer',
    },
    createdAt: 1_000,
    id: 'activity-1',
    outcome: 'open',
    target: 'proposal-1',
  });
  assert.deepEqual(activity.get(0), record);
});
