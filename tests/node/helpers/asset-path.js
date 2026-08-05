import assert from 'node:assert/strict';

export function extractAssetPath(html, pattern, label) {
  const match = String(html || '').match(pattern);
  assert.ok(match, `expected ${label} asset path`);
  return match[1];
}
