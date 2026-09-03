import * as Y from 'yjs';

import {
  createCommentId,
  createCommentThreadSharedType,
  serializeCommentThread,
} from './comment-threads.js';
import { appendActivity, GOVERNANCE_ACTIVITY_SOURCES } from './governance-activity.js';

export const GOVERNANCE_ORIGIN = Object.freeze({ type: 'governance-resolution' });
export const PROPOSAL_STATUSES = Object.freeze(['open', 'accepted', 'rejected', 'conflict']);

const TERMINAL_STATUSES = new Set(['accepted', 'rejected']);
const RESOLUTIONS = new Set(['apply_proposed', 'keep_current']);

const requiredString = (value, label, { allowEmpty = false } = {}) => {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} is required.`);
  }
  return value;
};

const normalizeActor = (actor) => ({
  displayName: requiredString(actor?.displayName, 'Actor displayName'),
  kind: requiredString(actor?.kind, 'Actor kind'),
  participantSessionId: requiredString(actor?.participantSessionId, 'Actor participantSessionId'),
  roleId: requiredString(actor?.roleId, 'Actor roleId'),
});

const normalizeSource = (source, label) => {
  const value = requiredString(source, label);
  if (!GOVERNANCE_ACTIVITY_SOURCES.includes(value)) {
    throw new TypeError(`Unknown Activity source: ${value}.`);
  }
  return value;
};

const assertContext = (context) => {
  if (!(context?.ydoc instanceof Y.Doc)
    || !(context?.ytext instanceof Y.Text)
    || !(context?.comments instanceof Y.Array)
    || !(context?.activity instanceof Y.Array)) {
    throw new TypeError('Governance context requires ydoc, ytext, comments, and activity.');
  }
};

const findProposal = (comments, proposalId) => comments.toArray().find((item) => (
  item instanceof Y.Map && item.get('kind') === 'proposal' && item.get('id') === proposalId
));

const resolvePosition = (ydoc, ytext, value) => {
  try {
    const relative = Y.createRelativePositionFromJSON(value);
    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, ydoc);
    return absolute?.type === ytext ? absolute.index : null;
  } catch {
    return null;
  }
};

const resolveAnchor = (context, proposal) => {
  const from = resolvePosition(context.ydoc, context.ytext, proposal.anchorStart);
  const to = resolvePosition(context.ydoc, context.ytext, proposal.anchorEnd);
  return from === null || to === null || to < from ? null : { from, to };
};

const readProposal = (thread) => {
  const proposal = serializeCommentThread(thread);
  if (proposal?.kind !== 'proposal') {
    throw new TypeError('Proposal record is malformed.');
  }
  return proposal;
};

const setStatus = (thread, status) => {
  thread.set('status', status);
};

const revalidate = (context, actor, source) => {
  const changed = [];
  // ponytail: O(n) is enough for one document; add an index only after profiling proves otherwise.
  for (const thread of context.comments.toArray()) {
    if (!(thread instanceof Y.Map) || thread.get('kind') !== 'proposal') {
      continue;
    }
    const proposal = serializeCommentThread(thread);
    if (!proposal) {
      continue;
    }
    if (TERMINAL_STATUSES.has(proposal.status)) {
      continue;
    }

    const anchor = resolveAnchor(context, proposal);
    const nextStatus = anchor
      && context.ytext.toString().slice(anchor.from, anchor.to) === proposal.expectedText
      ? 'open'
      : 'conflict';
    if (proposal.status !== nextStatus) {
      setStatus(thread, nextStatus);
      const changedProposal = { ...proposal, status: nextStatus };
      changed.push(changedProposal);
      appendActivity(context.activity, {
        action: 'proposal_status_changed',
        actor,
        outcome: nextStatus,
        source,
        target: proposal.id,
      });
    }
  }
  return changed;
};

export const createProposal = (context, input = {}) => {
  assertContext(context);
  const actor = normalizeActor(input.actor);
  const source = normalizeSource(input.source, 'Proposal source');
  const record = {
    ...input.anchor,
    baseRevision: requiredString(input.baseRevision, 'Proposal baseRevision'),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    createdByDisplayName: actor.displayName,
    createdByKind: actor.kind,
    createdByParticipantSessionId: actor.participantSessionId,
    createdByRole: actor.roleId,
    expectedText: requiredString(input.expectedText, 'Proposal expectedText', { allowEmpty: true }),
    id: typeof input.id === 'string' && input.id ? input.id : createCommentId('proposal'),
    kind: 'proposal',
    replacementText: requiredString(input.replacementText, 'Proposal replacementText', { allowEmpty: true }),
    status: 'open',
  };
  const anchor = resolveAnchor(context, record);
  record.status = anchor
    && context.ytext.toString().slice(anchor.from, anchor.to) === record.expectedText
    ? 'open'
    : 'conflict';
  const thread = createCommentThreadSharedType(record);
  if (!thread) {
    throw new TypeError('Proposal anchor is invalid.');
  }

  context.ydoc.transact(() => {
    context.comments.push([thread]);
    appendActivity(context.activity, {
      action: 'proposal_created',
      actor,
      createdAt: record.createdAt,
      outcome: record.status,
      source,
      target: record.id,
    });
  }, 'governance-proposal-create');
  return readProposal(thread);
};

export const revalidateOpenProposals = (context, {
  actor,
  origin = 'governance-revalidate',
  source,
  system = false,
} = {}) => {
  assertContext(context);
  const normalizedActor = normalizeActor(actor);
  const normalizedSource = normalizeSource(source, 'Activity source');

  let changed = [];
  context.ydoc.transact(() => {
    changed = revalidate(context, normalizedActor, normalizedSource);
    if (system) {
      appendActivity(context.activity, {
        action: 'external_reconciliation',
        actor: normalizedActor,
        outcome: 'applied',
        source: normalizedSource,
        target: context.target ?? 'document',
      });
    }
  }, origin);
  return { changed, changedCount: changed.length };
};

export const resolveProposal = (context, { proposalId, resolution, actor } = {}) => {
  assertContext(context);
  const normalizedActor = normalizeActor(actor);
  if (!RESOLUTIONS.has(resolution)) {
    throw new RangeError('Unknown Proposal resolution.');
  }

  const thread = findProposal(context.comments, proposalId);
  if (!thread) {
    throw new RangeError('Unknown Proposal.');
  }
  const proposal = readProposal(thread);
  if (TERMINAL_STATUSES.has(proposal.status)) {
    throw new TypeError('Proposal is terminal.');
  }

  const anchor = resolveAnchor(context, proposal);
  if (resolution === 'apply_proposed' && !anchor) {
    throw new TypeError('Unlocated Conflict cannot apply proposed text.');
  }

  const resolvedAt = Date.now();
  let result;

  context.ydoc.transact(() => {
    const status = resolution === 'apply_proposed' ? 'accepted' : 'rejected';
    if (resolution === 'apply_proposed') {
      if (anchor.to > anchor.from) {
        context.ytext.delete(anchor.from, anchor.to - anchor.from);
      }
      if (proposal.replacementText) {
        context.ytext.insert(anchor.from, proposal.replacementText);
      }
    }
    setStatus(thread, status);
    thread.set('resolution', resolution);
    thread.set('resolvedAt', resolvedAt);
    thread.set('resolvedByParticipantSessionId', normalizedActor.participantSessionId);
    revalidate(context, normalizedActor, 'owner_decision');

    result = readProposal(thread);
    appendActivity(context.activity, {
      action: `proposal_${result.status}`,
      actor: normalizedActor,
      outcome: result.status,
      source: 'owner_decision',
      target: proposal.id,
    });
  }, GOVERNANCE_ORIGIN);
  return result;
};

export const groupReviewItems = (context) => {
  assertContext(context);
  const currentContent = context.ytext.toString();
  const items = context.comments.toArray()
    .filter((thread) => thread instanceof Y.Map && thread.get('kind') === 'proposal')
    .map((thread) => serializeCommentThread(thread))
    .filter(Boolean)
    .filter((proposal) => !TERMINAL_STATUSES.has(proposal.status))
    .map((proposal) => {
      const anchor = resolveAnchor(context, proposal);
      return {
        anchor,
        proposal: {
          ...proposal,
          currentText: anchor ? currentContent.slice(anchor.from, anchor.to) : null,
        },
      };
    })
    .sort((left, right) => {
      if (!left.anchor) return right.anchor ? 1 : left.proposal.createdAt - right.proposal.createdAt;
      if (!right.anchor) return -1;
      return left.anchor.from - right.anchor.from
        || left.anchor.to - right.anchor.to
        || left.proposal.createdAt - right.proposal.createdAt;
    });
  const groups = [];

  for (const item of items) {
    const previous = groups.at(-1);
    const sameLocation = item.anchor
      ? previous && !previous.unlocated && previous.from === item.anchor.from && previous.to === item.anchor.to
      : previous?.unlocated;
    if (sameLocation) {
      previous.proposals.push(item.proposal);
    } else {
      groups.push({
        from: item.anchor?.from ?? null,
        proposals: [item.proposal],
        to: item.anchor?.to ?? null,
        unlocated: !item.anchor,
      });
    }
  }
  return groups;
};
