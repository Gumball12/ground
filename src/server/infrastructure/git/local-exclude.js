import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function ensureCollabMetadataGitExclude(vaultDir) {
  const excludePath = resolve(vaultDir, '.git/info/exclude');
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
