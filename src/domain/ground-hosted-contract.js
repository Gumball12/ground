export const GROUND_ACCESS_STATES = Object.freeze(['pending', 'active', 'revoked']);

export const GROUND_OPERATION_KINDS = Object.freeze([
  'document_edit',
  'proposal_create',
  'proposal_resolve',
  'access_change',
  'owner_recovery',
]);

export const GROUND_ACTIVITY_SOURCES = Object.freeze([
  'document_editor',
  'webmcp_apply',
  'webmcp_proposal',
  'owner_decision',
  'access_management',
  'system_reconciliation',
]);

export const isGroundDocumentId = (value) => /^[A-Za-z0-9_-]{22}$/u.test(value);

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-')
  .replaceAll('/', '_')
  .replace(/=+$/u, '');

export const createGroundDocumentId = (cryptoImpl = globalThis.crypto) => {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const normalizeGroundDisplayName = (value) => {
  const name = String(value ?? '').trim();
  const containsControlCharacter = Array.from(name).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!name || name.length > 24 || containsControlCharacter) {
    throw new TypeError('Display name must contain 1 to 24 visible characters.');
  }
  return name;
};
