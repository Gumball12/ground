import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDocumentMode,
} from '../../src/client/domain/excalidraw-scene.js';

test('normalizeDocumentMode maps unknown values to edit', () => {
  assert.equal(normalizeDocumentMode('preview'), 'preview');
  assert.equal(normalizeDocumentMode('edit'), 'edit');
  assert.equal(normalizeDocumentMode('other'), 'edit');
  assert.equal(normalizeDocumentMode(undefined), 'edit');
});
