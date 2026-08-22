import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWorkspaceChange } from '../../src/domain/workspace-change.js';
import {
  createWorkspaceStateSnapshot,
  deriveIncrementalWorkspaceState,
  deriveNextWorkspaceStateForApiMutation,
  detectWorkspaceStateChange,
  diffWorkspaceEntries,
  scanWorkspaceState,
  workspaceStateMetadataEqual,
} from '../../src/server/domain/workspace-state.js';
import { createWorkspaceStateFileSystemAdapter } from '../../src/server/infrastructure/workspace/workspace-state-file-system-adapter.js';

async function createVault(t, files = {}) {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-workspace-state-'));
  t.after(async () => {
    await rm(vaultDir, { force: true, recursive: true });
  });

  await Promise.all(Object.entries(files).map(async ([pathValue, content]) => {
    const absolutePath = join(vaultDir, pathValue);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }));

  return {
    adapter: createWorkspaceStateFileSystemAdapter({ vaultDir }),
    vaultDir,
  };
}

test('Workspace State scan builds entries, metadata, and derived file lists', async (t) => {
  const { adapter } = await createVault(t, {
    'README.md': '# Readme\n',
    'docs/guide.md': '# Guide\n',
    'docs/report.html': '<h1>Report</h1>\n',
    'docs/ignored.txt': 'ignored\n',
    'assets/image.webp': 'image',
  });

  const state = await scanWorkspaceState(adapter, { scannedAt: 1 });

  assert.deepEqual(Array.from(state.entries.keys()).sort(), [
    'README.md',
    'assets',
    'assets/image.webp',
    'docs',
    'docs/guide.md',
    'docs/report.html',
  ]);
  assert.deepEqual(state.filePaths, ['assets/image.webp', 'docs/guide.md', 'docs/report.html', 'README.md']);
  assert.deepEqual(state.markdownPaths, ['docs/guide.md', 'README.md']);
  assert.equal(state.metadata.get('docs')?.type, 'directory');
  assert.equal(state.metadata.get('docs/guide.md')?.type, 'file');
  assert.equal(Number.isFinite(state.entries.get('docs/guide.md')?.mtimeMs), true);
  assert.equal(state.scannedAt, 1);
  assert.equal(state.vaultFileCount, 4);
});

test('Workspace State derives API mutation snapshots with ancestor directories', async (t) => {
  const { adapter, vaultDir } = await createVault(t, {});
  const previousState = await scanWorkspaceState(adapter, { scannedAt: 1 });

  await mkdir(join(vaultDir, 'guides', 'start'), { recursive: true });
  await writeFile(join(vaultDir, 'guides', 'start', 'here.md'), '# Here\n', 'utf8');

  const nextState = await deriveNextWorkspaceStateForApiMutation(adapter, {
    action: 'create-file',
    previousState,
    scannedAt: 2,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['guides/start/here.md'],
    }),
  });

  assert.equal(nextState.entries.has('guides'), true);
  assert.equal(nextState.entries.has('guides/start'), true);
  assert.equal(nextState.entries.has('guides/start/here.md'), true);
  assert.deepEqual(nextState.markdownPaths, ['guides/start/here.md']);
  assert.equal(nextState.scannedAt, 2);
});

test('Workspace State derives incremental filesystem changes from scoped paths', async (t) => {
  const { adapter, vaultDir } = await createVault(t, {
    'docs/guide.md': '# Guide\n',
  });
  const previousState = await scanWorkspaceState(adapter, { scannedAt: 1 });

  await writeFile(join(vaultDir, 'docs', 'guide.md'), '# Guide\n\nUpdated\n', 'utf8');
  const { fallbackReason, incrementalResult } = await deriveIncrementalWorkspaceState(adapter, {
    pendingPaths: ['docs', 'docs/guide.md'],
    previousState,
    scannedAt: 2,
  });

  assert.equal(fallbackReason, '');
  assert.deepEqual(incrementalResult.workspaceChange.changedPaths, ['docs/guide.md']);
  assert.equal(incrementalResult.nextState.entries.has('docs'), true);
  assert.equal(incrementalResult.nextState.scannedAt, 2);
});

test('Workspace State detects file and directory renames from metadata signatures', async (t) => {
  const { adapter, vaultDir } = await createVault(t, {
    'docs/guide.md': '# Guide\n',
  });
  const previousState = await scanWorkspaceState(adapter);

  await mkdir(join(vaultDir, 'archive'), { recursive: true });
  await rename(join(vaultDir, 'docs', 'guide.md'), join(vaultDir, 'archive', 'guide.md'));
  const nextState = await scanWorkspaceState(adapter);

  const workspaceChange = detectWorkspaceStateChange(previousState, nextState);
  assert.deepEqual(workspaceChange.renamedPaths, [{
    oldPath: 'docs/guide.md',
    newPath: 'archive/guide.md',
  }]);
});

test('Workspace State exposes room patches and metadata equality rules', () => {
  const previousState = createWorkspaceStateSnapshot(
    new Map([['a.md', { fileKind: 'file', name: 'a.md', nodeType: 'file', parentPath: '', path: 'a.md', type: 'file' }]]),
    new Map([['a.md', { inode: 1, mtimeMs: 1, path: 'a.md', size: 1, type: 'file' }]]),
    { scannedAt: 1 },
  );
  const nextState = createWorkspaceStateSnapshot(
    new Map([
      ['a.md', { fileKind: 'file', name: 'a.md', nodeType: 'file', parentPath: '', path: 'a.md', type: 'file' }],
      ['b.md', { fileKind: 'file', name: 'b.md', nodeType: 'file', parentPath: '', path: 'b.md', type: 'file' }],
    ]),
    new Map([
      ['a.md', { inode: 1, mtimeMs: 1, path: 'a.md', size: 1, type: 'file' }],
      ['b.md', { inode: 2, mtimeMs: 1, path: 'b.md', size: 1, type: 'file' }],
    ]),
    { scannedAt: 2 },
  );

  const patch = diffWorkspaceEntries(previousState.entries, nextState.entries);
  assert.deepEqual(patch.deletes, []);
  assert.equal(patch.upserts.get('b.md')?.path, 'b.md');
  assert.equal(workspaceStateMetadataEqual(previousState, nextState), false);
  assert.equal(workspaceStateMetadataEqual(previousState, previousState), true);

  const changedState = createWorkspaceStateSnapshot(
    new Map([['a.md', { fileKind: 'file', name: 'a.md', nodeType: 'file', parentPath: '', path: 'a.md', type: 'file' }]]),
    new Map([['a.md', { inode: 1, mtimeMs: 2, path: 'a.md', size: 1, type: 'file' }]]),
  );
  assert.equal(diffWorkspaceEntries(previousState.entries, changedState.entries).upserts.get('a.md')?.mtimeMs, 2);
});
