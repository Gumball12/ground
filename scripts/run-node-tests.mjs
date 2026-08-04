#!/usr/bin/env node

import { readdir } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const mode = process.argv[2] || 'fast';
const rootDir = resolve(import.meta.dirname, '..');
const nodeTestDir = resolve(rootDir, 'tests/node');

const integrationTests = new Set([
  'app-server-startup.test.js',
  'authentication.test.js',
  'filesystem-sync.test.js',
  'git-remote-bootstrap.test.js',
  'git-service.test.js',
  'http-server.test.js',
  'package-packaging.test.js',
  'websocket-collaboration.test.js',
]);

const guardrailTests = new Set([
  'style-system-guardrails.test.js',
]);

if (!['fast', 'integration'].includes(mode)) {
  console.error(`Unknown node test mode "${mode}". Expected "fast" or "integration".`);
  process.exit(1);
}

function requireIntegrationCommand(command, args, installHint) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return;
  }

  console.error(`${command} is required for CollabMD integration tests.`);
  console.error(installHint);
  process.exit(1);
}

if (mode === 'integration') {
  requireIntegrationCommand(
    'rg',
    ['--version'],
    'Install ripgrep first, for example: brew install ripgrep, apt install ripgrep, or apk add ripgrep.',
  );
}

const testFiles = (await readdir(nodeTestDir))
  .filter((fileName) => fileName.endsWith('.test.js'))
  .filter((fileName) => {
    if (mode === 'integration') {
      return integrationTests.has(fileName);
    }

    return !integrationTests.has(fileName) && !guardrailTests.has(fileName);
  })
  .sort()
  .map((fileName) => resolve(nodeTestDir, fileName));

if (testFiles.length === 0) {
  console.error(`No ${mode} node tests found.`);
  process.exit(1);
}

const args = ['--test', '--test-force-exit'];

if (mode === 'integration') {
  args.push(`--test-concurrency=${process.env.NODE_TEST_INTEGRATION_CONCURRENCY || '2'}`);
}

args.push(...testFiles);

const child = spawn(process.execPath, args, {
  cwd: rootDir,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
