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

// The metadata above is enforced; the prose telling a reader and an agent which
// runtime to install is not, and drifted to a version this repository never ran.
test('the reader and agent instructions name the runtime the repository requires', async () => {
  const { engines } = JSON.parse(await readFile('package.json', 'utf8'));
  const supportedMajor = engines.node.replace('>=', '');

  for (const path of ['README.md', 'AGENTS.md']) {
    const document = await readFile(path, 'utf8');
    const named = [...document.matchAll(/Node\.js (\d+)/gu)].map(([, major]) => major);
    assert.deepEqual([...new Set(named)], [supportedMajor], path);
  }
});
