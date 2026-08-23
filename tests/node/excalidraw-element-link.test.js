import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExcalidrawElementLink,
  parseExcalidrawElementLink,
} from '../../src/client/domain/excalidraw-element-link.js';

test('creates a same-origin link for an Excalidraw element', () => {
  const link = createExcalidrawElementLink('diagrams/target.excalidraw', 'node-1', {
    appUrl: 'http://localhost:4173/',
  });

  assert.equal(
    link,
    'http://localhost:4173/#file=diagrams%2Ftarget.excalidraw&element=node-1',
  );
});

test('creates and parses group element links', () => {
  const link = createExcalidrawElementLink('diagrams/target.excalidraw', 'group-1', {
    appUrl: 'http://localhost:4173/collabmd',
    elementType: 'group',
  });

  assert.deepEqual(
    parseExcalidrawElementLink(link, {
      appPath: '/collabmd',
      origin: 'http://localhost:4173',
    }),
    {
      elementId: 'group-1',
      elementType: 'group',
      filePath: 'diagrams/target.excalidraw',
    },
  );
});

test('rejects external, malformed, and traversal element links', () => {
  const options = {
    appPath: '/',
    origin: 'http://localhost:4173',
  };

  assert.equal(
    parseExcalidrawElementLink(
      'https://example.com/#file=target.excalidraw&element=node-1',
      options,
    ),
    null,
  );
  assert.equal(
    parseExcalidrawElementLink(
      'http://localhost:4173/#file=../target.excalidraw&element=node-1',
      options,
    ),
    null,
  );
  assert.equal(
    parseExcalidrawElementLink(
      'http://localhost:4173/#file=target.excalidraw&element=',
      options,
    ),
    null,
  );
});
