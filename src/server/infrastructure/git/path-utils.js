import { createRequestError as createGitRequestError } from '../http/http-errors.js';

export function decodeQuotedPath(pathValue) {
  const rawValue = String(pathValue ?? '').trim();
  if (!(rawValue.startsWith('"') && rawValue.endsWith('"'))) {
    return rawValue;
  }

  return rawValue
    .slice(1, -1)
    .replace(/\\([\\"])/g, '$1')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\([0-7]{3})/g, (_match, value) => String.fromCharCode(Number.parseInt(value, 8)));
}

export function normalizeRelativeGitPath(pathValue) {
  const normalized = decodeQuotedPath(pathValue)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/u, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw createGitRequestError(400, 'Missing path parameter');
  }

  if (normalized.some((segment) => segment === '.' || segment === '..')) {
    throw createGitRequestError(400, 'Invalid path parameter');
  }

  return normalized.join('/');
}


export function stripDiffPrefix(pathValue) {
  const normalizedPath = String(pathValue ?? '').replace(/\s+$/u, '');
  if (!normalizedPath || normalizedPath === '/dev/null') {
    return null;
  }

  if (normalizedPath.startsWith('a/') || normalizedPath.startsWith('b/')) {
    return normalizedPath.slice(2);
  }

  return normalizedPath;
}
