import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroundSupabaseStore } from '../../src/server/infrastructure/supabase/ground-supabase-store.js';

const SUPABASE_URL = 'https://ground.supabase.test';
const DOCUMENT_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

const jsonResponse = (body) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json' },
  status: 200,
});

// The store is exercised against the real database in tests/supabase. This
// fake fetch pins the PostgREST request each method issues and how it decodes
// what PostgREST returns, which the real run cannot observe.
const createStoreHarness = (respond) => {
  const requests = [];
  const store = createGroundSupabaseStore({
    fetchImpl: async (url, init = {}) => {
      const request = {
        body: init.body ? JSON.parse(init.body) : undefined,
        method: init.method,
        url: String(url),
      };
      requests.push(request);
      return respond(request);
    },
    secretKey: 'sb_secret_test',
    supabaseUrl: SUPABASE_URL,
  });
  return { requests, store };
};

// Reading the document row and then its log in two statements let a fold that
// committed in between delete rows the second statement still needed, so the
// reader paired an old snapshot with a log missing the folded range.
test('loadState reads the snapshot and its log through one RPC and decodes base64 bytes', async () => {
  const snapshot = Buffer.from('snapshot bytes');
  const update = Buffer.from('update bytes');
  const { requests, store } = createStoreHarness(() => jsonResponse({
    headSequence: 7,
    snapshot: snapshot.toString('base64'),
    snapshotSequence: 5,
    updates: [
      { sequence: 6, update: update.toString('base64') },
      { sequence: 7, update: update.toString('base64') },
    ],
  }));

  const state = await store.loadState({ documentId: DOCUMENT_ID });

  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [
    { method: 'POST', url: `${SUPABASE_URL}/rest/v1/rpc/ground_load_state` },
  ]);
  assert.deepEqual(requests[0].body, { p_document_id: DOCUMENT_ID });
  assert.equal(state.headSequence, 7);
  assert.equal(state.snapshotSequence, 5);
  assert.deepEqual(state.snapshot, new Uint8Array(snapshot));
  assert.deepEqual(state.updates, [
    { sequence: 6, update: new Uint8Array(update) },
    { sequence: 7, update: new Uint8Array(update) },
  ]);
});

test('loadState reports a document the RPC does not find as GROUND_UNAVAILABLE', async () => {
  const { store } = createStoreHarness(() => jsonResponse(null));

  await assert.rejects(
    store.loadState({ documentId: DOCUMENT_ID }),
    { code: 'GROUND_UNAVAILABLE' },
  );
});
