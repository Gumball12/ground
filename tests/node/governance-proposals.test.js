import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import {
  createProposal,
  groupReviewItems,
  resolveProposal,
  revalidateOpenProposals,
} from '../../src/domain/governance-proposals.js';
import { serializeCommentThreads } from '../../src/domain/comment-threads.js';

const ownerActor = Object.freeze({
  displayName: 'Mina',
  kind: 'human',
  participantSessionId: 'owner-session',
  roleId: 'owner',
});
const editorActor = Object.freeze({
  displayName: 'Writer',
  kind: 'ai',
  participantSessionId: 'editor-session',
  roleId: 'editor',
});
const reviewerActor = Object.freeze({
  displayName: 'Reviewer',
  kind: 'ai',
  participantSessionId: 'reviewer-session',
  roleId: 'reviewer',
});

const createGovernanceDoc = (text) => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  ytext.insert(0, text);
  return {
    activity: ydoc.getArray('governanceActivity'),
    comments: ydoc.getArray('comments'),
    ydoc,
    ytext,
  };
};

const createTextAnchor = (ytext, from, to) => ({
  anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to)),
  anchorEndLine: 1,
  anchorKind: 'text',
  anchorQuote: ytext.toString().slice(from, to),
  anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from)),
  anchorStartLine: 1,
});

const readProposal = (comments, proposalId) => (
  serializeCommentThreads(comments).find((proposal) => proposal.id === proposalId)
);

const proposalInput = (context, from, to, overrides = {}) => ({
  actor: reviewerActor,
  anchor: createTextAnchor(context.ytext, from, to),
  baseRevision: 'base',
  expectedText: context.ytext.toString().slice(from, to),
  replacementText: 'replacement',
  source: 'webmcp_proposal',
  ...overrides,
});

test('createProposal stores the Proposal and creation Activity in one Yjs update', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));

  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    createdAt: 100,
    id: 'proposal-1',
    replacementText: '$120K',
  }));

  assert.deepEqual(proposal, {
    ...createTextAnchor(context.ytext, 10, 15),
    baseRevision: 'base',
    createdAt: 100,
    createdByDisplayName: 'Reviewer',
    createdByKind: 'ai',
    createdByParticipantSessionId: 'reviewer-session',
    createdByRole: 'reviewer',
    expectedText: '$100K',
    id: 'proposal-1',
    kind: 'proposal',
    replacementText: '$120K',
    status: 'open',
  });
  assert.equal(context.ytext.toString(), 'Budget is $100K.');
  assert.deepEqual(context.activity.get(0), {
    action: 'proposal_created',
    actor: reviewerActor,
    createdAt: 100,
    id: context.activity.get(0).id,
    outcome: 'open',
    source: 'webmcp_proposal',
    target: 'proposal-1',
  });
  assert.equal(context.activity.get(0).source, 'webmcp_proposal');
  assert.equal(updates.length, 1);
});

test('governance resolution updates text, Proposal, overlaps, and Activity in one Yjs update', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    id: 'proposal-1',
    replacementText: '$120K',
  }));
  createProposal(context, proposalInput(context, 10, 15, {
    createdAt: proposal.createdAt + 1,
    id: 'proposal-2',
    replacementText: '$90K',
  }));
  createProposal(context, proposalInput(context, 10, 15, {
    createdAt: proposal.createdAt + 2,
    id: 'proposal-unchanged-conflict',
    replacementText: '$80K',
  }));
  context.comments.toArray()
    .find((thread) => thread.get('id') === 'proposal-unchanged-conflict')
    .set('status', 'conflict');
  const activityCountBeforeResolution = context.activity.length;
  const undoManager = new Y.UndoManager(context.ytext);
  const updates = [];
  context.ydoc.on('update', (update, origin) => updates.push({ origin, update }));

  const resolved = resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'apply_proposed',
  });

  assert.equal(context.ytext.toString(), 'Budget is $120K.');
  assert.equal(resolved.status, 'accepted');
  assert.equal(readProposal(context.comments, 'proposal-2').status, 'conflict');
  assert.equal(readProposal(context.comments, 'proposal-unchanged-conflict').status, 'conflict');
  assert.equal(context.activity.toArray().at(-1).source, 'owner_decision');
  assert.deepEqual(context.activity.toArray().slice(activityCountBeforeResolution).map((record) => ({
    action: record.action,
    actor: record.actor,
    outcome: record.outcome,
    source: record.source,
    target: record.target,
  })), [
    {
      action: 'proposal_status_changed',
      actor: ownerActor,
      outcome: 'conflict',
      source: 'owner_decision',
      target: 'proposal-2',
    },
    {
      action: 'proposal_accepted',
      actor: ownerActor,
      outcome: 'accepted',
      source: 'owner_decision',
      target: 'proposal-1',
    },
  ]);
  assert.equal(updates.length, 1);
  undoManager.undo();
  assert.equal(context.ytext.toString(), 'Budget is $120K.');
});

test('Keep current rejects once and records changed overlapping Proposal status atomically', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const selected = createProposal(context, proposalInput(context, 10, 15, { id: 'proposal-selected' }));
  createProposal(context, proposalInput(context, 10, 15, { id: 'proposal-overlap' }));
  context.ydoc.transact(() => {
    context.ytext.delete(10, 5);
    context.ytext.insert(10, '$110K');
  }, 'direct-edit');
  const activityCountBeforeResolution = context.activity.length;
  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));

  resolveProposal(context, {
    actor: ownerActor,
    proposalId: selected.id,
    resolution: 'keep_current',
  });

  assert.equal(readProposal(context.comments, selected.id).status, 'rejected');
  assert.equal(readProposal(context.comments, 'proposal-overlap').status, 'conflict');
  assert.deepEqual(context.activity.toArray().slice(activityCountBeforeResolution).map((record) => ({
    action: record.action,
    outcome: record.outcome,
    target: record.target,
  })), [
    {
      action: 'proposal_status_changed',
      outcome: 'conflict',
      target: 'proposal-overlap',
    },
    {
      action: 'proposal_rejected',
      outcome: 'rejected',
      target: selected.id,
    },
  ]);
  assert.equal(updates.length, 1);
});

test('Apply accepts a stale open Proposal when its relative anchor still resolves', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    id: 'proposal-stale',
    replacementText: '$120K',
  }));
  context.ydoc.transact(() => {
    context.ytext.delete(10, 5);
    context.ytext.insert(10, '$110K');
  }, 'direct-edit');
  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));

  const resolved = resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'apply_proposed',
  });

  assert.equal(context.ytext.toString(), 'Budget is $120K.');
  assert.equal(resolved.status, 'accepted');
  assert.equal(resolved.resolution, 'apply_proposed');
  assert.equal(resolved.resolvedByParticipantSessionId, 'owner-session');
  assert.equal(Number.isFinite(resolved.resolvedAt), true);
  assert.deepEqual(
    context.activity.toArray().map((record) => record.action),
    ['proposal_created', 'proposal_accepted'],
  );
  assert.equal(updates.length, 1);
});

test('terminal Proposals deny a second resolution without text, Proposal, or Activity changes', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    id: 'proposal-1',
    replacementText: '$120K',
  }));
  resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'apply_proposed',
  });
  const before = {
    activity: context.activity.toJSON(),
    proposal: readProposal(context.comments, proposal.id),
    text: context.ytext.toString(),
  };
  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));

  assert.throws(() => resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'keep_current',
  }), /terminal/u);
  assert.equal(context.ytext.toString(), before.text);
  assert.deepEqual(readProposal(context.comments, proposal.id), before.proposal);
  assert.deepEqual(context.activity.toJSON(), before.activity);
  assert.equal(updates.length, 0);
});

test('createProposal persists a missing relative anchor as an Unlocated Conflict', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    anchor: {
      anchorEnd: { assoc: 0, tname: 'missing' },
      anchorEndLine: 1,
      anchorKind: 'text',
      anchorQuote: '$100K',
      anchorStart: { assoc: 0, tname: 'missing' },
      anchorStartLine: 1,
    },
    id: 'proposal-unlocated',
    replacementText: '$120K',
  }));

  assert.equal(proposal.status, 'conflict');
  assert.equal(readProposal(context.comments, proposal.id).status, 'conflict');
  assert.equal(groupReviewItems(context).at(-1).unlocated, true);
  assert.deepEqual(context.activity.toArray().map((record) => ({
    action: record.action,
    outcome: record.outcome,
    target: record.target,
  })), [{
    action: 'proposal_created',
    outcome: 'conflict',
    target: 'proposal-unlocated',
  }]);

  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));
  assert.throws(() => resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'apply_proposed',
  }), /Unlocated/u);
  assert.equal(updates.length, 0);

  const rejected = resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'keep_current',
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.resolution, 'keep_current');
});

test('createProposal records an initially stale target as one Conflict creation event', () => {
  const context = createGovernanceDoc('Budget is $100K.');

  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    expectedText: '$090K',
    id: 'proposal-stale-at-creation',
  }));

  assert.equal(proposal.status, 'conflict');
  assert.deepEqual(context.activity.toArray().map((record) => ({
    action: record.action,
    outcome: record.outcome,
    target: record.target,
  })), [{
    action: 'proposal_created',
    outcome: 'conflict',
    target: proposal.id,
  }]);
});

test('terminal Proposals never reopen after later edits', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    id: 'proposal-1',
    replacementText: '$120K',
  }));
  resolveProposal(context, {
    actor: ownerActor,
    proposalId: proposal.id,
    resolution: 'apply_proposed',
  });

  context.ytext.insert(0, 'Updated: ');
  revalidateOpenProposals(context, {
    actor: editorActor,
    origin: 'direct-edit',
    source: 'document_editor',
  });

  assert.equal(readProposal(context.comments, proposal.id).status, 'accepted');
});

test('revalidation appends one actor-snapshotted Activity per changed non-terminal Proposal', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const first = createProposal(context, proposalInput(context, 10, 15, { id: 'proposal-1' }));
  const second = createProposal(context, proposalInput(context, 10, 15, { id: 'proposal-2' }));
  const terminal = createProposal(context, proposalInput(context, 10, 15, { id: 'proposal-terminal' }));
  resolveProposal(context, {
    actor: ownerActor,
    proposalId: terminal.id,
    resolution: 'keep_current',
  });
  context.ydoc.transact(() => {
    context.ytext.delete(10, 5);
    context.ytext.insert(10, '$110K');
  }, 'direct-edit');

  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(context.ydoc));
  const activityCountBefore = context.activity.length;
  const updates = [];
  context.ydoc.on('update', (update, origin) => {
    if (origin === 'direct-edit') {
      updates.push(update);
    }
  });

  const changed = revalidateOpenProposals(context, {
    actor: editorActor,
    origin: 'direct-edit',
    source: 'document_editor',
  });

  assert.deepEqual(changed.changed.map((proposal) => proposal.id), [first.id, second.id]);
  assert.deepEqual(context.activity.toArray().slice(activityCountBefore).map((record) => ({
    action: record.action,
    actor: record.actor,
    outcome: record.outcome,
    source: record.source,
    target: record.target,
  })), [first.id, second.id].map((target) => ({
    action: 'proposal_status_changed',
    actor: editorActor,
    outcome: 'conflict',
    source: 'document_editor',
    target,
  })));
  assert.equal(readProposal(context.comments, terminal.id).status, 'rejected');
  assert.equal(updates.length, 1);

  const activityCountAfterChange = context.activity.length;
  assert.equal(revalidateOpenProposals(context, {
    actor: editorActor,
    origin: 'direct-edit',
    source: 'document_editor',
  }).changedCount, 0);
  assert.equal(context.activity.length, activityCountAfterChange);
  assert.equal(updates.length, 1);

  Y.applyUpdate(remote, updates[0]);
  const remoteActivity = remote.getArray('governanceActivity');
  assert.equal(remoteActivity.length, context.activity.length);
  Y.applyUpdate(remote, updates[0]);
  assert.equal(remoteActivity.length, context.activity.length);

  context.ydoc.transact(() => {
    context.ytext.delete(10, 5);
    context.ytext.insert(10, '$100K');
  }, 'direct-edit');
  const reopened = revalidateOpenProposals(context, {
    actor: editorActor,
    origin: 'direct-edit',
    source: 'document_editor',
  });
  assert.deepEqual(reopened.changed.map((proposal) => proposal.status), ['open', 'open']);
  assert.deepEqual(context.activity.toArray().slice(-2).map((record) => record.outcome), ['open', 'open']);
});

test('revalidation requires an actor before starting a transaction', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const updates = [];
  context.ydoc.on('update', (update) => updates.push(update));

  assert.throws(() => revalidateOpenProposals(context), /Actor/u);
  assert.equal(updates.length, 0);
});

test('Proposal and revalidation require a source before starting a transaction', () => {
  const context = createGovernanceDoc('Budget is $100K.');

  assert.throws(() => createProposal(context, {
    ...proposalInput(context, 10, 15),
    source: undefined,
  }), /Proposal source/u);
  assert.throws(() => revalidateOpenProposals(context, { actor: editorActor }), /Activity source/u);
  assert.throws(() => createProposal(context, {
    ...proposalInput(context, 10, 15),
    source: 'unknown_channel',
  }), /Unknown Activity source/u);
  assert.equal(context.comments.length, 0);
  assert.equal(context.activity.length, 0);
});

test('groupReviewItems groups located items by position and sorts Unlocated last', () => {
  const context = createGovernanceDoc('alpha beta gamma');
  createProposal(context, proposalInput(context, 6, 10, {
    createdAt: 30,
    id: 'beta-late',
    replacementText: 'BETA',
  }));
  createProposal(context, proposalInput(context, 0, 5, {
    createdAt: 20,
    id: 'alpha',
    replacementText: 'ALPHA',
  }));
  createProposal(context, proposalInput(context, 6, 10, {
    createdAt: 10,
    id: 'beta-early',
    replacementText: 'Beta',
  }));
  createProposal(context, proposalInput(context, 0, 5, {
    anchor: {
      anchorEnd: { assoc: 0, tname: 'missing' },
      anchorEndLine: 1,
      anchorKind: 'text',
      anchorQuote: 'alpha',
      anchorStart: { assoc: 0, tname: 'missing' },
      anchorStartLine: 1,
    },
    createdAt: 5,
    id: 'unlocated',
    replacementText: 'ALPHA',
  }));
  context.ydoc.transact(() => {
    context.ytext.delete(6, 4);
    context.ytext.insert(6, 'live');
  }, 'direct-edit');
  revalidateOpenProposals(context, {
    actor: editorActor,
    origin: 'direct-edit',
    source: 'document_editor',
  });

  const groups = groupReviewItems(context);
  assert.deepEqual(groups.map((group) => ({
    from: group.from,
    proposals: group.proposals.map((proposal) => ({
      currentText: proposal.currentText,
      expectedText: proposal.expectedText,
      id: proposal.id,
      replacementText: proposal.replacementText,
      status: proposal.status,
    })),
    unlocated: group.unlocated,
  })), [
    {
      from: 0,
      proposals: [{
        currentText: 'alpha',
        expectedText: 'alpha',
        id: 'alpha',
        replacementText: 'ALPHA',
        status: 'open',
      }],
      unlocated: false,
    },
    {
      from: 6,
      proposals: [
        {
          currentText: 'live',
          expectedText: 'beta',
          id: 'beta-early',
          replacementText: 'Beta',
          status: 'conflict',
        },
        {
          currentText: 'live',
          expectedText: 'beta',
          id: 'beta-late',
          replacementText: 'BETA',
          status: 'conflict',
        },
      ],
      unlocated: false,
    },
    {
      from: null,
      proposals: [{
        currentText: null,
        expectedText: 'alpha',
        id: 'unlocated',
        replacementText: 'ALPHA',
        status: 'conflict',
      }],
      unlocated: true,
    },
  ]);
});

test('createProposal accepts an actor without a kind', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const kindlessActor = {
    displayName: 'Reviewer Agent',
    participantSessionId: 'reviewer-2',
    roleId: 'reviewer',
  };

  const proposal = createProposal(context, proposalInput(context, 10, 15, {
    actor: kindlessActor,
    id: 'proposal-kindless',
    replacementText: '$110K',
  }));

  assert.equal(proposal.createdByDisplayName, 'Reviewer Agent');
  assert.equal(proposal.createdByRole, 'reviewer');
  assert.deepEqual(context.activity.get(0).actor, kindlessActor);
});

test('resolveProposal accepts an Owner actor without a kind', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  createProposal(context, proposalInput(context, 10, 15, {
    id: 'proposal-resolve-kindless',
    replacementText: '$110K',
  }));
  const kindlessOwner = {
    displayName: 'Owner',
    participantSessionId: 'owner-2',
    roleId: 'owner',
  };

  const resolved = resolveProposal(context, {
    actor: kindlessOwner,
    proposalId: 'proposal-resolve-kindless',
    resolution: 'apply_proposed',
  });

  assert.equal(resolved.status, 'accepted');
  assert.equal(context.ytext.toString(), 'Budget is $110K.');
  assert.deepEqual(context.activity.get(context.activity.length - 1).actor, kindlessOwner);
});
