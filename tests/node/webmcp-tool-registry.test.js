import assert from 'node:assert/strict';
import test from 'node:test';

import { WebMcpToolRegistry } from '../../src/client/infrastructure/webmcp-tool-registry.js';

function createModelContext() {
  const tools = new Map();
  return {
    tools,
    async registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    },
  };
}

test('WebMCP tools edit only an active synchronized supported document', async () => {
  const modelContext = createModelContext();
  const active = true;
  let content = '# Notes\n\nHello world\n';
  let path = 'README.md';
  let synchronized = false;
  const session = {
    applyTextReplacements(replacements) {
      for (const replacement of replacements) {
        content = content.replace(replacement.oldText, replacement.newText);
      }
      return replacements.length;
    },
    getText: () => content,
    isInitialSyncComplete: () => synchronized,
  };
  const registry = new WebMcpToolRegistry({
    getActiveFilePath: () => path,
    getIsTabActive: () => active,
    getSession: () => session,
    modelContext,
  });

  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);

  synchronized = true;
  assert.equal(await registry.refresh(), true);
  const readTool = modelContext.tools.get('collabmd_read_active_document');
  const editTool = modelContext.tools.get('collabmd_apply_text_edits');
  const snapshot = await readTool.execute({});

  assert.deepEqual(
    { content: snapshot.content, kind: snapshot.kind, path: snapshot.path },
    { content, kind: 'markdown', path },
  );
  const result = await editTool.execute({
    path,
    replacements: [{ newText: 'Hello agent', oldText: 'Hello world' }],
    revision: snapshot.revision,
  });
  assert.equal(content, '# Notes\n\nHello agent\n');
  assert.equal(result.replacementCount, 1);
  await assert.rejects(
    editTool.execute({
      path,
      replacements: [{ newText: 'Stale edit', oldText: 'Hello agent' }],
      revision: snapshot.revision,
    }),
    /changed; read it again/,
  );

  path = 'drawing.excalidraw';
  assert.equal(await registry.refresh(), false);
  assert.equal(modelContext.tools.size, 0);

});
