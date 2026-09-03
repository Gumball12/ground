import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GROUND_ACCESS_STATES,
  GROUND_ACTIVITY_SOURCES,
  GROUND_OPERATION_KINDS,
  createGroundDocumentId,
  isGroundDocumentId,
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
