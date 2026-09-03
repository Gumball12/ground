import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as Y from 'yjs';
import { serializeCommentThreads } from '../../src/domain/comment-threads.js';
import { appendActivity } from '../../src/domain/governance-activity.js';
import { createProposal, groupReviewItems, resolveProposal } from '../../src/domain/governance-proposals.js';
import {
  captureGroundUpdate,
  createGroundYDoc,
  createInitialGroundSnapshot,
  encodeGroundSnapshot,
  hydrateGroundYDoc,
} from '../../src/server/application/ground-yjs-state.js';

const ownerActor = Object.freeze({
  displayName: 'Owner',
  participantSessionId: 'owner-session',
  roleId: 'owner',
});
const editorActor = Object.freeze({
  displayName: 'Writer Agent',
  participantSessionId: 'editor-session',
  roleId: 'editor',
});
const reviewerActor = Object.freeze({
  displayName: 'Reviewer Agent',
  participantSessionId: 'reviewer-session',
  roleId: 'reviewer',
});

const readLaunchPlan = () => readFile('docs/demo/launch-plan.md', 'utf8');

const anchorFor = (ytext, from, to) => ({
  anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, to)),
  anchorEndLine: 1,
  anchorKind: 'text',
  anchorQuote: ytext.toString().slice(from, to),
  anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, from)),
  anchorStartLine: 1,
});

const statusesOf = (context) => serializeCommentThreads(context.comments)
  .map(({ id, status }) => `${id}:${status}`)
  .sort();

test('hydrates snapshot plus ordered updates into identical Markdown and governance state', () => {
  const original = createGroundYDoc('# Launch Plan\n');
  const snapshot = Y.encodeStateAsUpdate(original.ydoc);
  const vector = Y.encodeStateVector(original.ydoc);
  original.ytext.insert(original.ytext.length, '\nBudget: $100K.');
  const update = Y.encodeStateAsUpdate(original.ydoc, vector);

  const restored = hydrateGroundYDoc({ snapshot, updates: [{ sequence: 1, update }] });

  assert.equal(restored.ytext.toString(), original.ytext.toString());
  assert.deepEqual(restored.activity.toJSON(), original.activity.toJSON());
});

test('applies persisted updates in sequence order regardless of input order', () => {
  const original = createGroundYDoc('');
  const snapshot = encodeGroundSnapshot(original);
  const updates = ['A', 'B', 'C'].map((value, index) => {
    const vector = Y.encodeStateVector(original.ydoc);
    original.ytext.insert(original.ytext.length, value);
    return { sequence: index + 1, update: Y.encodeStateAsUpdate(original.ydoc, vector) };
  });

  const restored = hydrateGroundYDoc({ snapshot, updates: [updates[2], updates[0], updates[1]] });

  assert.equal(restored.ytext.toString(), 'ABC');
});

test('initial snapshot text equals the launch plan and holds one Owner join Activity', async () => {
  const launchPlan = await readLaunchPlan();

  const snapshot = createInitialGroundSnapshot({ actor: ownerActor, text: launchPlan });
  const restored = hydrateGroundYDoc({ snapshot });

  assert.equal(restored.ytext.toString(), launchPlan);
  const activity = restored.activity.toJSON();
  assert.equal(activity.length, 1);
  assert.equal(activity[0].action, 'participant_joined');
  assert.equal(activity[0].source, 'access_management');
  assert.equal(activity[0].outcome, 'active');
  assert.deepEqual(activity[0].actor, ownerActor);
  assert.deepEqual(serializeCommentThreads(restored.comments), []);
});

test('a captured WebMCP edit carries the new text and its matching Activity in one update', async () => {
  const launchPlan = await readLaunchPlan();
  const snapshot = createInitialGroundSnapshot({ actor: ownerActor, text: launchPlan });
  const context = hydrateGroundYDoc({ snapshot });
  const from = context.ytext.toString().indexOf('$100K');

  const update = captureGroundUpdate(context, ({ activity, ytext }) => {
    ytext.delete(from, '$100K'.length);
    ytext.insert(from, '$110K');
    appendActivity(activity, {
      action: 'document_edit',
      actor: editorActor,
      outcome: 'applied',
      source: 'webmcp_apply',
      target: 'document',
    });
  });

  const restored = hydrateGroundYDoc({ snapshot, updates: [{ sequence: 1, update }] });
  assert.equal(restored.ytext.toString().includes('$110K'), true);
  assert.equal(restored.ytext.toString().includes('$100K'), false);
  const activity = restored.activity.toJSON();
  assert.equal(activity.length, 2);
  assert.equal(activity[1].source, 'webmcp_apply');
  assert.deepEqual(activity[1].actor, editorActor);
});

test('two proposals on the same budget group as one Conflict and resolve in one captured update', async () => {
  const launchPlan = await readLaunchPlan();
  const snapshot = createInitialGroundSnapshot({ actor: ownerActor, text: launchPlan });
  const context = hydrateGroundYDoc({ snapshot });
  const from = context.ytext.toString().indexOf('$100K');
  const proposalInput = (id, replacementText) => ({
    actor: reviewerActor,
    anchor: anchorFor(context.ytext, from, from + '$100K'.length),
    baseRevision: 'base',
    expectedText: '$100K',
    id,
    replacementText,
    source: 'webmcp_proposal',
  });

  const created = [
    captureGroundUpdate(context, (mutable) => createProposal(mutable, proposalInput('proposal-a', '$110K'))),
    captureGroundUpdate(context, (mutable) => createProposal(mutable, proposalInput('proposal-b', '$120K'))),
  ];
  assert.equal(groupReviewItems(context).length, 1);

  const resolveUpdate = captureGroundUpdate(context, (mutable) => resolveProposal(mutable, {
    actor: ownerActor,
    proposalId: 'proposal-a',
    resolution: 'apply_proposed',
  }));

  assert.equal(resolveUpdate instanceof Uint8Array, true);
  assert.deepEqual(statusesOf(context), ['proposal-a:accepted', 'proposal-b:conflict']);
  const restored = hydrateGroundYDoc({
    snapshot,
    updates: [
      { sequence: 1, update: created[0] },
      { sequence: 2, update: created[1] },
      { sequence: 3, update: resolveUpdate },
    ],
  });
  assert.equal(restored.ytext.toString().includes('$110K'), true);
  assert.deepEqual(statusesOf(restored), statusesOf(context));
});
