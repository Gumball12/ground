const USER_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Dana', 'Eve', 'Frank', 'Grace', 'Hank', 'Iris', 'Jack',
  'Kim', 'Leo', 'Maya', 'Nate', 'Olivia', 'Pete', 'Quinn', 'Ruby', 'Sam', 'Tara',
];
const USER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
  '#6366f1', '#10b981', '#f43f5e', '#0ea5e9', '#a855f7',
];
export const USER_NAME_MAX_LENGTH = 24;
const LOCAL_USER_ID_STORAGE_KEY = 'collabmd-user-id';

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function generatePeerId() {
  const array = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateUserId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${generatePeerId()}-${Date.now().toString(36)}`;
}

// A stable peer ID for this browser tab, shared across lobby and per-file sessions.
let _localPeerId = null;
let _localUserId = null;

export function getLocalPeerId() {
  if (!_localPeerId) {
    _localPeerId = generatePeerId();
  }
  return _localPeerId;
}

export function getLocalUserId(storage = globalThis.localStorage) {
  if (_localUserId) {
    return _localUserId;
  }

  try {
    const stored = storage?.getItem?.(LOCAL_USER_ID_STORAGE_KEY);
    if (stored) {
      _localUserId = stored;
      return stored;
    }
  } catch {
    // Ignore storage access errors.
  }

  _localUserId = generateUserId();

  try {
    storage?.setItem?.(LOCAL_USER_ID_STORAGE_KEY, _localUserId);
  } catch {
    // Ignore storage access errors.
  }

  return _localUserId;
}

export function normalizeUserName(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, USER_NAME_MAX_LENGTH);
  return normalized || null;
}

export function createRandomUser(preferredName = null) {
  const color = pickRandom(USER_COLORS);

  return {
    color,
    colorLight: `${color}33`,
    name: normalizeUserName(preferredName) ?? pickRandom(USER_NAMES),
    peerId: getLocalPeerId(),
    userId: getLocalUserId(),
  };
}
