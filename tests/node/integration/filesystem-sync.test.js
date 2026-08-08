import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { WORKSPACE_ROOM_NAME } from '../../../src/domain/workspace-room.js';
import { startTestServer, waitForCondition } from '../helpers/test-server.js';
import { waitForProviderSync } from '../helpers/collaboration-protocol.js';

function createProvider(app, roomName, ydoc) {
  return new WebsocketProvider(`ws://127.0.0.1:${app.port}${app.server.config.wsBasePath}`, roomName, ydoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
}

function emitWatchEvents(app, ...paths) {
  paths.forEach((pathValue) => {
    app.server.fileSystemSyncService.handleWatchEvent('rename', pathValue);
  });
}

test('external markdown writes are merged into active document rooms', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const roomDoc = new Y.Doc();
  const provider = createProvider(app, 'test.md', roomDoc);
  t.after(() => {
    provider.destroy();
    roomDoc.destroy();
  });

  await waitForProviderSync(provider);
  assert.match(roomDoc.getText('codemirror').toString(), /Hello from test vault/);

  await writeFile(join(app.vaultDir, 'test.md'), '# Test\n\nUpdated externally.\n', 'utf8');
  emitWatchEvents(app, 'test.md');

  await waitForCondition(() => {
    const content = roomDoc.getText('codemirror').toString();
    return content.includes('Updated externally.') ? content : null;
  });
});

test('external renames update workspace entries and preserve active rooms under the new path', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const fileDoc = new Y.Doc();
  const workspaceDoc = new Y.Doc();
  const fileProvider = createProvider(app, 'test.md', fileDoc);
  const workspaceProvider = createProvider(app, WORKSPACE_ROOM_NAME, workspaceDoc);
  t.after(() => {
    fileProvider.destroy();
    workspaceProvider.destroy();
    fileDoc.destroy();
    workspaceDoc.destroy();
  });

  await Promise.all([waitForProviderSync(fileProvider), waitForProviderSync(workspaceProvider)]);

  await mkdir(join(app.vaultDir, 'docs'), { recursive: true });
  await rename(join(app.vaultDir, 'test.md'), join(app.vaultDir, 'docs', 'renamed.md'));
  emitWatchEvents(app, 'test.md', 'docs/renamed.md');

  await waitForCondition(() => {
    const entries = workspaceDoc.getMap('entries').toJSON();
    return entries['docs/renamed.md'] && !entries['test.md'] ? true : null;
  });

  await waitForCondition(() => {
    const events = workspaceDoc.getArray('events').toArray();
    return events.some((event) => event.workspaceChange?.renamedPaths?.some?.((entry) => (
      entry.oldPath === 'test.md' && entry.newPath === 'docs/renamed.md'
    ))) ? true : null;
  });

  assert.equal(app.server.roomRegistry.get('test.md'), undefined);
  assert.notEqual(app.server.roomRegistry.get('docs/renamed.md'), undefined);
});

test('external renames avoid a full workspace rescan for small rename events', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const workspaceDoc = new Y.Doc();
  const workspaceProvider = createProvider(app, WORKSPACE_ROOM_NAME, workspaceDoc);
  t.after(() => {
    workspaceProvider.destroy();
    workspaceDoc.destroy();
  });

  await waitForProviderSync(workspaceProvider);

  let scanCalls = 0;
  const originalScanWorkspaceState = app.server.vaultFileStore.scanWorkspaceState.bind(app.server.vaultFileStore);
  app.server.vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    return originalScanWorkspaceState(...args);
  };

  await mkdir(join(app.vaultDir, 'docs'), { recursive: true });
  await rename(join(app.vaultDir, 'test.md'), join(app.vaultDir, 'docs', 'renamed.md'));
  emitWatchEvents(app, 'test.md', 'docs/renamed.md');

  await waitForCondition(() => {
    const entries = workspaceDoc.getMap('entries').toJSON();
    return entries['docs/renamed.md'] && !entries['test.md'] ? true : null;
  });

  assert.equal(scanCalls, 0);
});

test('external deletes remove active rooms and drop workspace entries', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const fileDoc = new Y.Doc();
  const workspaceDoc = new Y.Doc();
  const fileProvider = createProvider(app, 'test.md', fileDoc);
  const workspaceProvider = createProvider(app, WORKSPACE_ROOM_NAME, workspaceDoc);
  t.after(() => {
    fileProvider.destroy();
    workspaceProvider.destroy();
    fileDoc.destroy();
    workspaceDoc.destroy();
  });

  await Promise.all([waitForProviderSync(fileProvider), waitForProviderSync(workspaceProvider)]);

  await rm(join(app.vaultDir, 'test.md'));
  emitWatchEvents(app, 'test.md');

  await waitForCondition(() => app.server.roomRegistry.get('test.md') === undefined);
  await waitForCondition(() => {
    const entries = workspaceDoc.getMap('entries').toJSON();
    return entries['test.md'] ? null : true;
  });
  await waitForCondition(() => {
    const events = workspaceDoc.getArray('events').toArray();
    return events.some((event) => event.workspaceChange?.deletedPaths?.includes?.('test.md')) ? true : null;
  });
});
