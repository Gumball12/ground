import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { ensureCollabMetadataGitExclude } from '../../src/server/infrastructure/git/local-exclude.js';

const execFile = promisify(execFileCallback);

const runGit = async (cwd, args) => execFile('git', args, {
  cwd,
  env: {
    ...process.env,
    GIT_AUTHOR_EMAIL: 'tests@example.com',
    GIT_AUTHOR_NAME: 'CollabMD Tests',
    GIT_COMMITTER_EMAIL: 'tests@example.com',
    GIT_COMMITTER_NAME: 'CollabMD Tests',
  },
});

const createRepository = async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-local-exclude-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });
  await runGit(repoDir, ['init']);
  await writeFile(join(repoDir, 'README.md'), '# Test\n', 'utf8');
  await runGit(repoDir, ['add', 'README.md']);
  await runGit(repoDir, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial commit']);
  return repoDir;
};

test('writes CollabMD metadata to a normal repository local exclude file', async (t) => {
  const repoDir = await createRepository(t);

  await ensureCollabMetadataGitExclude(repoDir);

  assert.match(await readFile(join(repoDir, '.git/info/exclude'), 'utf8'), /^\.collabmd\/$/m);
});

test('writes CollabMD metadata through Git authoritative path in a linked worktree', async (t) => {
  const repoDir = await createRepository(t);
  const linkedDir = `${repoDir}-linked`;
  t.after(async () => {
    await rm(linkedDir, { force: true, recursive: true });
  });
  await runGit(repoDir, ['worktree', 'add', '-b', 'linked-worktree', linkedDir]);
  const { stdout } = await runGit(linkedDir, ['rev-parse', '--git-path', 'info/exclude']);
  const excludePath = resolve(linkedDir, String(stdout).trim());

  await ensureCollabMetadataGitExclude(linkedDir);

  assert.match(await readFile(excludePath, 'utf8'), /^\.collabmd\/$/m);
});
