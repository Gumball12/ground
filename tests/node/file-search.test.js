import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileSearchEntry, findFileSearchMatch } from '../../src/client/domain/file-search.js';

test('file search ranks direct file-name matches above path and fuzzy matches', () => {
  const query = 'guide';
  const scores = [
    'archive/guide.md',
    'guide/archive.md',
    'g/u/i/d/e.md',
  ].map((path) => findFileSearchMatch(createFileSearchEntry(path), query)?.score ?? 0);

  assert.ok(scores[0] > scores[1]);
  assert.ok(scores[1] > scores[2]);
});

test('file search matches compact fuzzy paths', () => {
  assert.ok(findFileSearchMatch(createFileSearchEntry('notes/api/backlog.md'), 'ab'));
  assert.equal(findFileSearchMatch(createFileSearchEntry('notes/readme.md'), 'xyz'), null);
});
