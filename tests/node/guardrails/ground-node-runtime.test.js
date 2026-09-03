import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('uses Node 24 across local, container, package, and workflow metadata', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.engines.node, '>=24');
  assert.equal((await readFile('.tool-versions', 'utf8')).trim(), 'nodejs 24.19.0');
  assert.doesNotMatch(await readFile('Dockerfile', 'utf8'), /node:26/u);
  for (const path of [
    '.github/workflows/docker-publish.yml',
    '.github/workflows/homebrew-tap-release.yml',
    '.github/workflows/npm-publish.yml',
  ]) {
    assert.doesNotMatch(await readFile(path, 'utf8'), /node-version:\s*26/u);
  }
});
