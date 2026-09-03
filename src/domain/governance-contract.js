export const GOVERNANCE_CAPABILITIES = Object.freeze([
  'document.read',
  'document.suggest',
  'document.edit',
  'conflict.resolve',
  'grant.manage',
]);

export const hasCapability = (manifest, roleId, capability) => (
  manifest.roles[roleId]?.includes(capability) === true
);
