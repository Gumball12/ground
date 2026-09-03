import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { GOVERNANCE_CAPABILITIES } from '../../domain/governance-contract.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const validateGovernanceManifest = (manifest) => {
  if (!isObject(manifest) || !isObject(manifest.roles)) {
    throw new TypeError('Governance manifest must be an object with roles.');
  }

  if (Object.hasOwn(manifest, 'defaultGrantMinutes')) {
    throw new TypeError('defaultGrantMinutes is not supported by the focused governance manifest.');
  }

  if (!Object.hasOwn(manifest.roles, 'owner')) {
    throw new TypeError('Governance manifest must define an owner role.');
  }

  for (const [roleId, capabilities] of Object.entries(manifest.roles)) {
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      throw new TypeError(`Governance role ${roleId} must include at least one capability.`);
    }

    const seenCapabilities = new Set();
    for (const capability of capabilities) {
      if (!GOVERNANCE_CAPABILITIES.includes(capability)) {
        throw new TypeError(`Unknown governance capability: ${capability}.`);
      }
      if (seenCapabilities.has(capability)) {
        throw new TypeError(`Duplicate governance capability: ${capability}.`);
      }
      seenCapabilities.add(capability);
    }
  }

  const ownerCapabilities = new Set(manifest.roles.owner);
  for (const capability of GOVERNANCE_CAPABILITIES) {
    if (!ownerCapabilities.has(capability)) {
      throw new TypeError(`Owner role must include ${capability}.`);
    }
  }

  return manifest;
};

export const loadGovernanceManifest = async ({ cwd, fileName = 'collabmd.governance.json' }) => (
  validateGovernanceManifest(JSON.parse(await readFile(resolve(cwd, fileName), 'utf8')))
);
