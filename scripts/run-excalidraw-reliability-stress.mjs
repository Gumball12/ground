import { spawnSync } from 'node:child_process';

const seedCount = Number.parseInt(process.env.COLLABMD_EXCALIDRAW_STRESS_SEEDS || '50', 10);
if (!Number.isInteger(seedCount) || seedCount < 1) {
  throw new Error('COLLABMD_EXCALIDRAW_STRESS_SEEDS must be a positive integer');
}

for (let seed = 1; seed <= seedCount; seed += 1) {
  console.log(`Running Excalidraw reliability stress seed ${seed}/${seedCount}`);
  const result = spawnSync(process.execPath, [
    'node_modules/@playwright/test/cli.js',
    'test',
    'tests/e2e/excalidraw-reliability.spec.js',
    '--project',
    'chromium',
    '--grep',
    '@excalidraw-stress',
    '--output',
    `test-results/excalidraw-stress-${seed}`,
  ], {
    env: {
      ...process.env,
      COLLABMD_EXCALIDRAW_STRESS_SEED: String(seed),
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

