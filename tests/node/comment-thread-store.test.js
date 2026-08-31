import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { createCommentThreadSharedType, serializeCommentThreads } from '../../src/domain/comment-threads.js';
import { CommentThreadStore } from '../../src/client/infrastructure/comment-thread-store.js';

function createStoreHarness({ canWrite = () => true } = {}) {
  const doc = new Y.Doc();
  const commentThreads = doc.getArray('comments');
  const ytext = doc.getText('codemirror');
  ytext.insert(0, '# Notes\n\nHello\n');
  const localUserRef = {
    current: {
      color: '#3b82f6',
      name: 'Tester',
      peerId: 'peer-1',
      userId: 'user-1',
    },
  };

  const store = new CommentThreadStore({
    canWrite,
    createAnchor: () => ({
      anchorEnd: { assoc: 0, type: null },
      anchorEndLine: 3,
      anchorKind: 'line',
      anchorQuote: 'Hello',
      anchorStart: { assoc: 0, type: null },
      anchorStartLine: 3,
    }),
    getDoc: () => doc,
    getEditorState: () => null,
    getLocalUser: () => localUserRef.current,
  });
  store.bind({ commentThreads, ydoc: doc, ytext });

  return {
    commentThreads,
    localUserRef,
    store,
  };
}

function seedThread(commentThreads, reactions = []) {
  commentThreads.push([createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorKind: 'line',
    anchorQuote: 'Hello',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 3,
    id: 'thread-1',
    messages: [{
      body: 'Hello comment',
      id: 'comment-1',
      reactions,
      userName: 'Tester',
    }],
  })]);
}

test('toggleCommentReaction adds and removes the local reaction', () => {
  const { commentThreads, store } = createStoreHarness();
  seedThread(commentThreads);

  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '👍'), true);
  let [thread] = serializeCommentThreads(commentThreads);
  assert.equal(thread.messages[0].reactions.length, 1);
  assert.equal(thread.messages[0].reactions[0].emoji, '👍');
  assert.equal(thread.messages[0].reactions[0].users.length, 1);
  assert.equal(thread.messages[0].reactions[0].users[0].userId, 'user-1');

  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '👍'), true);
  [thread] = serializeCommentThreads(commentThreads);
  assert.deepEqual(thread.messages[0].reactions, []);
});

test('toggleCommentReaction aggregates multiple users and removes empty groups', () => {
  const { commentThreads, localUserRef, store } = createStoreHarness();
  seedThread(commentThreads);

  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);
  localUserRef.current = {
    color: '#22c55e',
    name: 'Reviewer',
    peerId: 'peer-2',
    userId: 'user-2',
  };
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);

  let [thread] = serializeCommentThreads(commentThreads);
  assert.equal(thread.messages[0].reactions.length, 1);
  assert.equal(thread.messages[0].reactions[0].users.length, 2);
  assert.deepEqual(thread.messages[0].reactions[0].users.map((user) => user.userId), ['user-1', 'user-2']);

  localUserRef.current = {
    color: '#3b82f6',
    name: 'Tester',
    peerId: 'peer-1',
    userId: 'user-1',
  };
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);
  [thread] = serializeCommentThreads(commentThreads);
  assert.equal(thread.messages[0].reactions[0].users.length, 1);
  assert.equal(thread.messages[0].reactions[0].users[0].userId, 'user-2');

  localUserRef.current = {
    color: '#22c55e',
    name: 'Reviewer',
    peerId: 'peer-2',
    userId: 'user-2',
  };
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);
  [thread] = serializeCommentThreads(commentThreads);
  assert.deepEqual(thread.messages[0].reactions, []);
});

test('document.comment gates create, reply, resolve, and reaction mutations', () => {
  const { commentThreads, store } = createStoreHarness({ canWrite: () => false });
  seedThread(commentThreads);
  const before = serializeCommentThreads(commentThreads);

  assert.equal(store.createCommentThread({ anchor: {}, body: 'Denied' }), null);
  assert.equal(store.replyToCommentThread('thread-1', 'Denied'), null);
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '👍'), false);
  assert.equal(store.deleteCommentThread('thread-1'), false);
  assert.deepEqual(serializeCommentThreads(commentThreads), before);
});
