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
