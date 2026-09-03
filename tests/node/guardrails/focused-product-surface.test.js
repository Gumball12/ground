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

// A bare class selector that declares `display` beats the user-agent
// `[hidden] { display: none }` rule, which once rendered Ground's landing and
// unavailable sections inside the local app and pushed the governance rail out
// of view. Ground-only surfaces must stay hidden until Ground reveals them.
test('Ground-only surfaces ship hidden and their display rules respect the attribute', async () => {
  const indexHtml = await readSource('src/client/app/index.html');
  for (const id of ['groundLanding', 'groundUnavailable', 'shareGroundDocument']) {
    const element = new RegExp(`id="${id}"[^>]*>`, 'u').exec(indexHtml)?.[0];
    assert.ok(element, `expected #${id} in index.html`);
    assert.match(element, /\shidden[\s>]/u, `expected #${id} to ship hidden`);
  }

  const groundCss = (await readSource('src/client/styles/features/ground-entry.css'))
    .replaceAll(/\/\*[\s\S]*?\*\//gu, '');
  const displayRules = groundCss
    .split('}')
    .filter((block) => /display\s*:/u.test(block))
    .map((block) => block.split('{')[0].trim());
  assert.ok(displayRules.length > 0, 'expected Ground styles to declare display');
  for (const selector of displayRules) {
    assert.match(
      selector,
      /:not\(\[hidden\]\)/u,
      `display in "${selector}" must be guarded with :not([hidden])`,
    );
  }
});

test('the shipped page is branded Ground rather than CollabMD', async () => {
  const indexHtml = await readSource('src/client/app/index.html');

  assert.match(indexHtml, /<title>Ground[^<]*<\/title>/u);
  assert.match(indexHtml, /<span>Ground<\/span>/u);
  assert.match(indexHtml, /rel="icon"[^>]*ground-icon\.svg/u);
  assert.doesNotMatch(indexHtml, /<span>CollabMD<\/span>/u);
  assert.doesNotMatch(indexHtml, /<title>[^<]*CollabMD/u);
});
