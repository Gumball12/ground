import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createGroundService } from '../../src/server/application/ground-document-service.js';
import { hydrateGroundYDoc } from '../../src/server/application/ground-yjs-state.js';

const DOCUMENT_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const MAX_UPDATE_BYTES = 64_000;
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
      document.headSequence += 1;
      document.updates.push({ sequence: document.headSequence, update: input.update });
      return { sequence: document.headSequence };
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
  };

  store.launchPlan = launchPlan;
  return store;
};

const buildService = (store, overrides = {}) => createGroundService({
  clock: () => NOW,
  createDocumentId: () => DOCUMENT_ID,
  initialText: store.launchPlan,
  limits: { maxUpdateBytes: MAX_UPDATE_BYTES },
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
