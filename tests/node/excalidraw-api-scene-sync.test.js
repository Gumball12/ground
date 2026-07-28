import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applySceneUpdateWithFiles,
  buildExcalidrawFileSyncPlan,
  hasBinaryFilePayloadConflict,
} from '../../src/client/domain/excalidraw-api-scene-sync.js';

const DATA_URL_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zt9kAAAAASUVORK5CYII=';
const DATA_URL_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAusB9Y9l9PAAAAAASUVORK5CYII=';

function createBinaryFile(id, {
  dataURL = DATA_URL_A,
  version = 1,
} = {}) {
  return {
    created: 1_710_000_000_000,
    dataURL,
    id,
    mimeType: 'image/png',
    version,
  };
}

test('hasBinaryFilePayloadConflict detects version or dataURL changes for the same file id', () => {
  assert.equal(
    hasBinaryFilePayloadConflict(createBinaryFile('file-1'), createBinaryFile('file-1')),
    false,
  );
  assert.equal(
    hasBinaryFilePayloadConflict(createBinaryFile('file-1'), createBinaryFile('file-1', { version: 2 })),
    true,
  );
  assert.equal(
    hasBinaryFilePayloadConflict(createBinaryFile('file-1'), createBinaryFile('file-1', { dataURL: DATA_URL_B })),
    true,
  );
});

test('buildExcalidrawFileSyncPlan separates missing files from same-id payload conflicts', () => {
  const syncPlan = buildExcalidrawFileSyncPlan({
    existing: createBinaryFile('existing'),
    replaced: createBinaryFile('replaced'),
  }, {
    existing: createBinaryFile('existing'),
    missing: createBinaryFile('missing'),
    replaced: createBinaryFile('replaced', { dataURL: DATA_URL_B }),
  });

  assert.deepEqual(syncPlan.missingFiles.map((file) => file.id), ['missing']);
  assert.deepEqual(syncPlan.conflictingFileIds, ['replaced']);
  assert.equal(syncPlan.requiresFileReplacement, true);
});

test('applySceneUpdateWithFiles adds missing files before applying the scene update', () => {
  const calls = [];
  const api = {
    addFiles(files) {
      calls.push(['addFiles', files.map((file) => file.id)]);
      this.files = Object.fromEntries(files.map((file) => [file.id, file]));
    },
    files: {},
    getFiles() {
      return this.files;
    },
    updateScene(payload) {
      calls.push(['updateScene', payload]);
    },
  };

  const result = applySceneUpdateWithFiles(api, {
    captureUpdate: 'capture-now',
    files: {
      imageA: createBinaryFile('imageA'),
    },
    sceneUpdate: {
      appState: { viewBackgroundColor: '#ffffff' },
      elements: [{ id: 'image-element', fileId: 'imageA', status: 'saved', type: 'image' }],
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.requiresRemount, false);
  assert.deepEqual(calls[0], ['addFiles', ['imageA']]);
  assert.deepEqual(calls[1], ['updateScene', {
    appState: { viewBackgroundColor: '#ffffff' },
    captureUpdate: 'capture-now',
    elements: [{ id: 'image-element', fileId: 'imageA', status: 'saved', type: 'image' }],
  }]);
});

test('applySceneUpdateWithFiles refuses same-id payload replacement and reports a remount requirement', () => {
  const conflicts = [];
  let updateSceneCalls = 0;
  const api = {
    addFiles() {
      throw new Error('addFiles should not be called when remount is required');
    },
    getFiles() {
      return {
        imageA: createBinaryFile('imageA'),
      };
    },
    updateScene() {
      updateSceneCalls += 1;
    },
  };

  const result = applySceneUpdateWithFiles(api, {
    captureUpdate: 'capture-now',
    files: {
      imageA: createBinaryFile('imageA', { dataURL: DATA_URL_B }),
    },
    sceneUpdate: {
      appState: { viewBackgroundColor: '#ffffff' },
      elements: [{ id: 'image-element', fileId: 'imageA', status: 'saved', type: 'image' }],
    },
  }, {
    onFileConflict: ({ conflictingFileIds }) => {
      conflicts.push(...conflictingFileIds);
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.requiresRemount, true);
  assert.deepEqual(result.conflictingFileIds, ['imageA']);
  assert.deepEqual(conflicts, ['imageA']);
  assert.equal(updateSceneCalls, 0);
});

test('applySceneUpdateWithFiles replaces the authoritative file map without remounting when supported', () => {
  const calls = [];
  const nextFile = createBinaryFile('imageA', { dataURL: DATA_URL_B, version: 2 });
  const api = {
    getFiles() {
      return { imageA: createBinaryFile('imageA') };
    },
    replaceFiles(files) {
      calls.push(['replaceFiles', files]);
    },
    updateScene(payload) {
      calls.push(['updateScene', payload]);
    },
  };

  const result = applySceneUpdateWithFiles(api, {
    captureUpdate: 'never',
    files: { imageA: nextFile },
    sceneUpdate: { elements: [{ fileId: 'imageA', id: 'image-element', type: 'image' }] },
  });

  assert.equal(result.applied, true);
  assert.equal(result.requiresRemount, false);
  assert.deepEqual(calls[0], ['replaceFiles', [nextFile]]);
  assert.deepEqual(calls[1], ['updateScene', {
    captureUpdate: 'never',
    elements: [{ fileId: 'imageA', id: 'image-element', type: 'image' }],
  }]);
});
