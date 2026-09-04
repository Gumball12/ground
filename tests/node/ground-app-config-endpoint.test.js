import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import appConfigEndpoint from '../../api/app-config.js';

const CONFIGURED = Object.freeze({
  GROUND_PUBLIC_ORIGIN: 'https://ground.example',
  GROUND_RATE_LIMIT_HMAC_KEY: 'rate-key',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_URL: 'https://project.supabase.co',
});

const withEnv = async (values, run) => {
  const saved = Object.fromEntries(
    Object.keys(CONFIGURED).map((name) => [name, process.env[name]]),
  );
  try {
    for (const name of Object.keys(CONFIGURED)) {
      if (values[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = values[name];
      }
    }
    return await run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
};

const readConfig = (body) => JSON.parse(
  body.replace(/^window\.__COLLABMD_CONFIG__ = /u, '').trim().replace(/;$/u, ''),
);

// A Git push deploys every branch, and a Preview scoped to Production-only
// variables has no Supabase credentials at all. The endpoint must still answer
// so the page never falls through to the local CollabMD shell.
test('reports a hosted deployment as unavailable when configuration is missing', async () => {
  const response = await withEnv({}, () => appConfigEndpoint.fetch(
    new Request('https://ground-git-fix-acme.vercel.app/app-config.js'),
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /javascript/u);

  const body = await response.text();
  const config = readConfig(body);
  assert.equal(config.groundHosted, true);
  assert.equal(config.unavailable, true);
  // A misconfigured deployment must never publish a partial credential.
  assert.equal('supabaseUrl' in config, false);
  assert.equal('supabasePublishableKey' in config, false);
  assert.doesNotMatch(body, /sb_secret|SUPABASE_SECRET_KEY/u);
});

test('publishes only the public runtime configuration when configured', async () => {
  const response = await withEnv(CONFIGURED, () => appConfigEndpoint.fetch(
    new Request('https://ground.example/app-config.js'),
  ));

  assert.equal(response.status, 200);
  const body = await response.text();
  const config = readConfig(body);

  assert.deepEqual(config, {
    groundHosted: true,
    supabasePublishableKey: 'sb_publishable_test',
    supabaseUrl: 'https://project.supabase.co',
  });
  assert.equal('unavailable' in config, false);
  assert.doesNotMatch(body, /sb_secret_test|rate-key/u);
});

// The entry module chooses a product from the served configuration, so it has
// to treat an unconfigured hosted deployment as neither product.
test('the entry module refuses to boot the local shell on a hosted deployment', async () => {
  const mainEntry = await readFile('src/client/app/main-entry.js', 'utf8');

  assert.match(mainEntry, /unavailable/u);
  assert.match(mainEntry, /groundUnavailable/u);
});
