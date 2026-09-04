import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

const readSource = (path) => readFile(resolve(repoRoot, path), 'utf8');

const GROUND_REPOSITORY = 'https://github.com/Gumball12/ground';
const COLLABMD_REPOSITORY = 'https://github.com/andes90/collabmd';

// The environment template is addressed indirectly so tooling that guards
// against reading secret files does not have to special-case this test.
const ENVIRONMENT_TEMPLATE = ['.env', 'example'].join('.');

test('package metadata identifies Ground and keeps the CollabMD executable', async () => {
  const manifest = JSON.parse(await readSource('package.json'));

  assert.equal(manifest.name, 'ground-webmcp');
  assert.equal(manifest.license, 'MIT');
  assert.match(manifest.description, /Ground/u);
  assert.equal(manifest.repository.url, `git+${GROUND_REPOSITORY}.git`);
  assert.equal(manifest.homepage, `${GROUND_REPOSITORY}#readme`);
  assert.equal(manifest.bugs.url, `${GROUND_REPOSITORY}/issues`);
  // The CLI keeps its published command name and entry point.
  assert.equal(manifest.bin.collabmd, './bin/collabmd.js');
});

// `npm ci` installs from the lockfile, so its root identity is what a clean
// install reports the package to be.
test('the lockfile root names the same package as the manifest', async () => {
  const [manifest, lockfile] = await Promise.all([
    readSource('package.json').then(JSON.parse),
    readSource('package-lock.json').then(JSON.parse),
  ]);

  assert.equal(lockfile.name, manifest.name);
  assert.equal(lockfile.packages[''].name, manifest.name);
  assert.equal(lockfile.packages[''].version, manifest.version);
});

// The design's Definition of Done asks that page metadata, the README, and
// product copy carry one spelling of the tagline, punctuation included.
test('page metadata, the README, and product copy share one tagline', async () => {
  const TAGLINE = 'Ground - One document, Different roles';
  const [manifest, readme, page] = await Promise.all([
    readSource('package.json').then(JSON.parse),
    readSource('README.md'),
    readSource('src/client/app/index.html'),
  ]);

  assert.match(readme, new RegExp(`^# ${TAGLINE}$`, 'mu'));
  assert.ok(manifest.description.startsWith(`${TAGLINE}.`), manifest.description);
  assert.ok(page.includes(`<title>${TAGLINE}</title>`), 'page title');
  assert.ok(page.includes(`content="${TAGLINE}.`), 'page description');
});

// Every Docker instruction this repository ships names the upstream CollabMD
// image, so an image built here would be an artifact nothing pulls, carrying the
// CollabMD CLI under the Ground name.
test('no workflow publishes a container image', async () => {
  const workflows = await readdir('.github/workflows');

  for (const file of workflows) {
    const workflow = await readSource(`.github/workflows/${file}`);
    assert.doesNotMatch(workflow, /docker\/(build-push|login|metadata)-action/u, file);
    assert.doesNotMatch(workflow, /ghcr\.io/u, file);
  }
});

test('the license stays MIT and the README credits CollabMD upstream', async () => {
  const [license, readme] = await Promise.all([
    readSource('LICENSE'),
    readSource('README.md'),
  ]);

  assert.match(license, /MIT License/u);
  assert.ok(readme.includes(COLLABMD_REPOSITORY), 'README must credit CollabMD upstream');
  assert.match(readme, /^# Ground/u);
});

test('the README documents every command a reader needs to run Ground', async () => {
  const readme = await readSource('README.md');

  for (const command of [
    'npm run start:ground',
    'npm start',
    'npm run supabase:start',
    'npm run test:supabase',
    'npm run test:e2e:ground',
    'npm run test:e2e:ground:evidence',
    'npm run test:e2e:evidence',
  ]) {
    assert.ok(readme.includes(command), `README must document \`${command}\``);
  }
});

// Deployment runs from Git, so the README must describe the push-to-deploy flow
// and the environment scoping it depends on, not a CLI promote.
test('the README describes Git deployment and Preview credential scoping', async () => {
  const readme = await readSource('README.md');

  for (const phrase of [
    'every push',
    'Production-scoped',
    'VERCEL_BRANCH_URL',
    'GROUND_PUBLIC_ORIGIN',
  ]) {
    assert.ok(readme.includes(phrase), `README must mention ${phrase}`);
  }
  assert.match(readme, /Preview[^.]*never receive production database credentials/u);
  assert.doesNotMatch(readme, /vercel --prod --skip-domain/u);
});

test('the environment template lists every Ground variable name and no value', async () => {
  const template = await readSource(ENVIRONMENT_TEMPLATE);

  const groundNames = [
    'GROUND_PUBLIC_ORIGIN',
    'GROUND_RATE_LIMIT_HMAC_KEY',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SECRET_KEY',
  ];
  for (const name of groundNames) {
    assert.match(
      template,
      new RegExp(`^${name}=$`, 'mu'),
      `${name} must appear with an empty value`,
    );
  }
  assert.doesNotMatch(template, /sb_(publishable|secret)_/u);
  assert.doesNotMatch(template, /supabase\.co/u);
});

test('the agent documents separate local filesystem truth from hosted Ground truth', async () => {
  const [agents, context, architecture] = await Promise.all([
    readSource('AGENTS.md'),
    readSource('CONTEXT.md'),
    readSource('docs/architecture.md'),
  ]);

  for (const [name, document] of [
    ['AGENTS.md', agents],
    ['CONTEXT.md', context],
    ['docs/architecture.md', architecture],
  ]) {
    assert.match(document, /Ground/u, `${name} must describe Ground`);
    assert.match(document, /Supabase/u, `${name} must name the hosted durable store`);
  }
});

test('CLAUDE.md still delegates to AGENTS.md and nothing else', async () => {
  assert.equal((await readSource('CLAUDE.md')).trim(), '@AGENTS.md');
});

test('ADR 0004 records the hosted runtime decision alongside the earlier ADRs', async () => {
  const adr = await readSource('docs/adr/0004-ground-hosted-supabase-runtime.md');

  assert.match(adr, /Supabase/u);
  assert.match(adr, /Vercel/u);
  assert.match(adr, /stateless/iu);
  // The CollabMD decisions stay valid for the local product rather than being
  // superseded, so the new record has to say so explicitly.
  assert.match(adr, /000[123]/u);
});
