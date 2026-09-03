import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createGroundService } from '../../src/server/application/ground-document-service.js';
import { hydrateGroundYDoc } from '../../src/server/application/ground-yjs-state.js';
import { createGroundSupabaseStore } from '../../src/server/infrastructure/supabase/ground-supabase-store.js';
import { createAnonymousClient } from './ground-supabase-fixture.js';

const MAX_UPDATE_BYTES = 64_000;

const manifest = Object.freeze(JSON.parse(await readFile('collabmd.governance.json', 'utf8')));
const launchPlan = await readFile('docs/demo/launch-plan.md', 'utf8');

const buildService = () => createGroundService({
  initialText: launchPlan,
  limits: { maxUpdateBytes: MAX_UPDATE_BYTES },
  manifest,
  store: createGroundSupabaseStore({
    secretKey: process.env.SUPABASE_SECRET_KEY,
    supabaseUrl: process.env.SUPABASE_URL,
  }),
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
  const document = hydrateGroundYDoc(hydrated);
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
  assert.equal(hydrateGroundYDoc(hydrated).ytext.toString().includes('$100K'), true);
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
