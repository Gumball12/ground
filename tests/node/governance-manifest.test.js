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
  defaultGrantMinutes: 60,
  roles: {
    owner: [
      'document.read',
      'document.comment',
      'document.suggest',
      'document.edit',
      'conflict.resolve',
      'grant.manage',
    ],
    reviewer: ['document.read'],
  },
};

test('manifest validation rejects incomplete Owner roles and invalid grants', () => {
  assert.throws(
    () => validateGovernanceManifest({ ...validManifest, roles: { owner: ['grant.manage'] } }),
    /Owner role must include/,
  );
  assert.throws(
    () => validateGovernanceManifest({ ...validManifest, defaultGrantMinutes: 0 }),
    /defaultGrantMinutes/,
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
