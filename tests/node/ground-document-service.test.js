import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createGroundService } from '../../src/server/application/ground-document-service.js';
import { captureGroundUpdate, hydrateGroundYDoc } from '../../src/server/application/ground-yjs-state.js';

const DOCUMENT_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const MAX_DOCUMENT_BYTES = 200_000;
const MAX_UPDATE_BYTES = 64_000;
const COMPACTION_UPDATE_COUNT = 50;
const NOW = '2026-09-04T00:00:00.000Z';

const manifest = Object.freeze({
  roles: {
    editor: ['document.read', 'document.suggest', 'document.edit'],
    owner: ['document.read', 'document.suggest', 'document.edit', 'conflict.resolve', 'grant.manage'],
    reviewer: ['document.read', 'document.suggest'],
  },
});

const groundCode = (thrown) => thrown?.code;

const unavailable = () => Object.assign(
  new Error('GROUND_UNAVAILABLE'),
  { code: 'GROUND_UNAVAILABLE' },
);

const createGroundStoreFake = ({ launchPlan = '' } = {}) => {
  const documents = new Map();
  const calls = [];
  const rateWindows = new Map();

  const documentOr = (documentId) => {
    const document = documents.get(documentId);
    if (!document) {
      throw unavailable();
    }
    return document;
  };

  const participantOr = (document, userId) => {
    const participant = document.participants.get(userId);
    if (!participant) {
      throw unavailable();
    }
    return participant;
  };

  const record = (name, input) => calls.push({ input, name });

  const store = {
    assignRole: async (input) => {
      record('assignRole', input);
      const document = documentOr(input.documentId);
      const owner = participantOr(document, input.ownerId);
      if (owner.roleVersion !== input.expectedOwnerVersion) {
        throw Object.assign(new Error('GROUND_STALE_STATE'), { code: 'GROUND_STALE_STATE' });
      }
      const target = participantOr(document, input.targetUserId);
      const next = {
        ...target,
        accessState: 'active',
        roleId: input.roleId,
        roleVersion: target.roleVersion + 1,
      };
      document.participants.set(input.targetUserId, next);
      document.headSequence += 1;
      document.updates.push({ sequence: document.headSequence, update: input.activityUpdate });
      return { participant: next, sequence: document.headSequence };
    },
    calls,
    commitUpdate: async (input) => {
      record('commitUpdate', input);
      const document = documentOr(input.documentId);
      const actor = participantOr(document, input.actorId);
      if (actor.roleVersion !== input.expectedRoleVersion) {
        throw Object.assign(new Error('GROUND_STALE_STATE'), { code: 'GROUND_STALE_STATE' });
      }
      // Mirrors the head requirement: a server-composed edit names the head it
      // was composed against and is refused once another commit has moved it.
      if (input.expectedHeadSequence !== undefined
        && input.expectedHeadSequence !== document.headSequence) {
        throw Object.assign(new Error('GROUND_STALE_STATE'), { code: 'GROUND_STALE_STATE' });
      }
      document.headSequence += 1;
      document.updates.push({ sequence: document.headSequence, update: input.update });
      return { sequence: document.headSequence };
    },
    // Mirrors `public.ground_compact_document`: it replaces the snapshot,
    // advances the snapshot sequence, and drops only the folded log rows.
    compactDocument: async (input) => {
      record('compactDocument', input);
      const document = documentOr(input.documentId);
      if (input.candidateSequence > document.headSequence) {
        throw Object.assign(new Error('GROUND_STALE_STATE'), { code: 'GROUND_STALE_STATE' });
      }
      document.snapshot = input.snapshot;
      document.snapshotSequence = input.candidateSequence;
      document.updates = document.updates.filter(
        ({ sequence }) => sequence > input.candidateSequence,
      );
      return { snapshotSequence: input.candidateSequence };
    },
    create: async (input) => {
      record('create', input);
      if (documents.has(input.documentId)) {
        throw Object.assign(new Error('taken'), { code: 'GROUND_DOCUMENT_ID_TAKEN' });
      }
      documents.set(input.documentId, {
        headSequence: 0,
        participants: new Map([[input.ownerId, {
          accessState: 'active',
          displayName: input.displayName,
          roleId: 'owner',
          roleVersion: 1,
          userId: input.ownerId,
        }]]),
        recoveryTokenHash: input.recoveryTokenHash,
        snapshot: input.snapshot,
        snapshotSequence: 0,
        updates: [],
      });
      return { accessState: 'active', roleId: 'owner', roleVersion: 1 };
    },
    documents,
    getSession: async (input) => {
      record('getSession', input);
      return documents.get(input.documentId)?.participants.get(input.userId);
    },
    join: async (input) => {
      record('join', input);
      const document = documentOr(input.documentId);
      const existing = document.participants.get(input.userId);
      if (existing) {
        return existing;
      }
      const participant = {
        accessState: 'pending',
        displayName: input.displayName,
        roleId: undefined,
        roleVersion: 1,
        userId: input.userId,
      };
      document.participants.set(input.userId, participant);
      document.headSequence += 1;
      document.updates.push({ sequence: document.headSequence, update: input.activityUpdate });
      return participant;
    },
    listParticipants: async (input) => {
      record('listParticipants', input);
      return [...documentOr(input.documentId).participants.values()];
    },
    loadState: async (input) => {
      record('loadState', input);
      const document = documentOr(input.documentId);
      return {
        headSequence: document.headSequence,
        snapshot: document.snapshot,
        snapshotSequence: document.snapshotSequence,
        updates: document.updates,
      };
    },
    recover: async (input) => {
      record('recover', input);
      const document = documentOr(input.documentId);
      if (!document.recoveryTokenHash.equals(input.tokenHash)) {
        throw unavailable();
      }
      document.recoveryTokenHash = input.nextTokenHash;
      document.headSequence += 1;
      document.updates.push({ sequence: document.headSequence, update: input.activityUpdate });
      return { sequence: document.headSequence };
    },
    revoke: async (input) => {
      record('revoke', input);
      const document = documentOr(input.documentId);
      const target = participantOr(document, input.targetUserId);
      const next = {
        ...target,
        accessState: 'revoked',
        roleId: undefined,
        roleVersion: target.roleVersion + 1,
      };
      document.participants.set(input.targetUserId, next);
      document.headSequence += 1;
      document.updates.push({ sequence: document.headSequence, update: input.activityUpdate });
      return { participant: next, sequence: document.headSequence };
    },
    // Mirrors `public.ground_take_rate_limit`: one aligned fixed window per
    // scope and key hash, incremented first and compared to the limit after.
    takeRateLimit: async (input) => {
      record('takeRateLimit', input);
      const seconds = Math.floor(Date.parse(input.now) / 1000);
      const windowStart = Math.floor(seconds / input.windowSeconds) * input.windowSeconds;
      const key = [
        input.scope,
        Buffer.from(input.keyHash).toString('hex'),
        windowStart,
      ].join(':');
      const count = (rateWindows.get(key) ?? 0) + 1;
      rateWindows.set(key, count);
      return count <= input.limit;
    },
  };

  store.launchPlan = launchPlan;
  return store;
};

const buildService = (store, overrides = {}) => createGroundService({
  clock: () => NOW,
  createDocumentId: () => DOCUMENT_ID,
  initialText: store.launchPlan,
  limits: {
    compactionUpdateCount: COMPACTION_UPDATE_COUNT,
    maxDocumentBytes: MAX_DOCUMENT_BYTES,
    maxUpdateBytes: MAX_UPDATE_BYTES,
  },
  manifest,
  store,
  ...overrides,
});

const seedDocument = (service) => service.create_document({
  actorId: 'user-owner',
  displayName: 'Owner',
});

test('join creates Pending without returning document state', async () => {
  const store = createGroundStoreFake();
  const service = buildService(store);
  await seedDocument(service);

  const result = await service.join_document({
    actorId: 'user-reviewer',
    displayName: 'Reviewer Agent',
    documentId: DOCUMENT_ID,
  });

  assert.equal(result.session.state, 'pending');
  assert.equal(result.session.roleId, undefined);
  assert.equal('capabilities' in result.session, false);
  assert.equal('snapshot' in result, false);
  assert.equal('updates' in result, false);
});

// A join appends Activity to the shared document, so it is bounded by the same
// document byte limit as every other update and fails closed without one.
test('join_document sends the document byte limit to the store', async () => {
  const store = createGroundStoreFake();
  const service = buildService(store);
  await seedDocument(service);

  await service.join_document({
    actorId: 'user-reviewer',
    displayName: 'Reviewer Agent',
    documentId: DOCUMENT_ID,
  });

  const [{ input }] = store.calls.filter(({ name }) => name === 'join');
  assert.equal(input.maxDocumentBytes, MAX_DOCUMENT_BYTES);
});

test('join_document fails closed when no document byte limit is calibrated', async () => {
  const store = createGroundStoreFake();
  await seedDocument(buildService(store));
  const service = buildService(store, { limits: { maxUpdateBytes: MAX_UPDATE_BYTES } });

  await assert.rejects(service.join_document({
    actorId: 'user-reviewer',
    displayName: 'Reviewer Agent',
    documentId: DOCUMENT_ID,
  }), (thrown) => groundCode(thrown) === 'GROUND_TEMPORARILY_UNAVAILABLE');

  assert.deepEqual(store.calls.filter(({ name }) => name === 'join'), []);
});

test('three generated id collisions fail with GROUND_TEMPORARILY_UNAVAILABLE and no fourth call', async () => {
  const store = createGroundStoreFake();
  await seedDocument(buildService(store));
  const service = buildService(store);
  const before = store.calls.filter(({ name }) => name === 'create').length;

  await assert.rejects(
    service.create_document({ actorId: 'user-owner-2', displayName: 'Owner Two' }),
    (thrown) => groundCode(thrown) === 'GROUND_TEMPORARILY_UNAVAILABLE',
  );

  assert.equal(store.calls.filter(({ name }) => name === 'create').length - before, 3);
});

test('create_document returns the raw recovery token once and stores only its hash', async () => {
  const store = createGroundStoreFake({
    launchPlan: await readFile('docs/demo/launch-plan.md', 'utf8'),
  });
  const service = buildService(store);

  const created = await service.create_document({ actorId: 'user-owner', displayName: 'Owner' });

  assert.match(created.recoveryToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(created.session.roleId, 'owner');
  assert.deepEqual(
    store.documents.get(DOCUMENT_ID).recoveryTokenHash,
    createHash('sha256').update(created.recoveryToken, 'utf8').digest(),
  );
  const hydrated = hydrateGroundYDoc({ snapshot: store.documents.get(DOCUMENT_ID).snapshot });
  assert.equal(hydrated.ytext.toString(), store.launchPlan);
});

test('the manifest matrix allows Editor apply and Reviewer propose but denies Reviewer apply', async () => {
  const store = createGroundStoreFake({ launchPlan: 'The approved launch budget is $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  for (const [userId, roleId] of [['user-editor', 'editor'], ['user-reviewer', 'reviewer']]) {
    await service.join_document({ actorId: userId, displayName: roleId, documentId: DOCUMENT_ID });
    await service.assign_role({
      actorId: 'user-owner',
      documentId: DOCUMENT_ID,
      expectedOwnerVersion: 1,
      roleId,
      targetUserId: userId,
    });
  }

  const applied = await service.webmcp_apply({
    actorId: 'user-editor',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });
  const proposed = await service.webmcp_propose({
    actorId: 'user-reviewer',
    documentId: DOCUMENT_ID,
    expectedText: '$110K',
    replacementText: '$120K',
  });

  assert.equal(Number.isInteger(applied.sequence), true);
  assert.equal(Number.isInteger(proposed.sequence), true);
  await assert.rejects(service.webmcp_apply({
    actorId: 'user-reviewer',
    documentId: DOCUMENT_ID,
    expectedText: '$110K',
    replacementText: '$130K',
  }), (thrown) => groundCode(thrown) === 'GROUND_FORBIDDEN');
});

test('every WebMCP mutation records the actor role and its fixed Activity source', async () => {
  const store = createGroundStoreFake({ launchPlan: 'The approved launch budget is $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);

  const read = await service.webmcp_read({ actorId: 'user-owner', documentId: DOCUMENT_ID });
  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });
  await service.webmcp_propose({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$110K',
    replacementText: '$120K',
  });

  assert.equal(read.text.includes('$100K'), true);
  const document = store.documents.get(DOCUMENT_ID);
  const hydrated = hydrateGroundYDoc({ snapshot: document.snapshot, updates: document.updates });
  assert.deepEqual(hydrated.activity.toJSON().map(({ actor, source }) => [actor.roleId, source]), [
    ['owner', 'access_management'],
    ['owner', 'webmcp_apply'],
    ['owner', 'webmcp_proposal'],
  ]);
});

test('a stale role version maps to GROUND_STALE_STATE', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const document = store.documents.get(DOCUMENT_ID);
  document.participants.set('user-owner', {
    ...document.participants.get('user-owner'),
    roleVersion: 5,
  });

  await assert.rejects(service.append_update({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedRoleVersion: 1,
    update: Buffer.from([1, 2, 3]).toString('base64'),
  }), (thrown) => groundCode(thrown) === 'GROUND_STALE_STATE');
});

test('an access transition sends its Activity update inside the same store call', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  await service.join_document({
    actorId: 'user-editor',
    displayName: 'Writer',
    documentId: DOCUMENT_ID,
  });
  const brittle = buildService({
    ...store,
    assignRole: async () => { throw new Error('store offline'); },
  });
  const headBefore = store.documents.get(DOCUMENT_ID).headSequence;

  await assert.rejects(brittle.assign_role({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: 'user-editor',
  }));

  assert.equal(store.documents.get(DOCUMENT_ID).headSequence, headBefore);
  assert.equal(store.documents.get(DOCUMENT_ID).participants.get('user-editor').accessState, 'pending');
  assert.deepEqual(store.calls.filter(({ name }) => name === 'assignRole'), []);
  await service.assign_role({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: 'user-editor',
  });
  const [call] = store.calls.filter(({ name }) => name === 'assignRole');
  assert.equal(call.input.activityUpdate instanceof Uint8Array, true);
  assert.equal(store.calls.some(({ input, name }) => (
    name === 'commitUpdate' && input.operationKind === 'access_change'
  )), false);
});

test('Pending and Revoked sessions omit capabilities and document data', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  await service.join_document({
    actorId: 'user-editor',
    displayName: 'Writer',
    documentId: DOCUMENT_ID,
  });

  const pending = await service.get_session({ actorId: 'user-editor', documentId: DOCUMENT_ID });
  await service.assign_role({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: 'user-editor',
  });
  const active = await service.get_session({ actorId: 'user-editor', documentId: DOCUMENT_ID });
  await service.revoke_participant({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedOwnerVersion: 1,
    targetUserId: 'user-editor',
  });
  const revoked = await service.get_session({ actorId: 'user-editor', documentId: DOCUMENT_ID });

  assert.equal('capabilities' in pending.session, false);
  assert.deepEqual(active.session.capabilities, manifest.roles.editor);
  assert.equal(active.session.version, 2);
  assert.equal('capabilities' in revoked.session, false);
  assert.equal(revoked.session.state, 'revoked');
  await assert.rejects(
    service.hydrate_document({ actorId: 'user-editor', documentId: DOCUMENT_ID }),
    (thrown) => groundCode(thrown) === 'GROUND_FORBIDDEN',
  );
});

test('list_roles reports the manifest without duplicating it in client code', async () => {
  const service = buildService(createGroundStoreFake());

  const result = await service.list_roles({ actorId: 'user-owner' });

  assert.deepEqual(result.roles, [
    { capabilities: manifest.roles.editor, roleId: 'editor' },
    { capabilities: manifest.roles.owner, roleId: 'owner' },
    { capabilities: manifest.roles.reviewer, roleId: 'reviewer' },
  ]);
});

test('mutations fail closed when no update byte limit is calibrated', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  await seedDocument(buildService(store));
  const service = buildService(store, { limits: {} });

  await assert.rejects(service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  }), (thrown) => groundCode(thrown) === 'GROUND_TEMPORARILY_UNAVAILABLE');
});

test('hydrate_document returns JSON-safe base64 bytes the browser can decode', async () => {
  const store = createGroundStoreFake({ launchPlan: 'The approved launch budget is $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });

  const hydrated = await service.hydrate_document({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
  });

  assert.equal(typeof hydrated.snapshot, 'string');
  assert.match(hydrated.snapshot, /^[A-Za-z0-9+/]*={0,2}$/u);
  assert.equal(hydrated.updates.length, 1);
  assert.equal(typeof hydrated.updates[0].update, 'string');
  assert.equal(Number.isInteger(hydrated.updates[0].sequence), true);

  // A browser decodes the transported strings and replays them into one Y.Doc.
  const replayed = hydrateGroundYDoc({
    snapshot: Buffer.from(hydrated.snapshot, 'base64'),
    updates: hydrated.updates.map(({ sequence, update }) => ({
      sequence,
      update: Buffer.from(update, 'base64'),
    })),
  });
  assert.equal(replayed.ytext.toString(), 'The approved launch budget is $110K.\n');

  // The transported body must not inflate bytes into numeric-key objects.
  const body = JSON.stringify(hydrated);
  assert.equal(body.includes('"0":'), false);
});

test('append_update sends both committed size limits to the store', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget.\n' });
  const service = buildService(store);
  await seedDocument(service);

  await service.append_update({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    update: Buffer.from([1, 2, 3]).toString('base64'),
  });

  const [{ input }] = store.calls.filter(({ name }) => name === 'commitUpdate').slice(-1);
  assert.equal(input.maxUpdateBytes, MAX_UPDATE_BYTES);
  assert.equal(input.maxDocumentBytes, MAX_DOCUMENT_BYTES);
});

test('mutations fail closed when no document byte limit is calibrated', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  await seedDocument(buildService(store));
  const service = buildService(store, { limits: { maxUpdateBytes: MAX_UPDATE_BYTES } });

  await assert.rejects(service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  }), (thrown) => groundCode(thrown) === 'GROUND_TEMPORARILY_UNAVAILABLE');
});

// Replay cost is paid by the reader, so hydration is where a long log hurts and
// where the Y.Doc needed to fold it has already been built.
test('hydrate_document folds a long update log into one snapshot', async () => {
  const store = createGroundStoreFake({ launchPlan: 'The approved launch budget is $100K.\n' });
  const service = buildService(store, {
    limits: {
      compactionUpdateCount: 2,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
      maxUpdateBytes: MAX_UPDATE_BYTES,
    },
  });
  await seedDocument(service);
  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });
  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$110K',
    replacementText: '$120K',
  });

  const hydrated = await service.hydrate_document({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
  });

  const compactions = store.calls.filter(({ name }) => name === 'compactDocument');
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0].input.candidateSequence, hydrated.headSequence);

  // The folded snapshot alone must carry the whole document.
  const next = await service.hydrate_document({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
  });
  assert.deepEqual(next.updates, []);
  assert.equal(next.snapshotSequence, hydrated.headSequence);
  assert.equal(hydrateGroundYDoc({
    snapshot: Buffer.from(next.snapshot, 'base64'),
    updates: [],
  }).ytext.toString(), 'The approved launch budget is $120K.\n');
});

test('hydrate_document leaves a short update log alone', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });

  await service.hydrate_document({ actorId: 'user-owner', documentId: DOCUMENT_ID });

  assert.deepEqual(store.calls.filter(({ name }) => name === 'compactDocument'), []);
});

// Compaction only shortens replay. A failed fold must never fail the read.
test('hydrate_document still answers when compaction fails', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService({
    ...store,
    compactDocument: async () => { throw new Error('store offline'); },
  }, {
    limits: {
      compactionUpdateCount: 1,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
      maxUpdateBytes: MAX_UPDATE_BYTES,
    },
  });
  await seedDocument(service);
  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });

  const hydrated = await service.hydrate_document({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
  });

  assert.equal(hydrateGroundYDoc({
    snapshot: Buffer.from(hydrated.snapshot, 'base64'),
    updates: hydrated.updates.map(({ sequence, update }) => ({
      sequence,
      update: Buffer.from(update, 'base64'),
    })),
  }).ytext.toString(), 'Budget $110K.\n');
});

test('append_update audits the editor operation kind the client declares', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const update = Buffer.from([1, 2, 3]).toString('base64');

  await service.append_update({ actorId: 'user-owner', documentId: DOCUMENT_ID, update });
  await service.append_update({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    operationKind: 'proposal_create',
    update,
  });

  const committed = store.calls
    .filter(({ name }) => name === 'commitUpdate')
    .map(({ input }) => [input.operationKind, input.source]);
  assert.deepEqual(committed, [
    ['document_edit', 'document_editor'],
    ['proposal_create', 'document_editor'],
  ]);
});

test('append_update refuses a server-only or unknown operation kind', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const update = Buffer.from([1, 2, 3]).toString('base64');

  for (const operationKind of ['access_change', 'owner_recovery', 'proposal_resolve', 'nonsense']) {
    await assert.rejects(
      service.append_update({
        actorId: 'user-owner',
        documentId: DOCUMENT_ID,
        operationKind,
        update,
      }),
      (thrown) => groundCode(thrown) === 'GROUND_INVALID_REQUEST',
      operationKind,
    );
  }
});

test('webmcp_apply applies every replacement in one atomic sequence', async () => {
  const store = createGroundStoreFake({
    launchPlan: 'Budget is $100K and the date is March.\n',
  });
  const service = buildService(store);
  await seedDocument(service);
  const before = store.documents.get(DOCUMENT_ID).headSequence;

  const applied = await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    replacements: [
      { expectedText: '$100K', replacementText: '$110K' },
      { expectedText: 'March', replacementText: 'April' },
    ],
  });

  assert.equal(applied.sequence, before + 1);
  const document = store.documents.get(DOCUMENT_ID);
  const hydrated = hydrateGroundYDoc({
    snapshot: document.snapshot,
    updates: document.updates,
  });
  assert.equal(hydrated.ytext.toString(), 'Budget is $110K and the date is April.\n');
  assert.deepEqual(
    hydrated.activity.toJSON().filter(({ source }) => source === 'webmcp_apply').length,
    1,
  );
});

test('webmcp_apply refuses an empty replacement list', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget is $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);

  await assert.rejects(
    service.webmcp_apply({
      actorId: 'user-owner',
      documentId: DOCUMENT_ID,
      replacements: [],
    }),
    (thrown) => groundCode(thrown) === 'GROUND_INVALID_REQUEST',
  );
});

test('webmcp_apply leaves the document unchanged when one replacement is stale', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget is $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const before = store.documents.get(DOCUMENT_ID).headSequence;

  await assert.rejects(
    service.webmcp_apply({
      actorId: 'user-owner',
      documentId: DOCUMENT_ID,
      replacements: [
        { expectedText: '$100K', replacementText: '$110K' },
        { expectedText: 'missing text', replacementText: 'x' },
      ],
    }),
    (thrown) => groundCode(thrown) === 'GROUND_STALE_STATE',
  );

  assert.equal(store.documents.get(DOCUMENT_ID).headSequence, before);
});

// A text-only request can name one occurrence only. The hosted apply path and
// the local proposal path both refuse a repeated target; a Proposal anchored to
// the first occurrence would point the Owner at a passage the agent never meant.
test('webmcp_propose refuses a target that occurs more than once', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K now, budget $100K later.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const before = store.documents.get(DOCUMENT_ID).headSequence;

  await assert.rejects(
    service.webmcp_propose({
      actorId: 'user-owner',
      documentId: DOCUMENT_ID,
      expectedText: '$100K',
      replacementText: '$110K',
    }),
    (thrown) => groundCode(thrown) === 'GROUND_STALE_STATE',
  );

  assert.equal(store.documents.get(DOCUMENT_ID).headSequence, before);
});

// An editor commit that lands between a WebMCP load and its commit, exactly as
// a concurrent participant's keystroke would.
const commitConcurrentEditorText = (store, text) => {
  const document = store.documents.get(DOCUMENT_ID);
  const context = hydrateGroundYDoc({ snapshot: document.snapshot, updates: document.updates });
  const update = captureGroundUpdate(context, ({ ytext }) => ytext.insert(ytext.length, text));
  document.headSequence += 1;
  document.updates.push({ sequence: document.headSequence, update });
};

const readDocumentText = (store) => {
  const document = store.documents.get(DOCUMENT_ID);
  return hydrateGroundYDoc({ snapshot: document.snapshot, updates: document.updates })
    .ytext.toString();
};

// Two WebMCP applies can validate the same target against the same text. The
// commit names the head that text came from, so the second is refused once the
// first has moved it; the editor path merges concurrent edits and names none.
test('webmcp_apply commits against the head it loaded and the editor path does not', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const head = store.documents.get(DOCUMENT_ID).headSequence;

  await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });
  await service.append_update({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    update: Buffer.from([1, 2, 3]).toString('base64'),
  });

  const [applied, appended] = store.calls
    .filter(({ name }) => name === 'commitUpdate')
    .map(({ input }) => input.expectedHeadSequence);
  assert.equal(applied, head);
  assert.equal(appended, undefined);
});

test('webmcp_apply recomposes against a newer head after a concurrent commit', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const commitUpdate = store.commitUpdate;
  let interleaved = false;
  store.commitUpdate = async (input) => {
    if (!interleaved) {
      interleaved = true;
      commitConcurrentEditorText(store, 'Appendix.\n');
    }
    return commitUpdate(input);
  };

  const applied = await service.webmcp_apply({
    actorId: 'user-owner',
    documentId: DOCUMENT_ID,
    expectedText: '$100K',
    replacementText: '$110K',
  });

  const commits = store.calls.filter(({ name }) => name === 'commitUpdate');
  assert.equal(commits.length, 2);
  assert.equal(commits[1].input.expectedHeadSequence, commits[0].input.expectedHeadSequence + 1);
  assert.equal(applied.sequence, store.documents.get(DOCUMENT_ID).headSequence);
  assert.equal(readDocumentText(store), 'Budget $110K.\nAppendix.\n');
});

test('webmcp_apply gives up after three commits refused for a moved head', async () => {
  const store = createGroundStoreFake({ launchPlan: 'Budget $100K.\n' });
  const service = buildService(store);
  await seedDocument(service);
  const commitUpdate = store.commitUpdate;
  store.commitUpdate = async (input) => {
    commitConcurrentEditorText(store, 'More.\n');
    return commitUpdate(input);
  };

  await assert.rejects(
    service.webmcp_apply({
      actorId: 'user-owner',
      documentId: DOCUMENT_ID,
      expectedText: '$100K',
      replacementText: '$110K',
    }),
    (thrown) => groundCode(thrown) === 'GROUND_STALE_STATE',
  );

  assert.equal(store.calls.filter(({ name }) => name === 'commitUpdate').length, 3);
  assert.equal(store.calls.filter(({ name }) => name === 'loadState').length, 3);
  assert.equal(readDocumentText(store), 'Budget $100K.\nMore.\nMore.\nMore.\n');
});

const RATE_HMAC_KEY = 'ground-test-rate-key';

const RATE_LIMITS = Object.freeze({
  create: Object.freeze({ limit: 2, windowSeconds: 3_600 }),
  join: Object.freeze({ limit: 3, windowSeconds: 3_600 }),
  mutation: Object.freeze({ limit: 2, windowSeconds: 10 }),
});

const buildRateLimitedService = (store, overrides = {}) => buildService(store, {
  rateLimitHmacKey: RATE_HMAC_KEY,
  rateLimits: RATE_LIMITS,
  ...overrides,
});

const expectedRateKey = (kind, value) => createHmac('sha256', RATE_HMAC_KEY)
  .update(`${kind}:${value}`, 'utf8')
  .digest();

test('allows requests up to the scope limit and denies the next one', async () => {
  const store = createGroundStoreFake();
  const service = buildRateLimitedService(store);
  const take = () => service.enforceRateLimit({
    networkId: '203.0.113.7',
    scope: 'create',
    userId: 'user-owner',
  });

  await take();
  await take();

  assert.equal(await take().then(() => null, groundCode), 'GROUND_RATE_LIMITED');
});

test('starts a fresh count once the fixed window advances', async () => {
  const store = createGroundStoreFake();
  let clockValue = '2026-09-04T00:00:00.000Z';
  const service = buildRateLimitedService(store, { clock: () => clockValue });
  const take = () => service.enforceRateLimit({
    networkId: '203.0.113.7',
    scope: 'mutation',
    userId: 'user-owner',
  });

  await take();
  await take();
  assert.equal(await take().then(() => null, groundCode), 'GROUND_RATE_LIMITED');

  clockValue = '2026-09-04T00:00:10.000Z';
  await take();
});

// The create scope also counts the request network identifier so repeatedly
// creating fresh anonymous users cannot walk past the boundary.
test('counts creation independently for the actor and the request network', async () => {
  const store = createGroundStoreFake();
  const service = buildRateLimitedService(store);
  const take = (userId, networkId) => service.enforceRateLimit({
    networkId,
    scope: 'create',
    userId,
  });

  await take('user-a', '203.0.113.7');
  await take('user-b', '203.0.113.7');

  assert.equal(
    await take('user-c', '203.0.113.7').then(() => null, groundCode),
    'GROUND_RATE_LIMITED',
  );
  await take('user-c', '198.51.100.9');
});

test('counts a join and a mutation by actor only', async () => {
  const store = createGroundStoreFake();
  const service = buildRateLimitedService(store);

  await service.enforceRateLimit({ networkId: '203.0.113.7', scope: 'join', userId: 'user-a' });
  await service.enforceRateLimit({ networkId: '203.0.113.7', scope: 'mutation', userId: 'user-a' });

  assert.deepEqual(
    store.calls.filter(({ name }) => name === 'takeRateLimit').map(({ input }) => ({
      keyHash: input.keyHash,
      limit: input.limit,
      scope: input.scope,
      windowSeconds: input.windowSeconds,
    })),
    [
      {
        keyHash: expectedRateKey('user', 'user-a'),
        limit: 3,
        scope: 'join',
        windowSeconds: 3_600,
      },
      {
        keyHash: expectedRateKey('user', 'user-a'),
        limit: 2,
        scope: 'mutation',
        windowSeconds: 10,
      },
    ],
  );
});

// Only the server holds the keyed hash input, so a stored window row can never
// be traced back to an anonymous user id or a raw network address.
test('keys a rate window by a keyed hash rather than the raw identifier', async () => {
  const store = createGroundStoreFake();
  const service = buildRateLimitedService(store);

  await service.enforceRateLimit({
    networkId: '203.0.113.7',
    scope: 'create',
    userId: 'user-owner',
  });

  const hashes = store.calls
    .filter(({ name }) => name === 'takeRateLimit')
    .map(({ input }) => input.keyHash);

  assert.deepEqual(hashes, [
    expectedRateKey('user', 'user-owner'),
    expectedRateKey('network', '203.0.113.7'),
  ]);
  for (const hash of hashes) {
    assert.equal(hash.length, 32);
    const text = Buffer.from(hash).toString('latin1');
    assert.equal(text.includes('user-owner'), false);
    assert.equal(text.includes('203.0.113.7'), false);
  }
});

test('fails closed when the rate-limit configuration is missing or unknown', async () => {
  const store = createGroundStoreFake();
  const unconfigured = buildService(store);
  const configured = buildRateLimitedService(store);

  assert.equal(
    await unconfigured.enforceRateLimit({
      networkId: '203.0.113.7', scope: 'create', userId: 'user-owner',
    }).then(() => null, groundCode),
    'GROUND_TEMPORARILY_UNAVAILABLE',
  );
  assert.equal(
    await configured.enforceRateLimit({
      networkId: '203.0.113.7', scope: 'unknown', userId: 'user-owner',
    }).then(() => null, groundCode),
    'GROUND_TEMPORARILY_UNAVAILABLE',
  );
  assert.deepEqual(store.calls.filter(({ name }) => name === 'takeRateLimit'), []);
});
