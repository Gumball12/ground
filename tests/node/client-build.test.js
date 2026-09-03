import assert from 'node:assert/strict';
import test from 'node:test';
import { constants as fsConstants } from 'node:fs';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractAssetPath } from './helpers/asset-path.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientDistDir = resolve(rootDir, 'dist/client');

test('client build emits the focused hashed entry graph without the removed preview worker', async () => {
  const indexHtml = await readFile(resolve(clientDistDir, 'index.html'), 'utf8');
  const mainAssetPath = extractAssetPath(indexHtml, /src="\.\/(assets\/[^"]+\.js)"/, 'main bundle');
  const mainStylesheetPath = extractAssetPath(indexHtml, /href="\.\/(assets\/[^"]+-[A-Za-z0-9_-]{8,}\.css)"/, 'main stylesheet');
  const assetFileNames = await readdir(resolve(clientDistDir, 'assets'));
  const entryBundle = await readFile(resolve(clientDistDir, mainAssetPath), 'utf8');
  const focusedRuntimeReference = entryBundle.match(/\bmain-[A-Za-z0-9_-]+\.js\b/u)?.[0] || null;
  assert.ok(focusedRuntimeReference, 'expected entry bundle to reference the focused runtime');
  const focusedRuntime = await readFile(
    resolve(clientDistDir, 'assets', focusedRuntimeReference),
    'utf8',
  );

  assert.match(focusedRuntime, /governanceStatusPanel/u);
  assert.doesNotMatch(`${entryBundle}\n${focusedRuntime}`, /preview-render-worker/u);
  assert.equal(
    assetFileNames.some((fileName) => fileName.startsWith('preview-render-worker-')),
    false,
  );
  await access(resolve(clientDistDir, mainAssetPath), fsConstants.R_OK);
  await access(resolve(clientDistDir, 'assets', focusedRuntimeReference), fsConstants.R_OK);
  await access(resolve(clientDistDir, mainStylesheetPath), fsConstants.R_OK);
  assert.match(indexHtml, /src="\.\/app-config\.js"/);
  assert.doesNotMatch(indexHtml, /assets\/vendor\/highlight\/github-dark\.min\.css/);
  assert.doesNotMatch(indexHtml, /main-entry\.js/);
});

test('excalidraw build references the lazy Mermaid-to-Excalidraw converter', async () => {
  const excalidrawHtml = await readFile(resolve(clientDistDir, 'excalidraw-editor.html'), 'utf8');
  const excalidrawJsPath = extractAssetPath(
    excalidrawHtml,
    /src="\.\/(assets\/[^"]+\.js)"/,
    'Excalidraw script',
  );
  const excalidrawBundle = await readFile(resolve(clientDistDir, excalidrawJsPath), 'utf8');
  const excalidrawCssReference = excalidrawBundle.match(/\bexcalidraw-editor-[A-Za-z0-9_-]+\.css\b/u)?.[0] || null;

  assert.ok(excalidrawCssReference, 'expected Excalidraw bundle to reference emitted stylesheet');
  await access(resolve(clientDistDir, 'assets', excalidrawCssReference), fsConstants.R_OK);
  assert.match(excalidrawHtml, /src="\.\/app-config\.js"/);
  assert.doesNotMatch(excalidrawHtml, /excalidraw-editor-entry\.js/);
  assert.doesNotMatch(excalidrawBundle, /excalidraw-mermaid-stub/i);
  assert.match(excalidrawBundle, /mermaid\.core-[A-Za-z0-9_-]+\.js/u);
});
