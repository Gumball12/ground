import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  getVaultFileKind,
  isDiagramFilePath,
  isStructurizrFilePath,
} from '../../src/domain/file-kind.js';
import { createStructurizrStarter } from '../../src/client/domain/vault-paths.js';
import { StructurizrWorkspaceService } from '../../src/server/infrastructure/structurizr/structurizr-workspace-service.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

test('Structurizr DSL is a renderable diagram workspace root', () => {
  assert.equal(getVaultFileKind('workspace.dsl'), 'structurizr');
  assert.equal(isStructurizrFilePath('includes/model.dsl'), true);
  assert.equal(isDiagramFilePath('workspace.dsl'), true);
});

test('Structurizr workspace sync mirrors includes and preserves the last valid source', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-structurizr-test-'));
  const vaultDir = join(tempRoot, 'vault');
  const mirrorDir = join(tempRoot, 'mirror');
  await mkdir(join(vaultDir, 'includes'), { recursive: true });
  await writeFile(join(vaultDir, 'workspace.dsl'), createStructurizrStarter('workspace.dsl').content);
  await writeFile(join(vaultDir, 'includes', 'model.dsl'), 'model {\n}\n');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const source = await readFile(join(mirrorDir, 'workspace.dsl'), 'utf8').catch(() => '');
    return source.includes('invalid source')
      ? jsonResponse({ success: false, message: 'invalid source' }, 400)
      : jsonResponse({ ok: true });
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempRoot, { force: true, recursive: true });
  });

  const service = new StructurizrWorkspaceService({
    mirrorDir,
    serverUrl: 'http://structurizr.test',
    vaultDir,
  });
  const validSource = await readFile(join(vaultDir, 'workspace.dsl'), 'utf8');

  await service.sync({ content: validSource, rootPath: 'workspace.dsl' });
  assert.equal(await readFile(join(mirrorDir, 'includes/model.dsl'), 'utf8'), 'model {\n}\n');
  assert.equal(await readFile(join(mirrorDir, 'workspace.dsl'), 'utf8'), validSource);

  await assert.rejects(
    service.sync({ content: 'invalid source', rootPath: 'workspace.dsl' }),
    (error) => error.requestCode === 'STRUCTURIZR_DSL_INVALID' && error.statusCode === 422,
  );
  assert.equal(await readFile(join(mirrorDir, 'workspace.dsl'), 'utf8'), validSource);
});

test('Structurizr sync rejects executable DSL in safe mode', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-structurizr-safe-'));
  const vaultDir = join(tempRoot, 'vault');
  const mirrorDir = join(tempRoot, 'mirror');
  await mkdir(vaultDir, { recursive: true });
  await writeFile(join(vaultDir, 'workspace.dsl'), 'workspace "Test" {}\n');

  t.after(() => rm(tempRoot, { force: true, recursive: true }));

  const service = new StructurizrWorkspaceService({
    mirrorDir,
    serverUrl: 'http://structurizr.test',
    vaultDir,
  });

  await assert.rejects(
    service.sync({ content: '!script println("unsafe")', rootPath: 'workspace.dsl' }),
    (error) => error.requestCode === 'STRUCTURIZR_EXECUTABLE_DSL_DISABLED' && error.statusCode === 422,
  );
});
