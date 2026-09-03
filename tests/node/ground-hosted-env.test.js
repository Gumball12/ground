import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGroundHostedEnv } from '../../src/server/config/ground-hosted-env.js';

const validEnv = Object.freeze({
  GROUND_PUBLIC_ORIGIN: 'https://ground.test',
  GROUND_RATE_LIMIT_HMAC_KEY: 'ground-rate-limit-key',
  NODE_ENV: 'production',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  SUPABASE_URL: 'https://project.supabase.co',
});

test('loads the five Ground server values without exposing the secret', () => {
  const config = loadGroundHostedEnv(validEnv);

  assert.equal(config.supabaseUrl, 'https://project.supabase.co');
  assert.equal(config.supabaseSecretKey, 'sb_secret_test');
  assert.equal(config.publicOrigin, 'https://ground.test');
  assert.equal(config.rateLimitHmacKey, 'ground-rate-limit-key');
  assert.deepEqual(config.publicConfig, {
    groundHosted: true,
    supabasePublishableKey: 'sb_publishable_test',
    supabaseUrl: 'https://project.supabase.co',
  });
});

test('rejects every missing required Ground environment value', () => {
  for (const key of [
    'GROUND_PUBLIC_ORIGIN', 'GROUND_RATE_LIMIT_HMAC_KEY', 'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
  ]) {
    assert.throws(() => loadGroundHostedEnv({ ...validEnv, [key]: '' }), /required/u);
  }
});

test('freezes the loaded configuration and its public config', () => {
  const config = loadGroundHostedEnv(validEnv);

  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.publicConfig), true);
});

test('rejects a non-HTTPS Supabase URL or public origin in production', () => {
  assert.throws(
    () => loadGroundHostedEnv({ ...validEnv, SUPABASE_URL: 'http://project.supabase.co' }),
    /https/u,
  );
  assert.throws(
    () => loadGroundHostedEnv({ ...validEnv, GROUND_PUBLIC_ORIGIN: 'http://ground.test' }),
    /https/u,
  );
  assert.throws(
    () => loadGroundHostedEnv({ ...validEnv, GROUND_PUBLIC_ORIGIN: 'http://localhost:1234' }),
    /https/u,
  );
});

test('allows loopback origins outside production only', () => {
  const development = { ...validEnv, NODE_ENV: 'development' };

  assert.equal(loadGroundHostedEnv({
    ...development,
    GROUND_PUBLIC_ORIGIN: 'http://localhost:1234',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  }).supabaseUrl, 'http://127.0.0.1:54321');
  assert.throws(
    () => loadGroundHostedEnv({ ...development, GROUND_PUBLIC_ORIGIN: 'http://ground.test' }),
    /https/u,
  );
});

test('rejects an origin carrying a path, query, or hash', () => {
  for (const origin of [
    'https://ground.test/app',
    'https://ground.test/?a=1',
    'https://ground.test/#x',
  ]) {
    assert.throws(() => loadGroundHostedEnv({ ...validEnv, GROUND_PUBLIC_ORIGIN: origin }), /origin/u);
  }
});

test('rejects a value that is not an absolute URL', () => {
  assert.throws(() => loadGroundHostedEnv({ ...validEnv, SUPABASE_URL: 'project.supabase.co' }), /absolute/u);
});
