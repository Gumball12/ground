import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWorkspaceChange } from '../../src/domain/workspace-change.js';
import { WorkspaceReconciliation } from '../../src/server/application/workspace-reconciliation.js';
import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';
import { createWorkspaceStateFileSystemAdapter } from '../../src/server/infrastructure/workspace/workspace-state-file-system-adapter.js';

function createWorkspaceReconciliation(options) {
  return new WorkspaceReconciliation({
    ...options,
    workspaceStateAdapter: options.workspaceStateAdapter ?? createWorkspaceStateFileSystemAdapter({
      vaultDir: options.vaultFileStore?.vaultDir,
    }),
  });
}

function createState(paths = []) {
  return {
    entries: new Map(paths.map((pathValue) => [pathValue, { path: pathValue, type: 'file' }])),
    filePaths: [...paths],
    markdownPaths: paths.filter((pathValue) => pathValue.endsWith('.md')),
    metadata: new Map(),
    scannedAt: Date.now(),
    vaultFileCount: paths.length,
  };
}

async function createCoordinatorWithVault(t, initialFiles = {}) {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-workspace-mutation-'));
  t.after(async () => {
    await rm(vaultDir, { force: true, recursive: true });
  });

  await Promise.all(
    Object.entries(initialFiles).map(async ([pathValue, content]) => {
      const absolutePath = join(vaultDir, pathValue);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
    }),
  );

  const vaultFileStore = new VaultFileStore({ vaultDir });
  const coordinator = createWorkspaceReconciliation({
    backlinkIndex: null,
    roomRegistry: null,
    vaultFileStore,
  });
  coordinator.workspaceState = await vaultFileStore.scanWorkspaceState();

  let scanCalls = 0;
  const originalScanWorkspaceState = vaultFileStore.scanWorkspaceState.bind(vaultFileStore);
  vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    return originalScanWorkspaceState(...args);
  };

  return {
    coordinator,
    get scanCalls() {
      return scanCalls;
    },
    vaultDir,
    vaultFileStore,
  };
}

test('WorkspaceReconciliation applies small backlink renames incrementally', async () => {
  const calls = [];
  const previousState = createState(['a.md', 'b.md']);
  const nextState = createState(['b.md', 'c.md']);
  const coordinator = createWorkspaceReconciliation({
    backlinkIndex: {
      async applyWorkspaceChange(workspaceChange, { nextState, previousState }) {
        calls.push(['apply', workspaceChange, previousState, nextState]);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = previousState;
  await coordinator.reconcileBacklinks({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'a.md', newPath: 'c.md' }],
  }, nextState);

  assert.deepEqual(calls, [[
    'apply',
    {
      changedPaths: [],
      deletedPaths: [],
      renamedPaths: [{ oldPath: 'a.md', newPath: 'c.md' }],
    },
    previousState,
    nextState,
  ]]);
});

test('WorkspaceReconciliation schedules large backlink rebuilds without awaiting a full build', async () => {
  const calls = [];
  const nextState = createState(['note-1.md']);
  const coordinator = createWorkspaceReconciliation({
    backlinkIndex: {
      scheduleBuild(options) {
        calls.push(['schedule-build', options]);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = createState(['note-1.md']);
  await coordinator.reconcileBacklinks({
    changedPaths: Array.from({ length: 26 }, (_, index) => `note-${index}.md`),
    deletedPaths: [],
    renamedPaths: [],
  }, nextState);

  assert.deepEqual(calls, [[
    'schedule-build',
    { workspaceState: nextState },
  ]]);
});

test('WorkspaceReconciliation avoids a full rescan for API file writes', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  await writeFile(join(harness.vaultDir, 'docs', 'test.md'), '# After\n', 'utf8');
  await harness.coordinator.apply({
    action: 'write-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['docs/test.md'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs'), true);
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, ['docs/test.md']);
  assert.equal(harness.coordinator.workspaceState.vaultFileCount, 1);
});

test('WorkspaceReconciliation writeEditableContent owns the file write and reconciliation', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  const result = await harness.coordinator.writeEditableContent({
    content: '# After\n',
    path: 'docs/test.md',
  });

  assert.equal(result.ok, true);
  assert.equal(await readFile(join(harness.vaultDir, 'docs', 'test.md'), 'utf8'), '# After\n');
  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), true);
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, ['docs/test.md']);
});

test('WorkspaceReconciliation avoids a full rescan for API file creation with nested directories', async (t) => {
  const harness = await createCoordinatorWithVault(t, {});

  await harness.vaultFileStore.createFile('guides/start/here.md', '# Hello\n');
  await harness.coordinator.apply({
    action: 'create-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['guides/start/here.md'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides/start'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides/start/here.md'), true);
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, ['guides/start/here.md']);
  assert.equal(harness.coordinator.workspaceState.vaultFileCount, 1);
});

test('WorkspaceReconciliation avoids a full rescan for API file deletion', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  await harness.vaultFileStore.deleteFile('docs/test.md');
  await harness.coordinator.apply({
    action: 'delete-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      deletedPaths: ['docs/test.md'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs'), true);
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, []);
  assert.equal(harness.coordinator.workspaceState.vaultFileCount, 0);
});

test('WorkspaceReconciliation avoids a full rescan for API file renames', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  await harness.vaultFileStore.renameFile('docs/test.md', 'archive/renamed.md');
  await harness.coordinator.apply({
    action: 'rename-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      renamedPaths: [{ oldPath: 'docs/test.md', newPath: 'archive/renamed.md' }],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('archive'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('archive/renamed.md'), true);
});

test('WorkspaceReconciliation avoids a full rescan for API directory creation', async (t) => {
  const harness = await createCoordinatorWithVault(t, {});

  await harness.vaultFileStore.createDirectory('guides/start');
  await harness.coordinator.apply({
    action: 'create-directory',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['guides/start'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides/start'), true);
});

test('WorkspaceReconciliation derives descendant rename entries for directory renames', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
    'docs/guides/setup.md': '# Setup\n',
  });

  const workspaceChange = await harness.coordinator.createDirectoryRenameWorkspaceChange('docs/guides', 'docs/reference');

  assert.deepEqual(workspaceChange.renamedPaths, [
    { oldPath: 'docs/guides', newPath: 'docs/reference' },
    { oldPath: 'docs/guides/intro.md', newPath: 'docs/reference/intro.md' },
    { oldPath: 'docs/guides/setup.md', newPath: 'docs/reference/setup.md' },
  ]);
});

test('WorkspaceReconciliation avoids a full rescan for API directory renames', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
  });

  const workspaceChange = await harness.coordinator.createDirectoryRenameWorkspaceChange('docs/guides', 'docs/reference');
  await harness.vaultFileStore.renameDirectory('docs/guides', 'docs/reference');
  await harness.coordinator.apply({
    action: 'rename-directory',
    origin: 'api',
    publishEvent: false,
    workspaceChange,
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference/intro.md'), true);
});

test('WorkspaceReconciliation renameDirectory owns descendant change derivation and reconciliation', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
  });

  const result = await harness.coordinator.renameDirectory({
    newPath: 'docs/reference',
    oldPath: 'docs/guides',
  });

  assert.equal(result.ok, true);
  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference/intro.md'), true);
});

test('WorkspaceReconciliation avoids a full rescan for API directory deletion', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
  });

  const workspaceChange = await harness.coordinator.createDirectoryDeleteWorkspaceChange('docs/guides');
  await harness.vaultFileStore.deleteDirectory('docs/guides', { recursive: true });
  await harness.coordinator.apply({
    action: 'delete-directory',
    origin: 'api',
    publishEvent: false,
    workspaceChange,
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides/intro.md'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs'), true);
});
