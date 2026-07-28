const DEFAULT_DIAGNOSTIC_LIMIT = 500;

const ALLOWED_DETAIL_KEYS = new Set([
  'action',
  'canWrite',
  'connectionState',
  'elementCount',
  'fileCount',
  'generation',
  'hasPendingWrites',
  'outcome',
  'previousState',
  'reason',
  'sceneHash',
  'state',
  'tombstoneCount',
]);

function normalizeDetailValue(value) {
  if (typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function hashString(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function summarizeExcalidrawScene(scene = {}) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const files = scene?.files && typeof scene.files === 'object' ? scene.files : {};
  const signature = elements
    .map((element) => [
      element?.id || '',
      element?.type || '',
      Number(element?.version) || 0,
      Number(element?.versionNonce) || 0,
      element?.isDeleted ? 1 : 0,
      element?.fileId || '',
    ].join(':'))
    .sort()
    .join('|');

  return {
    elementCount: elements.length,
    fileCount: Object.keys(files).length,
    sceneHash: hashString(signature),
    tombstoneCount: elements.filter((element) => element?.isDeleted).length,
  };
}

export function createExcalidrawDiagnosticRing({
  enabled = false,
  limit = DEFAULT_DIAGNOSTIC_LIMIT,
  now = () => performance.now(),
} = {}) {
  const entries = [];
  const normalizedLimit = Math.max(1, Number(limit) || DEFAULT_DIAGNOSTIC_LIMIT);
  let sequence = 0;

  function record(event, details = {}) {
    if (!enabled) {
      return null;
    }

    const entry = {
      event: String(event || 'unknown'),
      sequence: ++sequence,
      timestampMs: Math.round(Number(now()) || 0),
    };

    Object.entries(details).forEach(([key, value]) => {
      if (!ALLOWED_DETAIL_KEYS.has(key)) {
        return;
      }

      const normalizedValue = normalizeDetailValue(value);
      if (normalizedValue !== undefined) {
        entry[key] = normalizedValue;
      }
    });

    entries.push(entry);
    if (entries.length > normalizedLimit) {
      entries.splice(0, entries.length - normalizedLimit);
    }
    return entry;
  }

  return {
    clear() {
      entries.length = 0;
    },
    enabled: Boolean(enabled),
    exportTrace() {
      return entries.map((entry) => ({ ...entry }));
    },
    record,
  };
}
