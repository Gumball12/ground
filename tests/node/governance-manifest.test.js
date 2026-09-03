import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadGovernanceManifest,
  validateGovernanceManifest,
} from '../../src/server/config/governance-manifest.js';

const validManifest = {
  roles: {
    owner: [
      'document.read',
      'document.suggest',
      'document.edit',
      'conflict.resolve',
      'grant.manage',
    ],
    editor: ['document.read', 'document.suggest', 'document.edit'],
    reviewer: ['document.read', 'document.suggest'],
  },
};

test('manifest validation rejects incomplete Owner roles and removed grant duration', () => {
  assert.throws(
    () => validateGovernanceManifest({ ...validManifest, roles: { owner: ['grant.manage'] } }),
    /Owner role must include/,
  );
  assert.throws(
    () => validateGovernanceManifest({ ...validManifest, defaultGrantMinutes: 60 }),
    /defaultGrantMinutes is not supported/,
  );
});

test('manifest validation rejects removed comment capability', () => {
  assert.throws(
    () => validateGovernanceManifest({
      roles: { ...validManifest.roles, reviewer: ['document.read', 'document.comment'] },
    }),
    /Unknown governance capability: document\.comment/,
  );
});

test('manifest validation rejects empty and duplicate Role capabilities', () => {
  assert.throws(
    () => validateGovernanceManifest({ ...validManifest, roles: { ...validManifest.roles, reviewer: [] } }),
    /at least one capability/,
  );
  assert.throws(
    () => validateGovernanceManifest({ ...validManifest, roles: { ...validManifest.roles, reviewer: ['document.read', 'document.read'] } }),
    /Duplicate governance capability/,
  );
});

test('loadGovernanceManifest parses and validates its requested file', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'collabmd-governance-'));
  await writeFile(join(cwd, 'roles.json'), JSON.stringify(validManifest));

  const manifest = await loadGovernanceManifest({ cwd, fileName: 'roles.json' });

  assert.deepEqual(manifest, validManifest);
});
