import test from 'node:test';
import assert from 'node:assert/strict';

import { workspaceFeature } from '../../src/client/application/app-shell/workspace-feature.js';

test('workspaceFeature accepts static preview documents that use API path field', () => {
  const app = {
    _staticPreviewDocument: null,
    createDiagramPreviewDocument(language, source) {
      return `${language}:${source}`;
    },
    currentFilePath: 'docs/history.md',
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource() {
        return 'live-session-content';
      },
    },
  };

  workspaceFeature.setStaticPreviewDocument.call(app, {
    content: '# Historical snapshot',
    fileKind: 'markdown',
    hash: 'abc1234',
    path: 'docs/history.md',
  });

  assert.deepEqual(app.getStaticPreviewDocument(), {
    content: '# Historical snapshot',
    currentFilePath: 'docs/history.md',
    fileKind: 'markdown',
    filePath: 'docs/history.md',
    hash: 'abc1234',
  });
  assert.equal(workspaceFeature.getPreviewSource.call(app), '# Historical snapshot');
});

test('workspaceFeature matches static preview documents against current workspace path', () => {
  const app = {
    _staticPreviewDocument: null,
    createDiagramPreviewDocument(language, source) {
      return `${language}:${source}`;
    },
    currentFilePath: 'docs/current-name.md',
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource() {
        return 'live-session-content';
      },
    },
  };

  workspaceFeature.setStaticPreviewDocument.call(app, {
    content: '# Historical snapshot',
    currentFilePath: 'docs/current-name.md',
    fileKind: 'markdown',
    hash: 'abc1234',
    path: 'docs/old-name.md',
  });

  assert.equal(workspaceFeature.getPreviewSource.call(app), '# Historical snapshot');
});

test('workspaceFeature falls back to live preview source when there is no static preview document', () => {
  const app = {
    _staticPreviewDocument: null,
    currentFilePath: null,
    currentDrawioMode: null,
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource(filePath) {
        return filePath === null ? 'live-session-content' : 'unexpected';
      },
    },
  };

  assert.equal(workspaceFeature.getPreviewSource.call(app), 'live-session-content');
});

test('workspaceFeature passes draw.io text mode into live preview source resolution', () => {
  const app = {
    _staticPreviewDocument: null,
    currentDrawioMode: 'text',
    currentFilePath: 'diagrams/architecture.drawio',
    getStaticPreviewDocument: workspaceFeature.getStaticPreviewDocument,
    isMermaidFile() {
      return false;
    },
    isPlantUmlFile() {
      return false;
    },
    workspacePreviewController: {
      getPreviewSource(filePath, options) {
        assert.equal(filePath, 'diagrams/architecture.drawio');
        assert.deepEqual(options, { drawioMode: 'text' });
        return '```xml\n<mxfile />\n```';
      },
    },
  };

  assert.equal(workspaceFeature.getPreviewSource.call(app), '```xml\n<mxfile />\n```');
});

test('workspaceFeature routes draw.io preview editor requests into text mode', () => {
  const events = [];
  const app = {
    currentDrawioMode: null,
    currentFilePath: 'diagrams/architecture.drawio',
    isDrawioFile(filePath) {
      return filePath.endsWith('.drawio');
    },
    layoutController: {
      primeView(view) {
        events.push(['prime-view', view]);
      },
    },
    navigation: {
      navigateToFile(filePath, options) {
        events.push(['navigate', filePath, options]);
      },
    },
  };

  assert.equal(workspaceFeature.handleLayoutViewRequest.call(app, 'editor'), false);
  assert.deepEqual(events, [
    ['prime-view', 'editor'],
    ['navigate', 'diagrams/architecture.drawio', { drawioMode: 'text' }],
  ]);
});

test('workspaceFeature routes draw.io text preview requests back into embedded preview mode without changing desktop preference', () => {
  const events = [];
  const app = {
    currentDrawioMode: 'text',
    currentFilePath: 'diagrams/architecture.drawio',
    isDrawioFile(filePath) {
      return filePath.endsWith('.drawio');
    },
    layoutController: {
      isMobileViewport() {
        return false;
      },
      primeView(view) {
        events.push(['prime-view', view]);
      },
    },
    navigation: {
      navigateToFile(filePath, options) {
        events.push(['navigate', filePath, options ?? null]);
      },
    },
  };

  assert.equal(workspaceFeature.handleLayoutViewRequest.call(app, 'preview'), false);
  assert.deepEqual(events, [
    ['navigate', 'diagrams/architecture.drawio', null],
  ]);
});

test('workspaceFeature primes preview when leaving draw.io text mode on mobile', () => {
  const events = [];
  const app = {
    currentDrawioMode: 'text',
    currentFilePath: 'diagrams/architecture.drawio',
    isDrawioFile(filePath) {
      return filePath.endsWith('.drawio');
    },
    layoutController: {
      isMobileViewport() {
        return true;
      },
      primeView(view) {
        events.push(['prime-view', view]);
      },
    },
    navigation: {
      navigateToFile(filePath, options) {
        events.push(['navigate', filePath, options ?? null]);
      },
    },
  };

  assert.equal(workspaceFeature.handleLayoutViewRequest.call(app, 'preview'), false);
  assert.deepEqual(events, [
    ['prime-view', 'preview'],
    ['navigate', 'diagrams/architecture.drawio', null],
  ]);
});

test('workspaceFeature keeps non-preview layout requests local for draw.io text mode', () => {
  const app = {
    currentDrawioMode: 'text',
    currentFilePath: 'diagrams/architecture.drawio',
    isDrawioFile(filePath) {
      return filePath.endsWith('.drawio');
    },
    layoutController: {
      primeView() {
        throw new Error('Should not reroute');
      },
    },
    navigation: {
      navigateToFile() {
        throw new Error('Should not reroute');
      },
    },
  };

  assert.equal(workspaceFeature.handleLayoutViewRequest.call(app, 'editor'), true);
  assert.equal(workspaceFeature.handleLayoutViewRequest.call(app, 'split'), true);
});

test('workspaceFeature forwards file selection reveal intent to the route controller', () => {
  const events = [];
  const app = {
    workspaceRouteController: {
      handleFileSelection(filePath, options) {
        events.push([filePath, options]);
      },
    },
  };

  workspaceFeature.handleFileSelection.call(app, 'docs/guide.md', {
    closeSidebarOnMobile: true,
    revealInTree: true,
  });

  assert.deepEqual(events, [[
    'docs/guide.md',
    {
      closeSidebarOnMobile: true,
      revealInTree: true,
    },
  ]]);
});

test('workspaceFeature collapses base edits into the latest preview render', () => {
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetTimeout = globalThis.setTimeout;
  const timers = new Map();
  let nextTimerId = 0;
  const calls = [];
  globalThis.clearTimeout = (timerId) => timers.delete(timerId);
  globalThis.setTimeout = (callback) => {
    nextTimerId += 1;
    timers.set(nextTimerId, callback);
    return nextTimerId;
  };

  try {
    const app = {
      _basePreviewRenderTimer: null,
      currentFilePath: 'views/tasks.base',
      renderBaseFilePreview: workspaceFeature.renderBaseFilePreview,
      sessionLoadToken: 4,
      workspacePreviewController: {
        renderBaseFilePreview(filePath, options) {
          calls.push([filePath, options]);
        },
      },
    };

    workspaceFeature.scheduleBaseFilePreview.call(app, 'views/tasks.base', { source: 'first' });
    workspaceFeature.scheduleBaseFilePreview.call(app, 'views/tasks.base', { source: 'latest' });

    assert.equal(timers.size, 1);
    timers.values().next().value();
    assert.deepEqual(calls, [['views/tasks.base', { source: 'latest' }]]);
  } finally {
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setTimeout = originalSetTimeout;
  }
});
