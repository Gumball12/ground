import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const headersFor = (config, source) => Object.fromEntries(
  config.headers
    .find((entry) => entry.source === source)
    .headers.map(({ key, value }) => [key, value]),
);

test('rewrites only a 22-character document id to index.html', async () => {
  const config = await readJson('vercel.json');

  assert.deepEqual(config.rewrites, [
    { destination: '/api/app-config', source: '/app-config.js' },
    { destination: '/index.html', source: '/:docId([A-Za-z0-9_-]{22})' },
  ]);
  assert.equal(config.outputDirectory, 'dist/client');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.framework, null);
});

// `includeFiles` is one node-glob pattern string of at most 256 characters, not
// a list. Vercel rejects the whole configuration before building when it is an
// array, so the pattern is resolved here against the real files the Function
// reads at runtime.
test('keeps the Ground API a Function that can read the manifest and demo document', async () => {
  const config = await readJson('vercel.json');
  const { includeFiles } = config.functions['api/ground.js'];

  assert.equal(typeof includeFiles, 'string');
  assert.equal(includeFiles.length <= 256, true);
  assert.deepEqual(globSync(includeFiles).toSorted(), [
    'collabmd.governance.json',
    'docs/demo/launch-plan.md',
  ]);
  assert.equal(Number.isInteger(config.functions['api/ground.js'].maxDuration), true);
  assert.equal(Number.isInteger(config.functions['api/app-config.js'].maxDuration), true);
});

// A rewrite is only reached when no file or Function matches, and the pattern
// itself also refuses every API and asset path.
test('the document rewrite pattern matches no API or asset path', async () => {
  const { rewrites } = await readJson('vercel.json');
  const pattern = new RegExp(`^${rewrites[1].source.replace(':docId', '')}$`, 'u');

  for (const path of ['/api/ground', '/app-config.js', '/robots.txt', '/assets/main.js', '/']) {
    assert.equal(pattern.test(path), false, path);
  }
  assert.equal(pattern.test('/AbCdEf0123456789_-xyZA'), true);
});

test('serves the documented security headers on the landing and document routes', async () => {
  const config = await readJson('vercel.json');
  const expected = {
    'Content-Security-Policy': CSP,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };

  assert.deepEqual(headersFor(config, '/'), expected);
  assert.deepEqual(headersFor(config, '/:docId([A-Za-z0-9_-]{22})'), expected);
});

test('robots.txt disallows every path and the page opts out of indexing', async () => {
  const robots = await readFile('src/client/app/public/robots.txt', 'utf8');
  const indexHtml = await readFile('src/client/app/index.html', 'utf8');

  assert.match(robots, /^User-agent: \*$/mu);
  assert.match(robots, /^Disallow: \/$/mu);
  assert.match(indexHtml, /<meta name="robots" content="noindex,nofollow">/u);
});

// `script-src 'self'` blocks an inline script, so the legacy hash handling has
// to run from the external entry module instead.
test('the served page carries no inline script', async () => {
  const indexHtml = await readFile('src/client/app/index.html', 'utf8');
  const mainEntry = await readFile('src/client/app/main-entry.js', 'utf8');

  assert.doesNotMatch(indexHtml, /<script(?![^>]*\ssrc=)[^>]*>/u);
  assert.doesNotMatch(indexHtml, /data-initial-file-requested/u);
  assert.match(mainEntry, /data-initial-file-requested/u);
});

// The CSP must name the Supabase hosts so the browser can reach them, so the
// check is that no credential or environment mapping appears anywhere.
test('vercel.json carries no credential and no Preview environment mapping', async () => {
  const raw = await readFile('vercel.json', 'utf8');
  const config = JSON.parse(raw);

  assert.doesNotMatch(raw, /SUPABASE_(URL|PUBLISHABLE_KEY|SECRET_KEY)/u);
  assert.doesNotMatch(raw, /sb_(publishable|secret)_/u);
  assert.doesNotMatch(raw, /GROUND_RATE_LIMIT_HMAC_KEY/u);
  assert.equal('env' in config, false);
  assert.equal('build' in config, false);
});
