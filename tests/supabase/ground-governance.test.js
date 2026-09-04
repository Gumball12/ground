import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import * as Y from 'yjs';
import {
  assignRoleAsAdmin,
  callAdminRpc,
  createAdminClient,
  createAnonymousClient,
  createDocumentAsAdmin,
  createPendingScenario,
  decodeUpdate,
  encodeUpdate,
  readDocumentHead,
  readParticipantsAsAdmin,
  readUpdateRows,
  uniqueDocumentId,
} from './ground-supabase-fixture.js';

const JOIN_ACTIVITY_SEQUENCE = 1;

const createActivityUpdate = (value) => {
  const document = new Y.Doc();
  document.getText('activity').insert(0, value);
  return Y.encodeStateAsUpdate(document);
};

const createRecoveryToken = () => {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: createHash('sha256').update(token, 'utf8').digest() };
};

const revokeParticipantAsAdmin = (input) => callAdminRpc('ground_revoke_participant', {
  p_activity_update: encodeUpdate(input.activityUpdate ?? createActivityUpdate('revoked')),
  p_document_id: input.documentId,
  p_expected_owner_version: input.expectedOwnerVersion,
  p_now: input.now ?? new Date().toISOString(),
  p_owner_id: input.actorId,
  p_target_user_id: input.targetUserId,
});

const recoverOwnerAsAdmin = (input) => callAdminRpc('ground_recover_owner', {
  p_activity_update: encodeUpdate(input.activityUpdate ?? createActivityUpdate('recovered')),
  p_actor_id: input.actorId,
  p_display_name: input.displayName ?? 'Recovered owner',
  p_document_id: input.documentId,
  p_next_token_hash: encodeUpdate(input.nextTokenHash),
  p_now: input.now ?? new Date().toISOString(),
  p_token_hash: encodeUpdate(input.tokenHash),
});

const createRecoverableDocument = async () => {
  const owner = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  const current = createRecoveryToken();
  await createDocumentAsAdmin({
    actorId: owner.userId,
    documentId,
    recoveryTokenHash: current.tokenHash,
  });
  return { documentId, owner, tokenHash: current.tokenHash };
};

const readParticipantAsAdmin = async (documentId, userId) => {
  const { data, error } = await createAdminClient()
    .from('ground_participants')
    .select('access_state, role_id, role_version')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle();
  assert.equal(error, null);
  return data;
};

const subscribe = (channel) => new Promise((resolve, reject) => {
  channel.subscribe((status, error) => {
    if (status === 'SUBSCRIBED') {
      resolve(status);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      reject(Object.assign(new Error(`Realtime subscription failed with ${status}.`, { cause: error }), {
        status,
      }));
    }
  });
});

const receiveNextBroadcast = (channel, event) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error(`Timed out waiting for ${event} broadcast.`));
  }, 10_000);
  channel.on('broadcast', { event }, (payload) => {
    clearTimeout(timeout);
    resolve(payload);
  });
});

const disconnect = async (...clients) => {
  await Promise.all(clients.map((client) => client.removeAllChannels()));
  clients.forEach((client) => client.realtime.disconnect());
};

// `supabase db reset` restarts Realtime; channel authorization can complete before
// the local Broadcast-from-Database replication slot has finished reconnecting.
const waitForLocalBroadcastReplication = () => new Promise((resolve) => {
  setTimeout(resolve, 1_000);
});

test('Owner assigns a manifest Role and increments target role_version', async () => {
  const { documentId, owner, pending } = await createPendingScenario();
  const activityUpdate = createActivityUpdate('assigned');

  const result = await assignRoleAsAdmin({
    activityUpdate,
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: pending.userId,
  });

  assert.equal(result.participant.access_state, 'active');
  assert.equal(result.participant.role_id, 'editor');
  assert.equal(result.participant.role_version, 2);
  assert.equal(result.sequence, JOIN_ACTIVITY_SEQUENCE + 1);
  const rows = await readUpdateRows(documentId);
  assert.equal(rows.length, 2);
  assert.deepEqual(decodeUpdate(rows[1].update_payload), activityUpdate);
});

test('Owner revokes a participant and clears the assigned Role', async () => {
  const { documentId, owner, pending } = await createPendingScenario();
  await assignRoleAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: pending.userId,
  });

  const result = await revokeParticipantAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    targetUserId: pending.userId,
  });

  assert.equal(result.participant.access_state, 'revoked');
  assert.equal(result.participant.role_id, null);
  assert.equal(result.participant.role_version, 3);
  assert.equal(result.sequence, JOIN_ACTIVITY_SEQUENCE + 2);
});

test('a stale Owner version leaves the participant and Activity log unchanged', async () => {
  const { documentId, owner, pending } = await createPendingScenario();
  const headBefore = await readDocumentHead(documentId);

  await assert.rejects(assignRoleAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 2,
    roleId: 'editor',
    targetUserId: pending.userId,
  }), /GROUND_STALE_STATE/u);

  assert.deepEqual(await readParticipantAsAdmin(documentId, pending.userId), {
    access_state: 'pending',
    role_id: null,
    role_version: 1,
  });
  assert.deepEqual(await readDocumentHead(documentId), headBefore);
  assert.equal((await readUpdateRows(documentId)).length, 1);
});

test('assigning a Role to the Owner returns GROUND_OWNER_IMMUTABLE', async () => {
  const { documentId, owner } = await createPendingScenario();

  await assert.rejects(assignRoleAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: owner.userId,
  }), /GROUND_OWNER_IMMUTABLE/u);

  assert.deepEqual(await readParticipantAsAdmin(documentId, owner.userId), {
    access_state: 'active',
    role_id: 'owner',
    role_version: 1,
  });
});

test('revoking the Owner returns GROUND_OWNER_IMMUTABLE', async () => {
  const { documentId, owner } = await createPendingScenario();

  await assert.rejects(revokeParticipantAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    targetUserId: owner.userId,
  }), /GROUND_OWNER_IMMUTABLE/u);

  assert.deepEqual(await readParticipantAsAdmin(documentId, owner.userId), {
    access_state: 'active',
    role_id: 'owner',
    role_version: 1,
  });
});

test('an invalid Activity payload rolls back the Role and Activity together', async () => {
  const { documentId, owner, pending } = await createPendingScenario();
  const headBefore = await readDocumentHead(documentId);

  await assert.rejects(callAdminRpc('ground_assign_role', {
    p_activity_update: null,
    p_document_id: documentId,
    p_expected_owner_version: 1,
    p_now: new Date().toISOString(),
    p_owner_id: owner.userId,
    p_role_id: 'editor',
    p_target_user_id: pending.userId,
  }), (error) => error.code === '23502');

  assert.deepEqual(await readParticipantAsAdmin(documentId, pending.userId), {
    access_state: 'pending',
    role_id: null,
    role_version: 1,
  });
  assert.deepEqual(await readDocumentHead(documentId), headBefore);
  assert.equal((await readUpdateRows(documentId)).length, 1);
});

test('recovery makes the actor the sole Active Owner and Revokes the prior Owner', async () => {
  const { documentId, owner, tokenHash } = await createRecoverableDocument();
  const claimant = await createAnonymousClient();
  const next = createRecoveryToken();

  const result = await recoverOwnerAsAdmin({
    actorId: claimant.userId,
    documentId,
    nextTokenHash: next.tokenHash,
    tokenHash,
  });

  assert.equal(result.sequence, 1);
  assert.deepEqual(await readParticipantAsAdmin(documentId, claimant.userId), {
    access_state: 'active',
    role_id: 'owner',
    role_version: 1,
  });
  assert.deepEqual(await readParticipantAsAdmin(documentId, owner.userId), {
    access_state: 'revoked',
    role_id: null,
    role_version: 2,
  });
  const activeOwners = (await readParticipantsAsAdmin(documentId))
    .filter((row) => row.access_state === 'active' && row.role_id === 'owner');
  assert.equal(activeOwners.length, 1);
});

test('recovery from the existing Owner session keeps that Owner and rotates the token', async () => {
  const { documentId, owner, tokenHash } = await createRecoverableDocument();
  const next = createRecoveryToken();
  const afterNext = createRecoveryToken();

  await recoverOwnerAsAdmin({
    actorId: owner.userId,
    documentId,
    nextTokenHash: next.tokenHash,
    tokenHash,
  });

  assert.deepEqual(await readParticipantAsAdmin(documentId, owner.userId), {
    access_state: 'active',
    role_id: 'owner',
    role_version: 2,
  });
  const second = await recoverOwnerAsAdmin({
    actorId: owner.userId,
    documentId,
    nextTokenHash: afterNext.tokenHash,
    tokenHash: next.tokenHash,
  });
  assert.equal(second.sequence, 2);
});

test('a used recovery token returns GROUND_UNAVAILABLE', async () => {
  const { documentId, tokenHash } = await createRecoverableDocument();
  const claimant = await createAnonymousClient();
  const next = createRecoveryToken();
  await recoverOwnerAsAdmin({
    actorId: claimant.userId,
    documentId,
    nextTokenHash: next.tokenHash,
    tokenHash,
  });
  const headAfterRecovery = await readDocumentHead(documentId);

  await assert.rejects(recoverOwnerAsAdmin({
    actorId: claimant.userId,
    documentId,
    nextTokenHash: createRecoveryToken().tokenHash,
    tokenHash,
  }), /GROUND_UNAVAILABLE/u);

  assert.deepEqual(await readDocumentHead(documentId), headAfterRecovery);
});

test('browser roles cannot execute the Owner governance RPCs', async () => {
  const { documentId, owner, pending } = await createPendingScenario();
  const now = new Date().toISOString();
  const activityUpdate = encodeUpdate(createActivityUpdate('blocked'));

  const assign = await owner.client.rpc('ground_assign_role', {
    p_activity_update: activityUpdate,
    p_document_id: documentId,
    p_expected_owner_version: 1,
    p_now: now,
    p_owner_id: owner.userId,
    p_role_id: 'editor',
    p_target_user_id: pending.userId,
  });
  const revoke = await owner.client.rpc('ground_revoke_participant', {
    p_activity_update: activityUpdate,
    p_document_id: documentId,
    p_expected_owner_version: 1,
    p_now: now,
    p_owner_id: owner.userId,
    p_target_user_id: pending.userId,
  });
  const recover = await pending.client.rpc('ground_recover_owner', {
    p_activity_update: activityUpdate,
    p_actor_id: pending.userId,
    p_display_name: 'Claimant',
    p_document_id: documentId,
    p_next_token_hash: encodeUpdate(createRecoveryToken().tokenHash),
    p_now: now,
    p_token_hash: encodeUpdate(createRecoveryToken().tokenHash),
  });

  assert.deepEqual(
    [assign.error?.code, revoke.error?.code, recover.error?.code],
    ['42501', '42501', '42501'],
  );
  assert.deepEqual(await readParticipantAsAdmin(documentId, pending.userId), {
    access_state: 'pending',
    role_id: null,
    role_version: 1,
  });
});

test('Owner access changes notify only the affected participant privately', async (t) => {
  const { documentId, owner, pending } = await createPendingScenario();
  t.after(() => disconnect(pending.client, owner.client));
  await Promise.all([
    pending.client.realtime.setAuth(pending.session.access_token),
    owner.client.realtime.setAuth(owner.session.access_token),
  ]);
  const pendingChannel = pending.client.channel(`ground-access:${pending.userId}`, {
    config: { private: true },
  });
  const ownerChannel = owner.client.channel(`ground-access:${owner.userId}`, {
    config: { private: true },
  });
  const noticePromise = receiveNextBroadcast(pendingChannel, 'access');
  let ownerNotice;
  ownerChannel.on('broadcast', { event: 'access' }, (payload) => {
    ownerNotice = payload;
  });

  await Promise.all([subscribe(pendingChannel), subscribe(ownerChannel)]);
  await waitForLocalBroadcastReplication();
  await assignRoleAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: pending.userId,
  });
  const notice = await noticePromise;

  assert.deepEqual(Object.keys(notice.payload).sort(), [
    'accessState',
    'documentId',
    'id',
    'roleId',
    'roleVersion',
  ]);
  assert.equal(notice.payload.documentId, documentId);
  assert.equal(notice.payload.accessState, 'active');
  assert.equal(notice.payload.roleId, 'editor');
  assert.equal(notice.payload.roleVersion, 2);
  assert.equal(ownerNotice, undefined);
});
