import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
  TEST_MAX_DOCUMENT_BYTES,
  TEST_MAX_UPDATE_BYTES,
  commitRawUpdate,
  commitRawUpdateExpectingHead,
  createAdminClient,
  createAnonymousClient,
  createDocumentAsAdmin,
  createPendingScenario,
  decodeUpdate,
  encodeUpdate,
  readDocumentHead,
  readUpdateRows,
  uniqueDocumentId,
} from './ground-supabase-fixture.js';

const createActiveOwnerScenario = async () => {
  const owner = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });
  return {
    documentId,
    editor: owner,
    editorRoleVersion: 1,
  };
};

const createTextUpdates = (...values) => {
  const document = new Y.Doc();
  const text = document.getText('content');
  return values.map((value) => {
    const stateVector = Y.encodeStateVector(document);
    text.insert(text.length, value);
    return Y.encodeStateAsUpdate(document, stateVector);
  });
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

const waitForDeniedSubscription = (channel) => new Promise((resolve, reject) => {
  channel.subscribe((status, error) => {
    if (status === 'CHANNEL_ERROR') {
      resolve(status);
    } else if (status === 'SUBSCRIBED' || status === 'TIMED_OUT') {
      reject(Object.assign(new Error(`Expected CHANNEL_ERROR, received ${status}.`, { cause: error }), {
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

test('commits monotonically ordered updates for the same document', async () => {
  const scenario = await createActiveOwnerScenario();
  const [firstUpdate, secondUpdate] = createTextUpdates('A', 'B');

  const first = await commitRawUpdate(scenario, firstUpdate);
  const second = await commitRawUpdate(scenario, secondUpdate);

  assert.equal(second.sequence, first.sequence + 1);
  assert.equal((await readUpdateRows(scenario.documentId)).length, 2);
});

test('rejects a previous role_version without allocating an update sequence', async () => {
  const scenario = await createActiveOwnerScenario();
  const before = await readDocumentHead(scenario.documentId);
  const { error } = await createAdminClient()
    .from('ground_participants')
    .update({ role_version: scenario.editorRoleVersion + 1 })
    .eq('document_id', scenario.documentId)
    .eq('user_id', scenario.editor.userId);
  assert.equal(error, null);

  await assert.rejects(
    commitRawUpdate(scenario, createTextUpdates('stale')[0]),
    /GROUND_STALE_STATE/u,
  );

  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
  assert.deepEqual(await readUpdateRows(scenario.documentId), []);
});

// A server-composed edit names the head it was composed against. Another commit
// that moved the head since would make the composition describe a document
// that no longer exists, so the commit is refused and nothing is allocated.
test('rejects a commit naming a stale head without allocating a sequence', async () => {
  const scenario = await createActiveOwnerScenario();
  const [first, second, third] = createTextUpdates('A', 'B', 'C');
  const { sequence } = await commitRawUpdate(scenario, first);
  const before = await readDocumentHead(scenario.documentId);

  await assert.rejects(
    commitRawUpdateExpectingHead(scenario, second, sequence - 1),
    /GROUND_STALE_STATE/u,
  );
  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
  assert.equal((await readUpdateRows(scenario.documentId)).length, 1);

  const committed = await commitRawUpdateExpectingHead(scenario, third, sequence);
  assert.equal(committed.sequence, sequence + 1);
});

test('a newly created Pending participant appends one join Activity only once', async () => {
  const owner = await createAnonymousClient();
  const visitor = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  const [activityUpdate] = createTextUpdates('joined');
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });
  const admin = createAdminClient();
  const join = (userId, displayName) => admin.rpc('ground_join_document', {
    p_activity_update: encodeUpdate(activityUpdate),
    p_display_name: displayName,
    p_document_id: documentId,
    p_max_document_bytes: TEST_MAX_DOCUMENT_BYTES,
    p_now: new Date().toISOString(),
    p_user_id: userId,
  });

  assert.equal((await join(owner.userId, 'Owner')).error, null);
  assert.equal((await join(visitor.userId, 'Visitor')).error, null);
  const { error: revokeError } = await admin
    .from('ground_participants')
    .update({ access_state: 'revoked', role_id: null, role_version: 2 })
    .eq('document_id', documentId)
    .eq('user_id', visitor.userId);
  assert.equal(revokeError, null);
  assert.equal((await join(visitor.userId, 'Former visitor')).error, null);

  const rows = await readUpdateRows(documentId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sequence, 1);
  assert.deepEqual(decodeUpdate(rows[0].update_payload), activityUpdate);
});

test('browser roles cannot mutate the update table or commit RPC', async () => {
  const scenario = await createActiveOwnerScenario();
  const [update] = createTextUpdates('blocked');
  const { error: tableError } = await scenario.editor.client
    .from('ground_yjs_updates')
    .insert({
      actor_id: scenario.editor.userId,
      created_at: new Date().toISOString(),
      document_id: scenario.documentId,
      operation_kind: 'document_edit',
      sequence: 1,
      source: 'document_editor',
      update_payload: encodeUpdate(update),
    });
  assert.equal(tableError?.code, '42501');

  const { error: rpcError } = await scenario.editor.client.rpc('ground_commit_update', {
    p_actor_id: scenario.editor.userId,
    p_document_id: scenario.documentId,
    p_expected_role_version: scenario.editorRoleVersion,
    p_max_document_bytes: TEST_MAX_DOCUMENT_BYTES,
    p_max_update_bytes: TEST_MAX_UPDATE_BYTES,
    p_now: new Date().toISOString(),
    p_operation_kind: 'document_edit',
    p_source: 'document_editor',
    p_update: encodeUpdate(update),
  });
  assert.equal(rpcError?.code, '42501');
  assert.deepEqual(await readUpdateRows(scenario.documentId), []);
});

test('sends a private sequence notice without Yjs payload bytes', async (t) => {
  const scenario = await createActiveOwnerScenario();
  const { client, session } = scenario.editor;
  t.after(() => disconnect(client));
  await client.realtime.setAuth(session.access_token);
  const channel = client.channel(`ground-document:${scenario.documentId}`, {
    config: { private: true, presence: { key: scenario.editor.userId } },
  });
  const noticePromise = receiveNextBroadcast(channel, 'update');

  await subscribe(channel);
  assert.equal(await channel.track({ displayName: 'Owner' }), 'ok');
  await waitForLocalBroadcastReplication();
  const committed = await commitRawUpdate(scenario, createTextUpdates('notice')[0]);
  const notice = await noticePromise;

  assert.equal(notice.payload.sequence, committed.sequence);
  assert.deepEqual(Object.keys(notice.payload).sort(), ['id', 'sequence']);
  assert.equal('content' in notice.payload, false);
  assert.equal('update' in notice.payload, false);
  assert.equal('update_payload' in notice.payload, false);
  assert.equal('yjs' in notice.payload, false);
});

test('Pending and unrelated clients receive CHANNEL_ERROR for document Realtime', async (t) => {
  const scenario = await createPendingScenario();
  const unrelated = await createAnonymousClient();
  t.after(() => disconnect(scenario.pending.client, unrelated.client));
  await Promise.all([
    scenario.pending.client.realtime.setAuth(scenario.pending.session.access_token),
    unrelated.client.realtime.setAuth(unrelated.session.access_token),
  ]);
  const pendingChannel = scenario.pending.client.channel(`ground-document:${scenario.documentId}`, {
    config: { private: true },
  });
  const unrelatedChannel = unrelated.client.channel(`ground-document:${scenario.documentId}`, {
    config: { private: true },
  });

  assert.deepEqual(await Promise.all([
    waitForDeniedSubscription(pendingChannel),
    waitForDeniedSubscription(unrelatedChannel),
  ]), ['CHANNEL_ERROR', 'CHANNEL_ERROR']);
});

test('reconnect applies persisted rows in sequence order to recover document text', async () => {
  const scenario = await createActiveOwnerScenario();
  const [firstUpdate, secondUpdate] = createTextUpdates('A', 'B');
  await commitRawUpdate(scenario, firstUpdate);
  await commitRawUpdate(scenario, secondUpdate);

  const { data: rows, error } = await scenario.editor.client
    .from('ground_yjs_updates')
    .select('sequence, update_payload')
    .eq('document_id', scenario.documentId)
    .order('sequence');
  assert.equal(error, null);
  assert.deepEqual(rows.map(({ sequence }) => sequence), [1, 2]);

  const reconnectedDocument = new Y.Doc();
  rows.forEach(({ update_payload: update }) => {
    Y.applyUpdate(reconnectedDocument, decodeUpdate(update));
  });
  assert.equal(reconnectedDocument.getText('content').toString(), 'AB');
});

test('a user can subscribe only to their own private access topic', async (t) => {
  const first = await createAnonymousClient();
  const second = await createAnonymousClient();
  t.after(() => disconnect(first.client, second.client));
  await Promise.all([
    first.client.realtime.setAuth(first.session.access_token),
    second.client.realtime.setAuth(second.session.access_token),
  ]);
  const ownChannel = first.client.channel(`ground-access:${first.userId}`, {
    config: { private: true },
  });
  const otherChannel = second.client.channel(`ground-access:${first.userId}`, {
    config: { private: true },
  });

  assert.equal(await subscribe(ownChannel), 'SUBSCRIBED');
  assert.equal(await waitForDeniedSubscription(otherChannel), 'CHANNEL_ERROR');
});
