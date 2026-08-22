import { createFileSearchEntry, findFileSearchMatch } from './file-search.js';

const MAX_VISIBLE_RESULTS = 30;

/**
 * CodeMirror autocomplete source for [[wiki-links]].
 *
 * Triggers when the user types `[[` and suggests vault file paths.
 * Completing a suggestion inserts the full `[[path]]` text.
 */

/**
 * Creates a wiki-link completion source.
 *
 * @param {() => string[]} getFileList — returns the current list of vault file paths
 * @returns {import('@codemirror/autocomplete').CompletionSource}
 */
export function wikiLinkCompletions(getFileList) {
  return (context) => {
    // Look backwards from the cursor for `[[` that hasn't been closed
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);

    // Find the last `[[` that isn't already closed with `]]`
    const openIndex = textBefore.lastIndexOf('[[');
    if (openIndex === -1) {
      return null;
    }

    // Check there's no `]]` between the `[[` and the cursor
    const afterOpen = textBefore.slice(openIndex + 2);
    if (afterOpen.includes(']]')) {
      return null;
    }

    const query = afterOpen.trim().toLowerCase().replace(/\s+/gu, ' ');
    const from = line.from + openIndex + 2;
    const entries = getFileList().map((filePath) => createFileSearchEntry(filePath));
    const matches = query
      ? entries
        .map((entry) => ({ entry, match: findFileSearchMatch(entry, query) }))
        .filter(({ match }) => match)
        .sort((left, right) => right.match.score - left.match.score
          || left.entry.lowerPath.localeCompare(right.entry.lowerPath))
      : entries.map((entry) => ({ entry, match: null }));

    const options = matches
      .slice(0, MAX_VISIBLE_RESULTS)
      .map(({ entry }) => ({
        label: entry.filePath,
        displayLabel: entry.filePath.split('/').pop(),
        detail: entry.displayName.slice(0, -entry.fileName.length - 1) || undefined,
        apply: (view, completion, from, to) => {
          // Replace from the query start to cursor, and also consume any trailing `]]`
          let end = to;
          // If there's already a `]]` right after cursor, consume it
          if (view.state.sliceDoc(to, to + 2) === ']]') {
            end = to + 2;
          }
          view.dispatch({
            changes: { from, to: end, insert: `${completion.label}]]` },
            selection: { anchor: from + completion.label.length + 2 },
          });
        },
        type: 'text',
      }));

    if (options.length === 0) {
      return null;
    }

    return {
      from,
      options,
      filter: false, // we already filtered
    };
  };
}
