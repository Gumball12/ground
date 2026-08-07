import test from 'node:test';
import assert from 'node:assert/strict';

import { createCommentOverview } from '../../src/server/domain/comment-overview.js';

test('createCommentOverview groups summaries by file and sorts by latest message activity', () => {
  const overview = createCommentOverview([
    {
      filePath: 'notes/a.md',
      threads: [{
        anchorEndLine: 2,
        anchorKind: 'line',
        anchorQuote: 'Old quote',
        anchorStartLine: 2,
        createdAt: 10,
        createdByName: 'Ada',
        id: 'thread-old',
        messages: [{ body: 'Older message', createdAt: 20, userName: 'Ada' }],
      }],
    },
    {
      filePath: 'notes/b.md',
      threads: [{
        anchorEndLine: 4,
        anchorKind: 'text',
        anchorQuote: 'New quote',
        anchorStartLine: 3,
        createdAt: 30,
        createdByName: 'Grace',
        id: 'thread-new',
        messages: [
          { body: 'Initial', createdAt: 40, userName: 'Grace' },
          { body: 'Newest reply', createdAt: 80, userName: 'Linus' },
        ],
      }],
    },
  ], { generatedAt: 100 });

  assert.equal(overview.generatedAt, 100);
  assert.equal(overview.totalThreadCount, 2);
  assert.deepEqual(overview.files.map((file) => file.filePath), ['notes/b.md', 'notes/a.md']);
  assert.equal(overview.files[0].threads[0].latestMessage.bodyPreview, 'Newest reply');
  assert.equal(overview.files[0].threads[0].latestActivityAt, 80);
  assert.equal(overview.files[0].threads[0].messageCount, 2);
});

test('createCommentOverview preserves Markdown structure in latest message previews', () => {
  const overview = createCommentOverview([{
    filePath: 'notes/a.md',
    threads: [{
      anchorEndLine: 1,
      anchorKind: 'line',
      anchorStartLine: 1,
      createdAt: 10,
      id: 'thread-markdown',
      messages: [{
        body: 'Summary\n\n- First item\n- Second item',
        createdAt: 20,
      }],
    }],
  }]);

  assert.equal(
    overview.files[0].threads[0].latestMessage.bodyPreview,
    'Summary\n\n- First item\n- Second item',
  );
});

test('createCommentOverview omits resolved and malformed threads', () => {
  const overview = createCommentOverview([
    {
      filePath: 'notes/a.md',
      threads: [
        {
          anchorEndLine: 1,
          anchorKind: 'line',
          anchorStartLine: 1,
          id: 'resolved',
          messages: [{ body: 'Done', createdAt: 1 }],
          resolvedAt: 2,
        },
        {
          anchorEndLine: 2,
          anchorKind: 'line',
          anchorStartLine: 2,
          id: '',
          messages: [{ body: 'Missing id', createdAt: 3 }],
        },
      ],
    },
  ]);

  assert.deepEqual(overview.files, []);
  assert.equal(overview.totalThreadCount, 0);
});
