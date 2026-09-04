import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as Y from 'yjs';
import { GROUND_RATE_LIMITS } from '../../src/domain/ground-hosted-contract.js';
import { createGroundService } from '../../src/server/application/ground-document-service.js';
import { hydrateGroundYDoc } from '../../src/server/application/ground-yjs-state.js';
import { createGroundFetchHandler } from '../../src/server/infrastructure/http/create-ground-fetch-handler.js';
import { createGroundSupabaseStore } from '../../src/server/infrastructure/supabase/ground-supabase-store.js';
import { createAdminClient, createAnonymousClient } from './ground-supabase-fixture.js';

const MAX_UPDATE_BYTES = 64_000;
const MAX_DOCUMENT_BYTES = 200_000;
const COMPACTION_UPDATE_COUNT = 50;

const manifest = Object.freeze(JSON.parse(await readFile('collabmd.governance.json', 'utf8')));
const launchPlan = await readFile('docs/demo/launch-plan.md', 'utf8');

const buildService = (limits = {}) => createGroundService({
  initialText: launchPlan,
  limits: {
    compactionUpdateCount: COMPACTION_UPDATE_COUNT,
    maxDocumentBytes: MAX_DOCUMENT_BYTES,
    maxUpdateBytes: MAX_UPDATE_BYTES,
    ...limits,
  },
  manifest,
  store: createGroundSupabaseStore({
    secretKey: process.env.SUPABASE_SECRET_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
  }),
});

// The API transports Yjs bytes as base64; a browser decodes them before replay.
const decodeHydrated = ({ snapshot, updates }) => hydrateGroundYDoc({
  snapshot: snapshot ? Buffer.from(snapshot, 'base64') : undefined,
  updates: updates.map(({ sequence, update }) => ({
    sequence,
    update: Buffer.from(update, 'base64'),
  })),
});

test('the Supabase store carries a full governed flow through real RPCs', async () => {
  const service = buildService();
  const owner = await createAnonymousClient();
  const editor = await createAnonymousClient();

  const created = await service.create_document({ actorId: owner.userId, displayName: 'Owner' });
  assert.match(created.documentId, /^[A-Za-z0-9_-]{22}$/u);
  assert.equal(created.session.roleId, 'owner');
  assert.deepEqual(created.session.capabilities, manifest.roles.owner);

  const joined = await service.join_document({
    actorId: editor.userId,
    displayName: 'Writer Agent',
    documentId: created.documentId,
  });
  assert.equal(joined.session.state, 'pending');
  assert.equal('capabilities' in joined.session, false);

  const assigned = await service.assign_role({
    actorId: owner.userId,
    documentId: created.documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: editor.userId,
  });
  assert.equal(assigned.session.state, 'active');
  assert.equal(assigned.session.roleId, 'editor');
  assert.equal(assigned.session.version, 2);

  const applied = await service.webmcp_apply({
    actorId: editor.userId,
    documentId: created.documentId,
    expectedText: '$100K',
    replacementText: '$110K',
  });
  assert.equal(applied.sequence > assigned.sequence, true);

  const hydrated = await service.hydrate_document({
    actorId: editor.userId,
    documentId: created.documentId,
  });
  const document = decodeHydrated(hydrated);
  assert.equal(document.ytext.toString().includes('$110K'), true);
  assert.equal(document.ytext.toString().includes('$100K'), false);
  assert.deepEqual(
    document.activity.toJSON().map(({ source }) => source),
    ['access_management', 'access_management', 'access_management', 'webmcp_apply'],
  );
});

test('the store denies a Reviewer apply and keeps the document unchanged', async () => {
  const service = buildService();
  const owner = await createAnonymousClient();
  const reviewer = await createAnonymousClient();
  const created = await service.create_document({ actorId: owner.userId, displayName: 'Owner' });
  await service.join_document({
    actorId: reviewer.userId,
    displayName: 'Reviewer Agent',
    documentId: created.documentId,
  });
  await service.assign_role({
    actorId: owner.userId,
    documentId: created.documentId,
    expectedOwnerVersion: 1,
    roleId: 'reviewer',
    targetUserId: reviewer.userId,
  });

  await assert.rejects(service.webmcp_apply({
    actorId: reviewer.userId,
    documentId: created.documentId,
    expectedText: '$100K',
    replacementText: '$130K',
  }), (thrown) => thrown.code === 'GROUND_FORBIDDEN');

  const proposed = await service.webmcp_propose({
    actorId: reviewer.userId,
    documentId: created.documentId,
    expectedText: '$100K',
    replacementText: '$120K',
  });
  assert.equal(Number.isInteger(proposed.sequence), true);
  const hydrated = await service.hydrate_document({
    actorId: owner.userId,
    documentId: created.documentId,
  });
  assert.equal(decodeHydrated(hydrated).ytext.toString().includes('$100K'), true);
});

// Proves the whole fold through the real database: the service decides, the
// store calls the compaction RPC, and the log the next reader replays is gone.
test('hydration folds a long log into one snapshot through the real database', async () => {
  const service = buildService({ compactionUpdateCount: 2 });
  const owner = await createAnonymousClient();
  const created = await service.create_document({ actorId: owner.userId, displayName: 'Owner' });
  const read = () => service.hydrate_document({
    actorId: owner.userId,
    documentId: created.documentId,
  });
  for (const [expectedText, replacementText] of [
    ['Writer target', 'Writer goal'],
    ['Reviewer target', 'Reviewer goal'],
  ]) {
    await service.webmcp_apply({
      actorId: owner.userId,
      documentId: created.documentId,
      expectedText,
      replacementText,
    });
  }

  const before = await read();
  assert.equal(before.updates.length > 0, true);

  const after = await read();
  assert.deepEqual(after.updates, []);
  assert.equal(after.snapshotSequence, before.headSequence);
  assert.equal(decodeHydrated(after).ytext.toString().includes('Reviewer goal'), true);
});

test('the store maps a stale Owner version to GROUND_STALE_STATE', async () => {
  const service = buildService();
  const owner = await createAnonymousClient();
  const visitor = await createAnonymousClient();
  const created = await service.create_document({ actorId: owner.userId, displayName: 'Owner' });
  await service.join_document({
    actorId: visitor.userId,
    displayName: 'Visitor',
    documentId: created.documentId,
  });

  await assert.rejects(service.assign_role({
    actorId: owner.userId,
    documentId: created.documentId,
    expectedOwnerVersion: 99,
    roleId: 'editor',
    targetUserId: visitor.userId,
  }), (thrown) => thrown.code === 'GROUND_STALE_STATE');
});

test('the store reports a missing document as GROUND_UNAVAILABLE', async () => {
  const service = buildService();
  const visitor = await createAnonymousClient();

  await assert.rejects(service.get_session({
    actorId: visitor.userId,
    documentId: 'ZZZZZZZZZZZZZZZZZZZZZZ',
  }), (thrown) => thrown.code === 'GROUND_UNAVAILABLE');
});

test('recovery rotates the token and returns a fresh one without leaking the hash', async () => {
  const service = buildService();
  const owner = await createAnonymousClient();
  const claimant = await createAnonymousClient();
  const created = await service.create_document({ actorId: owner.userId, displayName: 'Owner' });

  const recovered = await service.recover_owner({
    actorId: claimant.userId,
    displayName: 'Recovered Owner',
    documentId: created.documentId,
    recoveryToken: created.recoveryToken,
  });

  assert.match(recovered.recoveryToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(recovered.recoveryToken, created.recoveryToken);
  const session = await service.get_session({
    actorId: claimant.userId,
    documentId: created.documentId,
  });
  assert.equal(session.session.roleId, 'owner');
  await assert.rejects(service.recover_owner({
    actorId: claimant.userId,
    displayName: 'Recovered Owner',
    documentId: created.documentId,
    recoveryToken: created.recoveryToken,
  }), (thrown) => thrown.code === 'GROUND_UNAVAILABLE');
});

const ALLOWED_ORIGIN = 'https://ground.test';

// Drives the real HTTP boundary over the real database so a denied request is
// observed exactly as a browser would cause it.
const buildRateLimitedHandler = ({ rateLimits, session }) => createGroundFetchHandler({
  allowedOrigins: [ALLOWED_ORIGIN],
  authVerifier: { verify: async () => ({ userId: session.userId }) },
  publicConfig: { groundHosted: true },
  service: createGroundService({
    initialText: launchPlan,
    limits: {
      compactionUpdateCount: COMPACTION_UPDATE_COUNT,
      maxDocumentBytes: MAX_DOCUMENT_BYTES,
      maxUpdateBytes: MAX_UPDATE_BYTES,
    },
    manifest,
    // A fresh key per handler keeps each run inside its own rate window.
    rateLimitHmacKey: randomBytes(32).toString('hex'),
    rateLimits,
    store: createGroundSupabaseStore({
      secretKey: process.env.SUPABASE_SECRET_KEY,
      supabaseUrl: process.env.SUPABASE_URL,
    }),
  }),
});

const postOperation = (handler, body) => handler.fetch(new Request(
  'https://ground.test/api/ground',
  {
    body: JSON.stringify(body),
    headers: {
      authorization: 'Bearer test-session',
      'content-type': 'application/json',
      origin: ALLOWED_ORIGIN,
      'x-forwarded-for': '203.0.113.7',
    },
    method: 'POST',
  },
));

const appendTextOperation = (documentId, value) => {
  const ydoc = new Y.Doc();
  const before = Y.encodeStateVector(ydoc);
  ydoc.getText('codemirror').insert(0, value);
  return {
    documentId,
    operation: 'append_update',
    update: Buffer.from(Y.encodeStateAsUpdate(ydoc, before)).toString('base64'),
  };
};

const ownedDocumentIds = async (userId) => {
  const { data, error } = await createAdminClient()
    .from('ground_participants')
    .select('document_id')
    .eq('user_id', userId)
    .eq('role_id', 'owner');
  assert.equal(error, null);
  return data.map((row) => row.document_id);
};

// The user-facing contract: request N succeeds, request N+1 is refused with 429,
// and the refusal leaves the document, its sequence, and its Activity untouched.
test('a rate-limited mutation returns 429 and changes no sequence or Activity', async () => {
  const owner = await createAnonymousClient();
  const service = buildService();
  const created = await service.create_document({
    actorId: owner.userId,
    displayName: 'Owner',
  });
  const handler = buildRateLimitedHandler({
    rateLimits: { mutation: { limit: 1, windowSeconds: 3_600 } },
    session: owner,
  });

  const before = await service.webmcp_read({
    actorId: owner.userId,
    documentId: created.documentId,
  });

  const allowed = await postOperation(handler, appendTextOperation(created.documentId, 'accepted'));
  assert.equal(allowed.status, 200);

  const accepted = await service.webmcp_read({
    actorId: owner.userId,
    documentId: created.documentId,
  });
  assert.equal(accepted.headSequence, before.headSequence + 1);

  const denied = await postOperation(handler, appendTextOperation(created.documentId, 'refused'));
  assert.equal(denied.status, 429);
  assert.deepEqual(await denied.json(), { code: 'GROUND_RATE_LIMITED' });

  const after = await service.webmcp_read({
    actorId: owner.userId,
    documentId: created.documentId,
  });
  assert.equal(after.headSequence, accepted.headSequence);
  assert.equal(after.text, accepted.text);
  assert.equal(after.text.includes('refused'), false);
  assert.deepEqual(after.activity, accepted.activity);
});

test('a rate-limited creation stores no document for the refused request', async () => {
  const owner = await createAnonymousClient();
  const handler = buildRateLimitedHandler({
    rateLimits: { create: { limit: 1, windowSeconds: 3_600 } },
    session: owner,
  });

  const allowed = await postOperation(handler, {
    displayName: 'Owner',
    operation: 'create_document',
  });
  assert.equal(allowed.status, 200);
  const { documentId } = await allowed.json();

  const denied = await postOperation(handler, {
    displayName: 'Owner',
    operation: 'create_document',
  });
  assert.equal(denied.status, 429);
  assert.deepEqual(await denied.json(), { code: 'GROUND_RATE_LIMITED' });

  assert.deepEqual(await ownedDocumentIds(owner.userId), [documentId]);
});

// A rejected request must not consume the caller's identity either: the same
// session stays usable once its window advances.
test('the deployed runtime carries the frozen MVP rate thresholds', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(GROUND_RATE_LIMITS)), {
    create: { limit: 10, windowSeconds: 3600 },
    join: { limit: 30, windowSeconds: 3600 },
    mutation: { limit: 40, windowSeconds: 10 },
  });
});
