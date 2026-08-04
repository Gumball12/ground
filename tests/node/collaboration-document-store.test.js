import test from 'node:test';
import assert from 'node:assert/strict';

import { CollaborationDocumentStore } from '../../src/server/domain/collaboration/collaboration-document-store.js';

function createDocumentStore({ persistResult = { ok: true }, snapshotResult = { ok: true } } = {}) {
  const calls = { atomic: [], backlinks: [], snapshots: [] };
  const store = new CollaborationDocumentStore({
    backlinkIndex: {
      updateFile(path, content) {
        calls.backlinks.push({ content, path });
      },
    },
    name: 'notes.md',
    vaultFileStore: {
      async persistCollaborationState(path, state) {
        calls.atomic.push({ path, state });
        return persistResult;
      },
      async writeCollaborationSnapshot(path, snapshot) {
        calls.snapshots.push({ path, snapshot });
        return snapshotResult;
      },
    },
  });
  return { calls, store };
}

test('CollaborationDocumentStore rejects failed atomic persistence', async () => {
  const { calls, store } = createDocumentStore({
    persistResult: { ok: false, error: 'disk full' },
  });

  await assert.rejects(
    () => store.persistState({ content: '# Draft\n' }),
    /Failed to persist collaboration state for "notes\.md": disk full/,
  );
  assert.equal(calls.atomic.length, 1);
  assert.equal(calls.backlinks.length, 0);
});

test('CollaborationDocumentStore persists state atomically and refreshes markdown backlinks', async () => {
  const { calls, store } = createDocumentStore();
  const snapshot = Uint8Array.from([4, 5, 6]);
  const commentThreads = [{ id: 'thread-1' }];

  await store.persistState({ commentThreads, content: '# Atomic\n', snapshot });

  assert.deepEqual(calls.atomic, [{
    path: 'notes.md',
    state: { commentThreads, content: '# Atomic\n', includeContent: true, snapshot },
  }]);
  assert.deepEqual(calls.backlinks, [{ content: '# Atomic\n', path: 'notes.md' }]);
});

test('CollaborationDocumentStore reports replacement snapshot failures', async () => {
  const { store } = createDocumentStore({
    snapshotResult: { ok: false, error: 'snapshot path unavailable' },
  });

  await assert.rejects(
    () => store.writeSnapshot(Uint8Array.from([1])),
    /Failed to write collaboration snapshot for "notes\.md": snapshot path unavailable/,
  );
});
