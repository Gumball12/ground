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

    const query = afterOpen.toLowerCase();
    const from = line.from + openIndex + 2;
    const files = getFileList();

    // Build completion options: show file paths without .md extension
    const options = files
      .map((filePath) => {
        const label = filePath.replace(/\.md$/i, '');
        // Match against full path and just the filename
        const fileName = label.split('/').pop();
        return { filePath, label, fileName };
      })
      .filter(({ label, fileName }) =>
        label.toLowerCase().includes(query) || fileName.toLowerCase().includes(query),
      )
      .map(({ label, fileName }) => ({
        label,
        // Show just the filename as detail when in a subdirectory
        detail: label.includes('/') ? `  ${fileName}` : undefined,
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
