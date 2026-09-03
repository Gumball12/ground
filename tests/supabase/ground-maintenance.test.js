import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
  TEST_MAX_UPDATE_BYTES,
  callAdminRpc,
  commitRawUpdate,
  createActiveEditorScenario,
  createAdminClient,
  decodeUpdate,
  encodeUpdate,
  readDocumentHead,
  readUpdateRows,
} from './ground-supabase-fixture.js';

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
