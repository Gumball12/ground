import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GitUntrackedFileService } from '../../src/server/infrastructure/git/untracked-files.js';

test('countAdditions streams files with and without final newlines', async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-untracked-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  await writeFile(join(vaultDir, 'first.md'), 'one\ntwo\n');
  await writeFile(join(vaultDir, 'second.md'), 'three');

  const service = new GitUntrackedFileService({ vaultDir });

  assert.equal(await service.countAdditions([
    { path: 'first.md' },
    { path: 'second.md' },
  ]), 3);
});
