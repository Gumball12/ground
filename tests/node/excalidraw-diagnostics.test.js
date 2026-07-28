import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExcalidrawDiagnosticRing,
  summarizeExcalidrawScene,
} from '../../src/client/domain/excalidraw-diagnostics.js';

test('Excalidraw diagnostics retain only the bounded allowlisted event metadata', () => {
  let now = 0;
  const diagnostics = createExcalidrawDiagnosticRing({
    enabled: true,
    limit: 2,
    now: () => ++now,
  });

  diagnostics.record('first', { filePath: 'secret.excalidraw', state: 'connecting', text: 'private' });
  diagnostics.record('second', { elementCount: 3, userName: 'Andes' });
  diagnostics.record('third', { hasPendingWrites: true, payload: { secret: true } });

  assert.deepEqual(diagnostics.exportTrace(), [
    {
      elementCount: 3,
      event: 'second',
      sequence: 2,
      timestampMs: 2,
    },
    {
      event: 'third',
      hasPendingWrites: true,
      sequence: 3,
      timestampMs: 3,
    },
  ]);
});

test('Excalidraw scene diagnostics summarize structure without retaining scene content', () => {
  const summary = summarizeExcalidrawScene({
    elements: [
      { id: 'shape-a', isDeleted: false, text: 'private label', type: 'text', version: 1, versionNonce: 10 },
      { id: 'shape-b', isDeleted: true, type: 'rectangle', version: 2, versionNonce: 20 },
    ],
    files: {
      image: { dataURL: 'data:image/png;base64,private' },
    },
  });

  assert.match(summary.sceneHash, /^[a-f0-9]{8}$/u);
  assert.deepEqual(summary, {
    elementCount: 2,
    fileCount: 1,
    sceneHash: summary.sceneHash,
    tombstoneCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(summary), /private/u);
});
