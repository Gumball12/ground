import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkspaceRouteController } from '../../src/client/application/workspace-route-controller.js';

const createController = ({
  active = true,
  indexReady = true,
  indexed = true,
  openResult = true,
  route = { filePath: 'README.md', type: 'file' },
  session = null,
} = {}) => {
  const events = [];
  const requests = [];
  let currentSession = session;
  const coordinator = {
    cleanupSession() {
      events.push(['cleanup']);
      currentSession = null;
    },
    getSession() {
      return currentSession;
    },
    async openFile(filePath) {
      events.push(['open', filePath]);
      return openResult;
    },
  };
  const controller = new WorkspaceRouteController({
    getIsDocumentIndexReady: () => indexReady,
    getIsTabActive: () => active,
    hasIndexedDocument: (filePath) => {
      events.push(['index', filePath]);
      return indexed;
    },
    navigation: {
      getHashRoute: () => route,
      navigateToFile: (filePath) => events.push(['navigate', filePath]),
    },
    onDocumentRequested: async (filePath, options) => {
      events.push(['request', filePath]);
      requests.push([filePath, options]);
    },
    workspaceCoordinator: coordinator,
  });

  return {
    controller,
    coordinator,
    events,
    requests,
    setSession(nextSession) {
      currentSession = nextSession;
    },
    setIndexReady(nextReady) {
      indexReady = nextReady;
    },
  };
};

test('WorkspaceRouteController opens only the route-selected indexed Markdown document', async () => {
  const fixture = createController({
    route: { filePath: 'docs/guide.md', type: 'file' },
  });

  assert.equal(await fixture.controller.handleHashChange(), true);
  assert.deepEqual(fixture.events, [
    ['index', 'docs/guide.md'],
    ['request', 'docs/guide.md'],
    ['open', 'docs/guide.md'],
  ]);
});

test('WorkspaceRouteController routes an indexed-missing Markdown hash through not-found without creating Access', async () => {
  const fixture = createController({ indexed: false });

  assert.equal(await fixture.controller.handleHashChange(), false);
  assert.deepEqual(fixture.events, [
    ['index', 'README.md'],
    ['open', 'README.md'],
  ]);
});

test('WorkspaceRouteController defers Access until the initial non-visual index is ready without blocking a retry', async () => {
  const fixture = createController({ indexReady: false });

  assert.equal(await fixture.controller.handleHashChange(), true);
  assert.deepEqual(fixture.events, []);

  fixture.setIndexReady(true);
  assert.equal(await fixture.controller.handleHashChange(), true);
  assert.deepEqual(fixture.events, [
    ['index', 'README.md'],
    ['request', 'README.md'],
    ['open', 'README.md'],
  ]);
});

test('WorkspaceRouteController forces same-document Access retry after confirming index membership', async () => {
  const fixture = createController();

  assert.equal(await fixture.controller.handleHashChange({ forceGovernance: true }), true);
  assert.deepEqual(fixture.events, [
    ['index', 'README.md'],
    ['request', 'README.md'],
    ['open', 'README.md'],
  ]);
  assert.deepEqual(fixture.requests, [['README.md', { force: true }]]);
});

test('WorkspaceRouteController fails closed for empty, removed product, and non-Markdown routes', async () => {
  const routes = [
    { type: 'empty' },
    { type: 'git-diff' },
    { filePath: 'README.assets/image.png', type: 'file' },
    { filePath: 'diagram.excalidraw', type: 'file' },
  ];

  for (const route of routes) {
    const fixture = createController({ route, session: { id: 'active-session' } });

    assert.equal(await fixture.controller.handleHashChange(), false);
    assert.deepEqual(fixture.events, [
      ['cleanup'],
      ['request', null],
    ]);
    assert.equal(fixture.coordinator.getSession(), null);
  }
});

test('WorkspaceRouteController leaves the workspace untouched while this tab is inactive', async () => {
  const fixture = createController({ active: false });

  assert.equal(await fixture.controller.handleHashChange(), false);
  assert.deepEqual(fixture.events, []);
});

test('WorkspaceRouteController reapplies a text match when the same active session handles the route', async () => {
  const reveals = [];
  const session = {
    revealSearchMatch(match) {
      reveals.push(match);
      return true;
    },
  };
  const fixture = createController({
    route: {
      column: 3,
      filePath: 'README.md',
      line: 7,
      matchLength: 5,
      type: 'file',
    },
    session,
  });

  assert.equal(await fixture.controller.handleHashChange(), true);

  assert.deepEqual(reveals, [{ column: 3, length: 5, line: 7 }]);
});

test('WorkspaceRouteController does not apply a route match to a newly replaced session', async () => {
  const oldSession = { id: 'old' };
  const reveals = [];
  const newSession = {
    id: 'new',
    revealSearchMatch(match) {
      reveals.push(match);
      return true;
    },
  };
  const fixture = createController({
    route: { filePath: 'README.md', line: 2, type: 'file' },
    session: oldSession,
  });
  fixture.coordinator.openFile = async (filePath) => {
    fixture.events.push(['open', filePath]);
    fixture.setSession(newSession);
    return true;
  };

  assert.equal(await fixture.controller.handleHashChange(), true);

  assert.deepEqual(reveals, []);
});

test('WorkspaceRouteController propagates a focused editor open failure', async () => {
  const fixture = createController({ openResult: false });

  assert.equal(await fixture.controller.handleHashChange(), false);
  assert.deepEqual(fixture.events, [
    ['index', 'README.md'],
    ['request', 'README.md'],
    ['open', 'README.md'],
  ]);
});

test('WorkspaceRouteController falls back to line scrolling when exact match reveal is unavailable', () => {
  const scrolls = [];
  const fixture = createController();
  const session = {
    scrollToLine(line, ratio) {
      scrolls.push([line, ratio]);
      return true;
    },
  };

  assert.equal(fixture.controller.revealEditorMatch({ line: 4 }, session), true);
  assert.deepEqual(scrolls, [[4, 0.2]]);
  assert.equal(fixture.controller.revealEditorMatch({}, session), false);
});
