import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOVERNANCE_CAPABILITIES,
  hasCapability,
} from '../../src/domain/governance-contract.js';
import { validateGovernanceManifest } from '../../src/server/config/governance-manifest.js';

test('default roles expose only the approved capabilities', () => {
  const manifest = validateGovernanceManifest({
    defaultGrantMinutes: 60,
    roles: {
      owner: [...GOVERNANCE_CAPABILITIES],
      editor: ['document.read', 'document.comment', 'document.suggest', 'document.edit'],
      reviewer: ['document.read', 'document.comment', 'document.suggest'],
    },
  });

  assert.equal(hasCapability(manifest, 'reviewer', 'document.edit'), false);
  assert.equal(hasCapability(manifest, 'editor', 'document.edit'), true);
});

test('manifest validation rejects unknown capabilities', () => {
  assert.throws(
    () => validateGovernanceManifest({ defaultGrantMinutes: 60, roles: { owner: ['document.destroy'] } }),
    /Unknown governance capability/,
  );
});
