import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  GROUND_COMPACTION_UPDATE_COUNT,
  GROUND_HOSTED_LIMITS,
  MAX_GROUND_DOCUMENT_BYTES,
  MAX_GROUND_UPDATE_BYTES,
} from '../../../src/domain/ground-hosted-contract.js';

// A deployment that forgets one of these silently loses a safety boundary: no
// update limit fails every mutation closed, no document limit accepts an
// unbounded document, and no compaction threshold lets replay grow forever.
test('the hosted limits carry every value the runtime enforces', () => {
  assert.deepEqual(GROUND_HOSTED_LIMITS, {
    compactionUpdateCount: GROUND_COMPACTION_UPDATE_COUNT,
    maxDocumentBytes: MAX_GROUND_DOCUMENT_BYTES,
    maxUpdateBytes: MAX_GROUND_UPDATE_BYTES,
  });
  for (const [name, value] of Object.entries(GROUND_HOSTED_LIMITS)) {
    assert.ok(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  }
  assert.ok(Object.isFrozen(GROUND_HOSTED_LIMITS));
});

test('the deployed function injects the hosted limits', async () => {
  const source = await readFile(resolve(process.cwd(), 'api/ground.js'), 'utf8');

  assert.match(source, /GROUND_HOSTED_LIMITS/u);
  assert.match(source, /limits: GROUND_HOSTED_LIMITS/u);
});
