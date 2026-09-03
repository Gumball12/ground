import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repoRoot = process.cwd();

const readSource = (path) => readFile(resolve(repoRoot, path), 'utf8');

const forbiddenIds = [
  'sidebar',
  'toolbarSearchBtn',
  'chatToggleBtn',
  'editorFormatBtn',
  'toggleWrapBtn',
  'markdownToolbar',
  'mobileViewToggle',
  'previewPane',
  'commentsToggle',
  'outlineToggle',
  'toolbarPresence',
  'shareBtn',
];

const forbiddenRuntimeTokens = [
  'FileExplorerController',
  'WikiLinkFileController',
  'LobbyPresence',
  'chatFeature',
  'commentsFeature',
  'presenceFeature',
  'uiFeatureSidebarMethods',
  'uiFeatureToolbarMethods',
  'toolbarSearchButton',
  'chatToggleButton',
  'editorFormatButton',
  'toggleWrapButton',
  'markdownToolbar',
  'mobileViewToggle',
  'previewPane',
  'commentsToggleButton',
  'outlineToggle',
  'toolbarPresence',
  'shareButton',
  'globalUsers',
  'stopFollowingUser',
];

test('focused product removes excluded shell markup and runtime wiring', async () => {
  const [html, elements, bootstrap, shellFeature, governance, governanceCss] = await Promise.all([
    readSource('src/client/app/index.html'),
    readSource('src/client/application/app-shell-elements.js'),
    readSource('src/client/bootstrap/collabmd-app-shell.js'),
    readSource('src/client/application/app-shell/ui-feature-shell.js'),
    readSource('src/client/presentation/governance-ui-controller.js'),
    readSource('src/client/styles/features/governance.css'),
  ]);

  const runtimeSource = [elements, bootstrap, shellFeature].join('\n');
  const focusedSource = [runtimeSource, governance, governanceCss].join('\n');

  forbiddenIds.forEach((id) => {
    assert.doesNotMatch(html, new RegExp(`id=["']${id}["']`, 'u'), id);
  });
  forbiddenRuntimeTokens.forEach((token) => {
    assert.doesNotMatch(runtimeSource, new RegExp(`\\b${token}\\b`, 'u'), token);
  });
  ['data-governed', 'isGovernedMode', 'GOVERNED_SURFACE_KEYS'].forEach((token) => {
    assert.doesNotMatch(focusedSource, new RegExp(token, 'u'), token);
  });
  assert.doesNotMatch(bootstrap, /getFileList:\s*\(\)\s*=>\s*\[\]/u);
  assert.match(bootstrap, /WorkspaceSyncClient/u);
  assert.match(bootstrap, /FileTreeState/u);
  assert.doesNotMatch(governance, /\buser-avatar\b/u);
});
