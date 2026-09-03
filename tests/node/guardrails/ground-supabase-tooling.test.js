import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('pins the Ground Supabase SDK, CLI, and test commands', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.dependencies['@supabase/supabase-js'], '2.114.0');
  assert.equal(packageJson.devDependencies.supabase, '2.116.0');
  assert.equal(packageJson.scripts['test:supabase'], 'node scripts/run-ground-supabase-tests.mjs');
  assert.match(await readFile('supabase/config.toml', 'utf8'), /enable_anonymous_sign_ins = true/u);
});

// One existing validate job gates local CollabMD plus Ground. A second workflow
// would double the cost and could drift, so the order is asserted in place.
test('the existing validation job runs the Ground Supabase and E2E suites in order', async () => {
  const workflow = await readFile('.github/workflows/docker-publish.yml', 'utf8');
  const expected = [
    'node-version: 24',
    'npm ci',
    'npx playwright install --with-deps chromium',
    'npm run supabase:start',
    'npm run test:supabase',
    'npm run check',
    'npm run test:e2e:governance:prebuilt',
    'npm run test:e2e:ground',
    'npm run supabase:stop',
  ];

  let cursor = 0;
  for (const step of expected) {
    const found = workflow.indexOf(step, cursor);
    assert.notEqual(found, -1, `expected "${step}" after index ${cursor}`);
    cursor = found + step.length;
  }

  const stopIndex = workflow.indexOf('npm run supabase:stop');
  assert.match(workflow.slice(stopIndex - 200, stopIndex), /if:\s*always\(\)/u);
  assert.equal(workflow.split('jobs:').length, 2);
});
