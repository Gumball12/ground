import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GROUND_ACCESS_STATES,
  GROUND_ACTIVITY_SOURCES,
  GROUND_COMPACTION_UPDATE_CANDIDATES,
  GROUND_ERROR_STATUS,
  GROUND_LIMIT_CANDIDATES,
  GROUND_OPERATION_KINDS,
  createGroundDocumentId,
  groundP95,
  isGroundDocumentId,
  measureGroundLimits,
  normalizeGroundDisplayName,
} from '../../src/domain/ground-hosted-contract.js';

test('creates a 22-character URL-safe document id', () => {
  assert.match(createGroundDocumentId(), /^[A-Za-z0-9_-]{22}$/u);
});

test('recognizes only 22-character URL-safe document ids', () => {
  assert.equal(isGroundDocumentId('Abcdefghijklmnopqrstu_'), true);
  assert.equal(isGroundDocumentId('short'), false);
  assert.equal(isGroundDocumentId('Abcdefghijklmnopqrstu='), false);
});

test('normalizes a non-empty display name up to 24 characters', () => {
  assert.equal(normalizeGroundDisplayName('  Writer Agent  '), 'Writer Agent');
  assert.throws(() => normalizeGroundDisplayName(''));
  assert.throws(() => normalizeGroundDisplayName('x'.repeat(25)));
  assert.throws(() => normalizeGroundDisplayName('bad\u0000name'));
});

test('exposes the Ground document size and compaction candidates', () => {
  assert.deepEqual(GROUND_LIMIT_CANDIDATES, [64_000, 200_000, 500_000, 1_000_000]);
  assert.deepEqual(GROUND_COMPACTION_UPDATE_CANDIDATES, [50, 100, 200]);
});

test('reports the nearest-rank p95 of measured durations', () => {
  assert.equal(groundP95([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]), 1000);
  assert.equal(groundP95([900, 100, 200]), 900);
  assert.equal(groundP95([42]), 42);
  assert.throws(() => groundP95([]), /duration/u);
});

test('selects the largest candidate meeting every release target', () => {
  const result = measureGroundLimits([
    { bytes: 64_000, p95HydrateMs: 300, passed: true },
    { bytes: 200_000, p95HydrateMs: 900, passed: true },
    { bytes: 500_000, p95HydrateMs: 2400, passed: false },
  ]);

  assert.equal(result.maxDocumentBytes, 200_000);
});

test('excludes a candidate whose p95 hydrate exceeds the release target', () => {
  const result = measureGroundLimits([
    { bytes: 64_000, p95HydrateMs: 300, passed: true },
    { bytes: 200_000, p95HydrateMs: 2001, passed: true },
  ]);

  assert.equal(result.maxDocumentBytes, 64_000);
});

test('caps the update limit at 256000 bytes without exceeding the document limit', () => {
  assert.equal(measureGroundLimits([
    { bytes: 1_000_000, p95HydrateMs: 1200, passed: true },
  ]).maxUpdateBytes, 256_000);
  assert.equal(measureGroundLimits([
    { bytes: 64_000, p95HydrateMs: 300, passed: true },
  ]).maxUpdateBytes, 64_000);
});

test('selects the first compaction count whose replay stays within the target', () => {
  const result = measureGroundLimits(
    [{ bytes: 200_000, p95HydrateMs: 900, passed: true }],
    [
      { p95ReplayMs: 2400, updateCount: 50 },
      { p95ReplayMs: 1800, updateCount: 100 },
      { p95ReplayMs: 900, updateCount: 200 },
    ],
  );

  assert.equal(result.compactionUpdateCount, 100);
});

test('leaves the compaction count unset when no replay measurement qualifies', () => {
  const result = measureGroundLimits([{ bytes: 200_000, p95HydrateMs: 900, passed: true }]);

  assert.equal(result.compactionUpdateCount, undefined);
});

test('refuses to select limits when no candidate passes', () => {
  assert.throws(() => measureGroundLimits([
    { bytes: 64_000, p95HydrateMs: 300, passed: false },
  ]), /candidate/u);
  assert.throws(() => measureGroundLimits([]), /candidate/u);
});

test('exposes the Ground access, operation, and activity vocabularies', () => {
  assert.deepEqual(GROUND_ACCESS_STATES, ['pending', 'active', 'revoked']);
  assert.deepEqual(GROUND_OPERATION_KINDS, [
    'document_edit',
    'proposal_create',
    'proposal_resolve',
    'access_change',
    'owner_recovery',
  ]);
  assert.deepEqual(GROUND_ACTIVITY_SOURCES, [
    'document_editor',
    'webmcp_apply',
    'webmcp_proposal',
    'owner_decision',
    'access_management',
    'system_reconciliation',
  ]);
});

test('exposes the shared Ground error code to HTTP status contract', () => {
  assert.deepEqual({ ...GROUND_ERROR_STATUS }, {
    GROUND_FORBIDDEN: 403,
    GROUND_INVALID_REQUEST: 400,
    GROUND_RATE_LIMITED: 429,
    GROUND_STALE_STATE: 409,
    GROUND_TEMPORARILY_UNAVAILABLE: 503,
    GROUND_UNAUTHENTICATED: 401,
    GROUND_UNAVAILABLE: 404,
    GROUND_UPDATE_TOO_LARGE: 413,
  });
  assert.equal(Object.isFrozen(GROUND_ERROR_STATUS), true);
});
