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

// The Ground HTTP failure contract. The server maps a service error to its
// status; the client refuses to surface any code absent from this table.
export const GROUND_ERROR_STATUS = Object.freeze({
  GROUND_FORBIDDEN: 403,
  GROUND_INVALID_REQUEST: 400,
  GROUND_RATE_LIMITED: 429,
  GROUND_STALE_STATE: 409,
  GROUND_TEMPORARILY_UNAVAILABLE: 503,
  GROUND_UNAUTHENTICATED: 401,
  GROUND_UNAVAILABLE: 404,
  GROUND_UPDATE_TOO_LARGE: 413,
});

export const GROUND_LIMIT_CANDIDATES = Object.freeze([64_000, 200_000, 500_000, 1_000_000]);

export const GROUND_COMPACTION_UPDATE_CANDIDATES = Object.freeze([50, 100, 200]);

export const GROUND_MEASUREMENT_RUNS = 10;

export const GROUND_MAX_HYDRATE_MS = 2_000;

export const GROUND_MAX_UPDATE_BYTES_CEILING = 256_000;

// 25% of the 4.5 MB Vercel request body limit.
export const GROUND_MAX_REQUEST_BYTES = 1_125_000;

export const groundP95 = (durations) => {
  if (durations.length === 0) {
    throw new Error('A Ground p95 needs at least one measured duration.');
  }

  const sorted = [...durations].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

export const measureGroundLimits = (documentResults, replayResults = []) => {
  const passing = documentResults.filter(
    (result) => result.passed === true && result.p95HydrateMs <= GROUND_MAX_HYDRATE_MS,
  );
  if (passing.length === 0) {
    throw new Error('No Ground document size candidate met every release target.');
  }

  const maxDocumentBytes = Math.max(...passing.map(({ bytes }) => bytes));
  return Object.freeze({
    compactionUpdateCount: GROUND_COMPACTION_UPDATE_CANDIDATES.find((count) => replayResults.some(
      (replay) => replay.updateCount === count && replay.p95ReplayMs <= GROUND_MAX_HYDRATE_MS,
    )),
    maxDocumentBytes,
    maxUpdateBytes: Math.min(GROUND_MAX_UPDATE_BYTES_CEILING, maxDocumentBytes),
  });
};

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
