import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStatusOutput, parseUnifiedDiff } from '../../src/server/infrastructure/git/parsers.js';
import { normalizeRelativeGitPath } from '../../src/server/infrastructure/git/path-utils.js';

test('normalizeRelativeGitPath trims and rejects traversal', () => {
  assert.equal(normalizeRelativeGitPath(' docs/guide.md '), 'docs/guide.md');
  assert.equal(normalizeRelativeGitPath('"BFI - Biller/sample flow.puml"'), 'BFI - Biller/sample flow.puml');
  assert.throws(
    () => normalizeRelativeGitPath('../secrets.txt'),
    /Invalid path parameter/,
  );
});

test('parseStatusOutput groups staged, working tree, and untracked files', () => {
  const output = [
    '## main...origin/main [ahead 1]',
    'A  staged.md',
    ' M tracked.md',
    'R  new -> name.md',
    'old name.md',
    '?? scratch\nnotes.md',
    '',
  ].join('\0');

  const parsed = parseStatusOutput(output);

  assert.equal(parsed.branch.name, 'main');
  assert.equal(parsed.branch.upstream, 'origin/main');
  assert.equal(parsed.branch.ahead, 1);
  assert.deepEqual(
    parsed.sections.staged.map((file) => ({ oldPath: file.oldPath, path: file.path, status: file.status })),
    [
      { oldPath: null, path: 'staged.md', status: 'added' },
      { oldPath: 'old name.md', path: 'new -> name.md', status: 'renamed' },
    ],
  );
  assert.deepEqual(
    parsed.sections['working-tree'].map((file) => ({ path: file.path, status: file.status })),
    [
      { path: 'tracked.md', status: 'modified' },
    ],
  );
  assert.deepEqual(
    parsed.sections.untracked.map((file) => ({ path: file.path, status: file.status })),
    [
      { path: 'scratch\nnotes.md', status: 'untracked' },
    ],
  );
});

test('parseUnifiedDiff preserves rename metadata and hunk line numbers', () => {
  const diffText = [
    'diff --git a/old.md b/new.md',
    'similarity index 90%',
    'rename from old.md',
    'rename to new.md',
    '--- a/old.md',
    '+++ b/new.md',
    '@@ -1,2 +1,2 @@ Heading',
    ' line 1',
    '-line 2',
    '+line 2 updated',
  ].join('\n');

  const [file] = parseUnifiedDiff(diffText);

  assert.equal(file.status, 'renamed');
  assert.equal(file.oldPath, 'old.md');
  assert.equal(file.path, 'new.md');
  assert.equal(file.stats.deletions, 1);
  assert.equal(file.stats.additions, 1);
  assert.deepEqual(
    file.hunks[0].lines.map((line) => ({
      newLine: line.newLine,
      oldLine: line.oldLine,
      type: line.type,
    })),
    [
      { newLine: 1, oldLine: 1, type: 'context' },
      { newLine: null, oldLine: 2, type: 'deletion' },
      { newLine: 2, oldLine: null, type: 'addition' },
    ],
  );
});
