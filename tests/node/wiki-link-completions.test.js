import test from 'node:test';
import assert from 'node:assert/strict';

import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { wikiLinkCompletions } from '../../src/client/domain/wiki-link-completions.js';
import { resolveWikiTargetPath } from '../../src/domain/wiki-link-resolver.js';

function complete(doc, files) {
  const state = EditorState.create({ doc });
  return wikiLinkCompletions(() => files)(new CompletionContext(state, state.doc.length, true));
}

test('wiki-link completions show the file name and parent path separately', () => {
  const result = complete('[[', ['Bookmarks/Obsidian Observer.md', 'README.md']);

  assert.deepEqual(
    result.options.map(({ label, displayLabel, detail }) => ({ label, displayLabel, detail })),
    [
      {
        label: 'Bookmarks/Obsidian Observer.md',
        displayLabel: 'Obsidian Observer.md',
        detail: 'Bookmarks',
      },
      { label: 'README.md', displayLabel: 'README.md', detail: undefined },
    ],
  );
});

test('wiki-link completions use quick switcher fuzzy matching and ranking', () => {
  const result = complete('[[ab', [
    'a/a/unrelated/deep/folder/b.md',
    `b/a/${'x'.repeat(100)}/b.md`,
    'z/a/b.md',
  ]);

  assert.deepEqual(result.options.map(({ label }) => label), [
    'z/a/b.md',
    'a/a/unrelated/deep/folder/b.md',
  ]);
});

test('wiki-link completions preserve non-Markdown file extensions', () => {
  const files = ['diagram.drawio', 'diagram.excalidraw'];
  const result = complete('[[diagram', files);

  assert.deepEqual(
    result.options.map(({ label, displayLabel }) => ({ label, displayLabel })),
    files.map((file) => ({ label: file, displayLabel: file })),
  );
  assert.deepEqual(
    result.options.map(({ label }) => resolveWikiTargetPath(label, files)),
    files,
  );
});
