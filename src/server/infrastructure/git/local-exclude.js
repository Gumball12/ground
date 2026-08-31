import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function resolveLocalExcludePath(vaultDir) {
  try {
    const { stdout } = await execFile('git', [
      '-C',
      vaultDir,
      'rev-parse',
      '--git-path',
      'info/exclude',
    ], { encoding: 'utf8' });
    const gitPath = stdout.trim();
    if (gitPath) {
      return resolve(vaultDir, gitPath);
    }
  } catch {
    // Preserve the existing non-Git failure path when no repository metadata exists.
  }
  return resolve(vaultDir, '.git/info/exclude');
}

export async function ensureCollabMetadataGitExclude(vaultDir) {
  const excludePath = await resolveLocalExcludePath(vaultDir);
  let existingContent = '';

  try {
    existingContent = await readFile(excludePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const lines = existingContent
    .split(/\r?\n/u)
    .map((line) => line.trim());
  if (lines.includes('.collabmd') || lines.includes('.collabmd/')) {
    return;
  }

  const prefix = existingContent && !existingContent.endsWith('\n') ? '\n' : '';
  await writeFile(excludePath, `${existingContent}${prefix}.collabmd/\n`, 'utf8');
}
