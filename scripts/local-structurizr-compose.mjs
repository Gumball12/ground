import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const projectRoot = resolve(scriptDir, '..');
const composeFile = resolve(projectRoot, 'docker-compose.yml');

function runCommand(command, args, { env = process.env } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

export function getLocalStructurizrHostPort() {
  const rawValue = process.env.STRUCTURIZR_HOST_PORT || '19090';
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid STRUCTURIZR_HOST_PORT: ${rawValue}`);
  }

  return parsed;
}

export function getLocalStructurizrServerUrl() {
  return `http://127.0.0.1:${getLocalStructurizrHostPort()}`;
}

function getComposeArgs(command) {
  return ['compose', '-f', composeFile, ...command];
}

export async function startLocalStructurizrComposeService({ vaultDir = process.env.COLLABMD_VAULT_DIR || '.' } = {}) {
  const hostVaultDir = resolve(vaultDir);
  await mkdir(resolve(hostVaultDir, '.collabmd/structurizr'), { recursive: true });
  await runCommand('docker', getComposeArgs(['up', '-d', 'structurizr']), {
    env: {
      ...process.env,
      HOST_VAULT_DIR: hostVaultDir,
      STRUCTURIZR_HOST_PORT: String(getLocalStructurizrHostPort()),
    },
  });
  return getLocalStructurizrServerUrl();
}

export async function stopLocalStructurizrComposeService() {
  await runCommand('docker', getComposeArgs(['stop', 'structurizr']));
}

async function main() {
  const command = process.argv[2] || 'up';

  if (command === 'up') {
    const url = await startLocalStructurizrComposeService();
    console.log(`[structurizr] Local Structurizr renderer is available at ${url}`);
    return;
  }

  if (command === 'down') {
    await stopLocalStructurizrComposeService();
    console.log('[structurizr] Local Structurizr renderer stopped');
    return;
  }

  if (command === 'url') {
    console.log(getLocalStructurizrServerUrl());
    return;
  }

  console.error('Usage: node scripts/local-structurizr-compose.mjs [up|down|url]');
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    if (error.code === 'ENOENT') {
      console.error('[structurizr] Docker is not available. Install Docker Desktop or Docker Engine first.');
    } else {
      console.error(`[structurizr] ${error.message}`);
    }

    process.exit(1);
  });
}
