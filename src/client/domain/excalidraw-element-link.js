import { createFileRouteHash, getHashParamsFromRaw } from './hash-routes.js';
import { normalizeVaultPathInput } from './vault-paths.js';

const MAX_ELEMENT_ID_LENGTH = 256;
const ELEMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;

function normalizeElementId(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= MAX_ELEMENT_ID_LENGTH && ELEMENT_ID_PATTERN.test(normalized)
    ? normalized
    : '';
}

function normalizeUrlPath(value) {
  const normalized = String(value ?? '').trim().replace(/\/+$/u, '');
  return normalized || '/';
}

export function createExcalidrawElementLink(filePath, elementId, {
  appUrl,
  elementType = 'element',
} = {}) {
  const normalizedFilePath = normalizeVaultPathInput(filePath);
  const normalizedElementId = normalizeElementId(elementId);
  if (!normalizedFilePath || !normalizedElementId || !appUrl) {
    return '';
  }

  let url;
  try {
    url = new URL(appUrl);
  } catch {
    return '';
  }

  url.hash = createFileRouteHash(normalizedFilePath, {
    elementId: normalizedElementId,
    elementType,
  });
  return url.toString();
}

export function parseExcalidrawElementLink(link, {
  appPath = '/',
  origin = '',
} = {}) {
  let url;
  try {
    url = new URL(String(link ?? ''), origin || 'http://collabmd.invalid');
  } catch {
    return null;
  }

  if (origin && url.origin !== origin) {
    return null;
  }
  if (normalizeUrlPath(url.pathname) !== normalizeUrlPath(appPath)) {
    return null;
  }

  const params = getHashParamsFromRaw(url.hash);
  const filePath = normalizeVaultPathInput(params.get('file'));
  const elementId = normalizeElementId(params.get('element'));
  if (!filePath || !elementId) {
    return null;
  }

  return {
    elementId,
    elementType: params.get('elementType') === 'group' ? 'group' : 'element',
    filePath,
  };
}
