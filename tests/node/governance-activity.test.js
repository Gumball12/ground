import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { appendActivity, GOVERNANCE_ACTIVITY_SOURCES } from '../../src/domain/governance-activity.js';

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
    source: 'document_editor',
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
    source: 'document_editor',
    target: 'proposal-1',
  });
  assert.deepEqual(activity.get(0), record);
});

test('appendActivity requires an allowed source', () => {
  const doc = new Y.Doc();
  const activity = doc.getArray('governanceActivity');
  const actor = {
    displayName: 'Reviewer',
    kind: 'ai',
    participantSessionId: 'reviewer-session',
    roleId: 'reviewer',
  };

  assert.throws(() => appendActivity(activity, {
    action: 'direct_edit_applied',
    actor,
    outcome: 'applied',
    target: 'document',
  }), /Activity source is required/u);
  assert.throws(() => appendActivity(activity, {
    action: 'direct_edit_applied',
    actor,
    outcome: 'applied',
    source: 'unknown_channel',
    target: 'document',
  }), /Unknown Activity source/u);
  assert.deepEqual(GOVERNANCE_ACTIVITY_SOURCES, [
    'document_editor',
    'webmcp_apply',
    'webmcp_proposal',
    'owner_decision',
    'access_management',
    'system_reconciliation',
  ]);
});

test('appendActivity accepts an actor without a kind', () => {
  const doc = new Y.Doc();
  const activity = doc.getArray('governanceActivity');

  const record = appendActivity(activity, {
    action: 'document_edit',
    actor: {
      displayName: 'Writer Agent',
      participantSessionId: 'writer-session',
      roleId: 'editor',
    },
    createdAt: 2_000,
    id: 'activity-2',
    outcome: 'applied',
    source: 'webmcp_apply',
    target: 'document',
  });

  assert.deepEqual(record.actor, {
    displayName: 'Writer Agent',
    participantSessionId: 'writer-session',
    roleId: 'editor',
  });
  assert.deepEqual(activity.get(0), record);
});

test('appendActivity still requires the other actor fields', () => {
  const doc = new Y.Doc();
  const activity = doc.getArray('governanceActivity');
  const base = {
    action: 'document_edit',
    outcome: 'applied',
    source: 'webmcp_apply',
    target: 'document',
  };

  for (const field of ['displayName', 'participantSessionId', 'roleId']) {
    const actor = {
      displayName: 'Writer Agent',
      participantSessionId: 'writer-session',
      roleId: 'editor',
    };
    delete actor[field];
    assert.throws(() => appendActivity(activity, { ...base, actor }), /is required/u);
  }
});
