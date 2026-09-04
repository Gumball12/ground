import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEST_MAX_DOCUMENT_BYTES,
  createAdminClient,
  createAnonymousClient,
  createDocumentAsAdmin,
  encodeUpdate,
  readParticipantsAsAdmin,
  uniqueDocumentId,
} from './ground-supabase-fixture.js';

const joinDocumentAsAdmin = async ({ documentId, userId, displayName, now = new Date().toISOString() }) => {
  const { data, error } = await createAdminClient().rpc('ground_join_document', {
    p_display_name: displayName,
    p_document_id: documentId,
    p_max_document_bytes: TEST_MAX_DOCUMENT_BYTES,
    p_now: now,
    p_user_id: userId,
  });
  if (error) {
    throw error;
  }
  return data;
};

const readOwnParticipant = async (client, documentId) => {
  const { data, error } = await client
    .from('ground_participants')
    .select('access_state, role_id, role_version, display_name')
    .eq('document_id', documentId);
  assert.equal(error, null);
  return data;
};

test('concurrent creation leaves exactly one Owner', async () => {
  const first = await createAnonymousClient();
  const second = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  const attempts = await Promise.all([
    createDocumentAsAdmin({ actorId: first.userId, documentId }),
    createDocumentAsAdmin({ actorId: second.userId, documentId }),
  ].map((promise) => promise.then(() => 'created', () => 'rejected')));
  assert.deepEqual(attempts.toSorted(), ['created', 'rejected']);
  assert.deepEqual(await readParticipantsAsAdmin(documentId), [{
    access_state: 'active', role_id: 'owner', role_version: 1,
  }]);
});

test('direct document insertion without an Owner is rejected at commit', async () => {
  const documentId = uniqueDocumentId();
  const now = new Date().toISOString();

  const { error } = await createAdminClient()
    .from('ground_documents')
    .insert({
      created_at: now,
      id: documentId,
      last_mutation_at: now,
      recovery_token_hash: encodeUpdate(Buffer.alloc(32)),
      snapshot: encodeUpdate(Buffer.alloc(0)),
    });

  assert.equal(error?.code, '23514');
});

test('direct removal or revocation of the sole Owner is rejected at commit', async () => {
  const owner = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });

  const { error: revokeError } = await createAdminClient()
    .from('ground_participants')
    .update({ access_state: 'revoked', role_id: null })
    .eq('document_id', documentId)
    .eq('user_id', owner.userId);
  assert.equal(revokeError?.code, '23514');

  const { error: removeError } = await createAdminClient()
    .from('ground_participants')
    .delete()
    .eq('document_id', documentId)
    .eq('user_id', owner.userId);
  assert.equal(removeError?.code, '23514');
});

test('deleting a document cascades participants without violating the Owner invariant', async () => {
  const owner = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });

  const { error } = await createAdminClient()
    .from('ground_documents')
    .delete()
    .eq('id', documentId);

  assert.equal(error, null);
  assert.deepEqual(await readParticipantsAsAdmin(documentId), []);
});

test('join keeps a later visitor Pending and hides the document', async () => {
  const owner = await createAnonymousClient();
  const visitor = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });

  const result = await joinDocumentAsAdmin({
    displayName: '  Pending visitor  ',
    documentId,
    userId: visitor.userId,
  });

  assert.deepEqual(result, [{
    access_state: 'pending',
    role_id: null,
    role_version: 1,
  }]);
  assert.deepEqual(await readOwnParticipant(visitor.client, documentId), [{
    access_state: 'pending',
    role_id: null,
    role_version: 1,
    display_name: 'Pending visitor',
  }]);

  const { data: hiddenDocuments, error: documentError } = await visitor.client
    .from('ground_documents')
    .select('id')
    .eq('id', documentId);
  assert.equal(documentError, null);
  assert.deepEqual(hiddenDocuments, []);

  const { data: ownerList, error: ownerListError } = await owner.client
    .from('ground_participants')
    .select('user_id')
    .eq('document_id', documentId);
  assert.equal(ownerListError, null);
  assert.equal(ownerList.length, 2);

  const { data: visitorList, error: visitorListError } = await visitor.client
    .from('ground_participants')
    .select('user_id')
    .eq('document_id', documentId);
  assert.equal(visitorListError, null);
  assert.deepEqual(visitorList, [{ user_id: visitor.userId }]);

  const { error: directMutationError } = await visitor.client
    .from('ground_participants')
    .update({ display_name: 'Bypassed' })
    .eq('document_id', documentId);
  assert.equal(directMutationError?.code, '42501');

  const { error: browserRpcError } = await visitor.client.rpc('ground_join_document', {
    p_display_name: 'Bypassed',
    p_document_id: documentId,
    p_max_document_bytes: TEST_MAX_DOCUMENT_BYTES,
    p_now: new Date().toISOString(),
    p_user_id: visitor.userId,
  });
  assert.equal(browserRpcError?.code, '42501');

  const { error: browserCreateError } = await visitor.client.rpc('ground_create_document', {
    p_display_name: 'Bypassed',
    p_document_id: uniqueDocumentId(),
    p_initial_snapshot: encodeUpdate(Buffer.alloc(0)),
    p_now: new Date().toISOString(),
    p_owner_id: visitor.userId,
    p_recovery_token_hash: encodeUpdate(Buffer.alloc(32)),
  });
  assert.equal(browserCreateError?.code, '42501');
});

test('Active participant cannot select another document', async () => {
  const firstOwner = await createAnonymousClient();
  const secondOwner = await createAnonymousClient();
  const firstDocumentId = uniqueDocumentId();
  const secondDocumentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: firstOwner.userId, documentId: firstDocumentId });
  await createDocumentAsAdmin({ actorId: secondOwner.userId, documentId: secondDocumentId });

  const { data, error } = await firstOwner.client
    .from('ground_documents')
    .select('id')
    .in('id', [firstDocumentId, secondDocumentId]);

  assert.equal(error, null);
  assert.deepEqual(data, [{ id: firstDocumentId }]);
});

test('join preserves a Revoked participant state and role version', async () => {
  const owner = await createAnonymousClient();
  const visitor = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });
  await joinDocumentAsAdmin({
    displayName: 'Former visitor',
    documentId,
    userId: visitor.userId,
  });

  const { error: revokeError } = await createAdminClient()
    .from('ground_participants')
    .update({ access_state: 'revoked', role_id: null, role_version: 7 })
    .eq('document_id', documentId)
    .eq('user_id', visitor.userId);
  assert.equal(revokeError, null);

  const result = await joinDocumentAsAdmin({
    displayName: '  Renamed visitor  ',
    documentId,
    userId: visitor.userId,
  });

  assert.deepEqual(result, [{
    access_state: 'revoked',
    role_id: null,
    role_version: 7,
  }]);
  assert.deepEqual(await readOwnParticipant(visitor.client, documentId), [{
    access_state: 'revoked',
    role_id: null,
    role_version: 7,
    display_name: 'Renamed visitor',
  }]);
});

test('join preserves an Active Owner state, role, and version', async () => {
  const owner = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });

  const { error: versionError } = await createAdminClient()
    .from('ground_participants')
    .update({ role_version: 9 })
    .eq('document_id', documentId)
    .eq('user_id', owner.userId);
  assert.equal(versionError, null);

  const result = await joinDocumentAsAdmin({
    displayName: '  Renamed owner  ',
    documentId,
    userId: owner.userId,
  });

  assert.deepEqual(result, [{
    access_state: 'active',
    role_id: 'owner',
    role_version: 9,
  }]);
  assert.deepEqual(await readParticipantsAsAdmin(documentId), [{
    access_state: 'active',
    role_id: 'owner',
    role_version: 9,
  }]);
});
