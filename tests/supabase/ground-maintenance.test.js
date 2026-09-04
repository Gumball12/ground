import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import * as Y from 'yjs';
import {
  TEST_MAX_DOCUMENT_BYTES,
  TEST_MAX_UPDATE_BYTES,
  callAdminRpc,
  commitRawUpdate,
  createActiveEditorScenario,
  createAdminClient,
  createAnonymousClient,
  createDocumentAsAdmin,
  decodeUpdate,
  encodeUpdate,
  readDocumentHead,
  readParticipantsAsAdmin,
  readUpdateRows,
  uniqueDocumentId,
} from './ground-supabase-fixture.js';

const EXPIRED_AT = '2026-01-01T00:00:00.000Z';
const RETENTION_CUTOFF = '2026-02-01T00:00:00.000Z';
const RECENT_AT = '2026-03-01T00:00:00.000Z';

const takeRateLimit = (input) => callAdminRpc('ground_take_rate_limit', {
  p_key_hash: encodeUpdate(input.keyHash),
  p_limit: input.limit,
  p_now: input.now,
  p_scope: input.scope,
  p_window_seconds: input.windowSeconds,
});

const deleteExpiredDocuments = (cutoff) => callAdminRpc('ground_delete_expired_documents', {
  p_cutoff: cutoff,
});

const joinDocumentAsAdmin = (input) => callAdminRpc('ground_join_document', {
  p_activity_update: encodeUpdate(input.activityUpdate ?? Buffer.alloc(0)),
  p_display_name: input.displayName,
  p_document_id: input.documentId,
  p_max_document_bytes: input.maxDocumentBytes,
  p_now: input.now,
  p_user_id: input.userId,
});

const findDocument = async (documentId) => {
  const { data, error } = await createAdminClient()
    .from('ground_documents')
    .select('id')
    .eq('id', documentId)
    .maybeSingle();
  assert.equal(error, null);
  return data;
};

const compactDocumentAsAdmin = (input) => callAdminRpc('ground_compact_document', {
  p_candidate_sequence: input.candidateSequence,
  p_document_id: input.documentId,
  p_snapshot: encodeUpdate(input.snapshot),
});

const createTextUpdates = (...values) => {
  const document = new Y.Doc();
  const text = document.getText('content');
  return values.map((value) => {
    const stateVector = Y.encodeStateVector(document);
    text.insert(text.length, value);
    return Y.encodeStateAsUpdate(document, stateVector);
  });
};

const readDocumentRecord = async (documentId) => {
  const { data, error } = await createAdminClient()
    .from('ground_documents')
    .select('head_sequence, snapshot_sequence, snapshot, last_mutation_at')
    .eq('id', documentId)
    .single();
  assert.equal(error, null);
  return data;
};

const commitTextUpdates = async (scenario, ...values) => {
  const updates = createTextUpdates(...values);
  for (const update of updates) {
    await commitRawUpdate(scenario, update);
  }
  return updates;
};

test('rejects an update above the injected byte limit without allocating a sequence', async () => {
  const scenario = await createActiveEditorScenario();
  const before = await readDocumentHead(scenario.documentId);
  const rowsBefore = await readUpdateRows(scenario.documentId);

  await assert.rejects(
    commitRawUpdate(scenario, Buffer.alloc(TEST_MAX_UPDATE_BYTES + 1)),
    { code: 'GROUND_UPDATE_TOO_LARGE' },
  );

  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
  assert.deepEqual(await readUpdateRows(scenario.documentId), rowsBefore);
});

// Stored bytes are what a reader replays, so the boundary counts the snapshot,
// every retained log row, and the arriving update as one document.
test('rejects an edit whose resulting document crosses the document byte limit', async () => {
  const scenario = await createActiveEditorScenario();
  await commitTextUpdates(scenario, 'A');
  const before = await readDocumentHead(scenario.documentId);
  const rowsBefore = await readUpdateRows(scenario.documentId);

  await assert.rejects(
    commitRawUpdate(
      scenario,
      Buffer.alloc(TEST_MAX_UPDATE_BYTES),
      TEST_MAX_UPDATE_BYTES,
      RECENT_AT,
      TEST_MAX_UPDATE_BYTES,
    ),
    { code: 'GROUND_UPDATE_TOO_LARGE' },
  );

  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
  assert.deepEqual(await readUpdateRows(scenario.documentId), rowsBefore);
});

test('rejects an edit when no document byte limit is injected', async () => {
  const scenario = await createActiveEditorScenario();
  const before = await readDocumentHead(scenario.documentId);

  await assert.rejects(
    commitRawUpdate(
      scenario,
      createTextUpdates('A')[0],
      TEST_MAX_UPDATE_BYTES,
      RECENT_AT,
      null,
    ),
    { code: 'GROUND_INVALID_REQUEST' },
  );

  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
});

test('rejects an update when no byte limit is injected', async () => {
  const scenario = await createActiveEditorScenario();
  const before = await readDocumentHead(scenario.documentId);

  await assert.rejects(
    commitRawUpdate(scenario, createTextUpdates('A')[0], null),
    { code: 'GROUND_INVALID_REQUEST' },
  );

  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
});

test('compacts rows through the candidate sequence and keeps later rows', async () => {
  const scenario = await createActiveEditorScenario();
  await commitTextUpdates(scenario, 'A', 'B', 'C');
  const before = await readDocumentRecord(scenario.documentId);
  const candidateSequence = before.head_sequence - 1;
  const snapshot = Buffer.from('compacted snapshot');

  await compactDocumentAsAdmin({
    candidateSequence,
    documentId: scenario.documentId,
    snapshot,
  });

  const after = await readDocumentRecord(scenario.documentId);
  assert.equal(after.snapshot_sequence, candidateSequence);
  assert.deepEqual(decodeUpdate(after.snapshot), new Uint8Array(snapshot));
  assert.equal(after.head_sequence, before.head_sequence);
  assert.equal(after.last_mutation_at, before.last_mutation_at);
  assert.deepEqual(
    (await readUpdateRows(scenario.documentId)).map(({ sequence }) => sequence),
    [before.head_sequence],
  );
});

test('a compaction candidate above head_sequence changes neither snapshot nor log', async () => {
  const scenario = await createActiveEditorScenario();
  await commitTextUpdates(scenario, 'A');
  const before = await readDocumentRecord(scenario.documentId);
  const rowsBefore = await readUpdateRows(scenario.documentId);

  await assert.rejects(compactDocumentAsAdmin({
    candidateSequence: before.head_sequence + 1,
    documentId: scenario.documentId,
    snapshot: Buffer.from('unused'),
  }), { code: 'GROUND_STALE_STATE' });

  assert.deepEqual(await readDocumentRecord(scenario.documentId), before);
  assert.deepEqual(await readUpdateRows(scenario.documentId), rowsBefore);
});

test('compaction bounded by the captured candidate keeps a newer committed row', async () => {
  const scenario = await createActiveEditorScenario();
  await commitTextUpdates(scenario, 'A', 'B');
  const capturedCandidate = (await readDocumentHead(scenario.documentId)).head_sequence;
  await commitTextUpdates(scenario, 'C');

  await compactDocumentAsAdmin({
    candidateSequence: capturedCandidate,
    documentId: scenario.documentId,
    snapshot: Buffer.from('captured snapshot'),
  });

  const after = await readDocumentRecord(scenario.documentId);
  assert.equal(after.snapshot_sequence, capturedCandidate);
  assert.equal(after.head_sequence, capturedCandidate + 1);
  assert.deepEqual(
    (await readUpdateRows(scenario.documentId)).map(({ sequence }) => sequence),
    [capturedCandidate + 1],
  );
});

// Two hydrations can fold the same document from different heads. Once the
// newer fold has committed, the older candidate's snapshot no longer covers the
// rows the newer fold deleted, so accepting it would drop those rows for good.
test('a compaction candidate at or below the stored snapshot changes neither snapshot nor log', async () => {
  const scenario = await createActiveEditorScenario();
  await commitTextUpdates(scenario, 'A', 'B', 'C');
  const newerHead = (await readDocumentHead(scenario.documentId)).head_sequence;
  await compactDocumentAsAdmin({
    candidateSequence: newerHead,
    documentId: scenario.documentId,
    snapshot: Buffer.from('newer snapshot'),
  });
  const before = await readDocumentRecord(scenario.documentId);
  const rowsBefore = await readUpdateRows(scenario.documentId);

  for (const candidateSequence of [newerHead - 1, newerHead]) {
    await assert.rejects(compactDocumentAsAdmin({
      candidateSequence,
      documentId: scenario.documentId,
      snapshot: Buffer.from('older snapshot'),
    }), { code: 'GROUND_STALE_STATE' });
  }

  assert.deepEqual(await readDocumentRecord(scenario.documentId), before);
  assert.deepEqual(await readUpdateRows(scenario.documentId), rowsBefore);
});

// A join appends its Activity to the shared document, so the document it
// produces is bounded like any other update. Anonymous identities are free to
// create, so without this ceiling an unbounded number of first joins could grow
// a document past the size its readers replay.
test('a first join is refused when its Activity would cross the document byte limit', async () => {
  const owner = await createAnonymousClient();
  const visitor = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  const snapshot = Buffer.from('seed snapshot');
  const activityUpdate = Buffer.from('join activity');
  await createDocumentAsAdmin({ actorId: owner.userId, documentId, snapshot });
  const before = await readDocumentRecord(documentId);
  const join = (maxDocumentBytes) => joinDocumentAsAdmin({
    activityUpdate,
    displayName: 'Visitor',
    documentId,
    maxDocumentBytes,
    now: RECENT_AT,
    userId: visitor.userId,
  });

  await assert.rejects(
    join(snapshot.length + activityUpdate.length - 1),
    { code: 'GROUND_UPDATE_TOO_LARGE' },
  );
  assert.deepEqual(await readDocumentRecord(documentId), before);
  assert.equal((await readParticipantsAsAdmin(documentId)).length, 1);

  const [joined] = await join(snapshot.length + activityUpdate.length);
  assert.equal(joined.access_state, 'pending');
  assert.equal((await readDocumentHead(documentId)).head_sequence, before.head_sequence + 1);
});

test('a join refuses a missing document byte limit', async () => {
  const owner = await createAnonymousClient();
  const visitor = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });

  await assert.rejects(joinDocumentAsAdmin({
    displayName: 'Visitor',
    documentId,
    maxDocumentBytes: null,
    now: RECENT_AT,
    userId: visitor.userId,
  }), { code: 'GROUND_INVALID_REQUEST' });
  assert.equal((await readParticipantsAsAdmin(documentId)).length, 1);
});

test('rate limiting increments one fixed window atomically and denies only after its limit', async () => {
  const keyHash = randomBytes(32);

  const results = await Promise.all([1, 2, 3].map(() => takeRateLimit({
    keyHash,
    limit: 2,
    now: EXPIRED_AT,
    scope: 'mutation',
    windowSeconds: 60,
  })));

  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(results.filter((value) => !value).length, 1);
});

test('rate windows start at one count for each scope and key hash', async () => {
  const keyHash = randomBytes(32);
  const otherKeyHash = randomBytes(32);
  const take = (scope, hash) => takeRateLimit({
    keyHash: hash,
    limit: 1,
    now: EXPIRED_AT,
    scope,
    windowSeconds: 60,
  });

  assert.equal(await take('create', keyHash), true);
  assert.equal(await take('join', keyHash), true);
  assert.equal(await take('create', otherKeyHash), true);
  assert.equal(await take('create', keyHash), false);
});

test('rate limiting refuses a non-positive limit or window', async () => {
  const keyHash = randomBytes(32);

  await assert.rejects(takeRateLimit({
    keyHash, limit: 0, now: EXPIRED_AT, scope: 'mutation', windowSeconds: 60,
  }), { code: 'GROUND_INVALID_REQUEST' });
  await assert.rejects(takeRateLimit({
    keyHash, limit: 1, now: EXPIRED_AT, scope: 'mutation', windowSeconds: 0,
  }), { code: 'GROUND_INVALID_REQUEST' });
});

test('retention timestamp advances only for an accepted edit', async () => {
  const scenario = await createActiveEditorScenario();

  await commitRawUpdate(
    scenario,
    createTextUpdates('A')[0],
    TEST_MAX_UPDATE_BYTES,
    RECENT_AT,
  );

  const record = await readDocumentRecord(scenario.documentId);
  assert.equal(new Date(record.last_mutation_at).toISOString(), RECENT_AT);
});

test('retention timestamp survives reads, denied requests, and a Pending join', async () => {
  const scenario = await createActiveEditorScenario();
  await commitRawUpdate(
    scenario,
    createTextUpdates('A')[0],
    TEST_MAX_UPDATE_BYTES,
    EXPIRED_AT,
  );
  const before = await readDocumentRecord(scenario.documentId);
  const visitor = await createAnonymousClient();

  const read = await scenario.editor.client
    .from('ground_documents')
    .select('id')
    .eq('id', scenario.documentId);
  assert.equal(read.error, null);
  await assert.rejects(commitRawUpdate(
    scenario,
    Buffer.alloc(TEST_MAX_UPDATE_BYTES + 1),
    TEST_MAX_UPDATE_BYTES,
    RECENT_AT,
  ), { code: 'GROUND_UPDATE_TOO_LARGE' });
  await joinDocumentAsAdmin({
    displayName: 'Visitor',
    documentId: scenario.documentId,
    maxDocumentBytes: TEST_MAX_DOCUMENT_BYTES,
    now: RECENT_AT,
    userId: visitor.userId,
  });

  const after = await readDocumentRecord(scenario.documentId);
  assert.equal(
    new Date(after.last_mutation_at).toISOString(),
    new Date(before.last_mutation_at).toISOString(),
  );
  assert.equal(after.head_sequence, before.head_sequence + 1);
});

test('thirty day expiry removes the document and every child row', async () => {
  const scenario = await createActiveEditorScenario();
  await commitRawUpdate(
    scenario,
    createTextUpdates('A')[0],
    TEST_MAX_UPDATE_BYTES,
    EXPIRED_AT,
  );

  assert.ok(await deleteExpiredDocuments(RETENTION_CUTOFF) >= 1);

  assert.equal(await findDocument(scenario.documentId), null);
  assert.deepEqual(await readParticipantsAsAdmin(scenario.documentId), []);
  assert.deepEqual(await readUpdateRows(scenario.documentId), []);
});

test('thirty day cleanup keeps a document whose mutation is newer than the cutoff', async () => {
  const scenario = await createActiveEditorScenario();
  const [first, second] = createTextUpdates('A', 'B');
  await commitRawUpdate(scenario, first, TEST_MAX_UPDATE_BYTES, EXPIRED_AT);
  await commitRawUpdate(scenario, second, TEST_MAX_UPDATE_BYTES, RECENT_AT);

  assert.equal(await deleteExpiredDocuments(RETENTION_CUTOFF), 0);

  assert.notEqual(await findDocument(scenario.documentId), null);
});

test('thirty day cleanup also removes expired rate windows', async () => {
  const keyHash = randomBytes(32);
  const take = () => takeRateLimit({
    keyHash,
    limit: 1,
    now: EXPIRED_AT,
    scope: 'mutation',
    windowSeconds: 60,
  });
  assert.equal(await take(), true);
  assert.equal(await take(), false);

  await deleteExpiredDocuments(RETENTION_CUTOFF);

  assert.equal(await take(), true);
});
