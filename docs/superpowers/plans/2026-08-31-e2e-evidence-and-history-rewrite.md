# Governed Collaboration E2E Evidence and History Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reproducible local screenshot/video evidence for the four governed-collaboration MVP flows, add those flows to Ubuntu CI, align agent instructions, then rewrite the feature history into four semantic commits and fast-forward local `main`.

**Architecture:** Reuse `tests/e2e/governance.spec.js` as the only behavioral source for Evidence. A separate Playwright config replaces the default project list, records successful managed-context videos, and keeps traces off; the existing tests add four named screenshots plus one explicit video for the manually-created Writer context. Default E2E behavior stays failure-only, while CI keeps `npm run check` and adds only the four portable governance flows.

**Tech Stack:** Node.js 26, JavaScript ES modules, Playwright Test 1.62.1, Node test runner, GitHub Actions, Docker, Git worktrees.

**Spec:** `docs/superpowers/specs/2026-08-31-e2e-evidence-and-history-rewrite-design.md`

## Global Constraints

- Use Node.js 26 and the existing npm lockfile; add no dependency.
- Work in `/private/tmp/openai-webmcp-challenge-webmcp-governance` on `codex/webmcp-governance` until the final merge.
- Preserve the default Playwright failure artifact policy: screenshot, trace, and video remain `retain/only-on-failure`.
- Evidence covers exactly the four tests in `tests/e2e/governance.spec.js`.
- Generated Evidence stays under ignored `test-results/evidence/` and `playwright-report/evidence/`.
- Evidence records no trace.
- The Ubuntu CI addition runs the governance file only; the complete inherited E2E suite remains a local final gate.
- Do not generate Linux visual baselines. Missing snapshots must fail unless an explicit update command is used.
- Keep `AGENTS.md` concise; `CLAUDE.md` contains exactly `@AGENTS.md`.
- Do not push, deploy, publish, delete a worktree, or perform the live ChatGPT WebMCP smoke test.
- Do not rewrite Git history until implementation is committed, all final checks pass, and both worktrees are clean.
- Code, identifiers, comments, docs, and commit messages are English.

At the start of every task that runs Node or npm, use the verified Node 26 runtime and retain Homebrew tools such as ripgrep:

```bash
NODE26_BIN_DIR="/private/tmp/webmcp-role-spike.i2cY35/node26/node_modules/.bin"
test -x "$NODE26_BIN_DIR/node"
export PATH="$NODE26_BIN_DIR:/opt/homebrew/bin:$PATH"
test "$(node --version)" = "v26.8.1"
```

If that verified runtime path no longer exists, stop and restore Node 26 before running tests; do not fall back to the host's Node 24.

## File Map

### Create

- `playwright.evidence.config.js` — Evidence-only Playwright project and artifact policy.
- `tests/node/playwright-evidence-config.test.js` — configuration regression test that prevents default-project leakage and implicit snapshot creation.
- `CLAUDE.md` — one-line import of `AGENTS.md`.

### Modify

- `playwright.config.js` — set `updateSnapshots: 'none'`.
- `package.json` — add focused governance and Evidence scripts.
- `tests/e2e/governance.spec.js` — platform-portable shortcuts, four named screenshots, and manual Writer video attachment.
- `tests/e2e/helpers/app-fixture.js` — platform-portable Select All in `replaceEditorContent()`.
- `.github/workflows/docker-publish.yml` — run the four governance E2E tests after the existing check.
- `AGENTS.md` — durable governance invariants and Evidence command.
- `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md` — ignored, non-Git Evidence handoff updated after merge.

### Generated, Never Tracked

- `test-results/evidence/`
- `playwright-report/evidence/`
- temporary Ubuntu validation checkout under `/private/tmp/collabmd-ubuntu-e2e.*`

---

### Task 1: Isolate the Playwright Evidence Configuration

**Files:**
- Create: `playwright.evidence.config.js`
- Create: `tests/node/playwright-evidence-config.test.js`
- Modify: `playwright.config.js:24-48`
- Modify: `package.json:28-55`

**Interfaces:**
- Consumes: the default export from `playwright.config.js`.
- Produces: default export `evidenceConfig`, npm script `test:e2e:evidence`, and npm script `test:e2e:governance:prebuilt`.

- [ ] **Step 1: Write the failing configuration test**

Create `tests/node/playwright-evidence-config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import defaultConfig from '../../playwright.config.js';
import evidenceConfig from '../../playwright.evidence.config.js';

test('Playwright Evidence isolates four governance flows and safe artifacts', () => {
  assert.equal(defaultConfig.updateSnapshots, 'none');
  assert.deepEqual(
    evidenceConfig.projects.map((project) => project.name),
    ['governance-evidence'],
  );
  assert.equal(
    evidenceConfig.projects[0].testMatch.test('governance.spec.js'),
    true,
  );
  assert.equal(evidenceConfig.outputDir, 'test-results/evidence');
  assert.deepEqual(evidenceConfig.use.viewport, { width: 1280, height: 720 });
  assert.equal(evidenceConfig.use.reducedMotion, 'reduce');
  assert.equal(evidenceConfig.use.screenshot, 'off');
  assert.equal(evidenceConfig.use.trace, 'off');
  assert.equal(evidenceConfig.use.video, 'on');
  assert.deepEqual(evidenceConfig.reporter, [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/evidence',
    }],
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/node/playwright-evidence-config.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `playwright.evidence.config.js`.

- [ ] **Step 3: Disable implicit snapshot generation**

Add this top-level property to the default object in `playwright.config.js`:

```js
updateSnapshots: 'none',
```

Keep the existing `use`, `projects`, retry, worker, and failure artifact settings unchanged.

- [ ] **Step 4: Create the Evidence config with a replacement project list**

Create `playwright.evidence.config.js`:

```js
import { defineConfig } from '@playwright/test';

import defaultConfig from './playwright.config.js';

export default defineConfig({
  ...defaultConfig,
  outputDir: 'test-results/evidence',
  reporter: [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report/evidence',
    }],
  ],
  use: {
    ...defaultConfig.use,
    headless: true,
    reducedMotion: 'reduce',
    screenshot: 'off',
    trace: 'off',
    video: 'on',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'governance-evidence',
      testMatch: /governance\.spec\.js/u,
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
```

Use one `defineConfig()` argument. Do not use `defineConfig(defaultConfig, overrides)`, because Playwright would merge the differently-named default projects instead of replacing them.

- [ ] **Step 5: Add the two npm scripts**

Add these entries beside the existing E2E scripts in `package.json`:

```json
"test:e2e:evidence": "npm run build && playwright test --config=playwright.evidence.config.js",
"test:e2e:governance:prebuilt": "playwright test tests/e2e/governance.spec.js"
```

Do not change `npm test`, `npm run check`, or the lockfile.

- [ ] **Step 6: Run the configuration test and list the Evidence tests**

Run:

```bash
node --test tests/node/playwright-evidence-config.test.js
npx playwright test --config=playwright.evidence.config.js --list
```

Expected:

- Node test: 1 passed.
- Playwright list: exactly 4 tests, all under project `governance-evidence`.
- No `chromium`, Firefox, or WebKit default project is listed.

- [ ] **Step 7: Commit the isolated configuration**

```bash
git add playwright.config.js playwright.evidence.config.js package.json tests/node/playwright-evidence-config.test.js
git diff --cached --check
git commit -m "test: configure governance evidence runs"
```

---

### Task 2: Capture the Four Actor States and Manual Writer Video

**Files:**
- Modify: `tests/e2e/governance.spec.js:1-435`
- Modify: `tests/e2e/helpers/app-fixture.js:601-609`

**Interfaces:**
- Consumes: Playwright `Page`, `TestInfo`, and the `governance-evidence` project name.
- Produces:
  - `isEvidenceRun(testInfo): boolean`
  - `primaryShortcut(key): string`
  - `attachEvidenceScreenshot({ name, page, testInfo }): Promise<void>`
  - four named PNG attachments
  - explicit `offline-grant-revalidation-video` WebM attachment

- [ ] **Step 1: Establish the artifact-level RED check**

Run the Evidence suite before adding explicit captures:

```bash
npm run test:e2e:evidence
```

Then run:

```bash
node -e "const fs=require('node:fs');const path=require('node:path');const walk=(dir)=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{const target=path.join(dir,entry.name);return entry.isDirectory()?walk(target):[target];}):[];const files=walk('test-results/evidence');const png=files.filter((file)=>file.endsWith('.png'));const webm=files.filter((file)=>file.endsWith('.webm'));if(png.length<4)throw new Error('expected at least four named PNG attachments');if(webm.length<5)throw new Error('expected managed videos plus the manual Writer video');"
```

Expected: FAIL with `expected at least four named PNG attachments`.

- [ ] **Step 2: Add Evidence and shortcut helpers**

Add these helpers below the existing helper constants in `tests/e2e/governance.spec.js`:

```js
const isEvidenceRun = (testInfo) => (
  testInfo.project.name === 'governance-evidence'
);

const primaryShortcut = (key) => (
  `${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`
);

const attachEvidenceScreenshot = async ({
  name,
  page,
  testInfo,
}) => {
  if (!isEvidenceRun(testInfo)) {
    return;
  }

  await testInfo.attach(name, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
};
```

Do not export these helpers; they are used only by this file.

- [ ] **Step 3: Make shared Select All platform-portable**

Change `replaceEditorContent()` in `tests/e2e/helpers/app-fixture.js`:

```js
export async function replaceEditorContent(page, content) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(content);
}
```

- [ ] **Step 4: Make governance Undo and Redo platform-portable**

Replace the five hardcoded governance shortcuts:

```js
await writerPage.keyboard.press(primaryShortcut('Z'));
await writerPage.keyboard.press(primaryShortcut('Shift+Z'));
```

Use `primaryShortcut('Z')` for every Undo and `primaryShortcut('Shift+Z')` for Redo. Leave existing `Control+End` calls unchanged.

- [ ] **Step 5: Add named screenshots at asserted states**

Add `testInfo` as the second test callback argument for all four governance tests:

```js
test('...', async ({ page: ownerPage }, testInfo) => {
```

The fourth signature remains browser-aware:

```js
test('...', async ({ browser, page: ownerPage }, testInfo) => {
```

Add exactly these calls before the relevant secondary page closes:

```js
await attachEvidenceScreenshot({
  name: 'ai-reviewer-role',
  page: reviewerPage,
  testInfo,
});
```

Place it after the first test has verified the Reviewer label, participant kind, credential-free URL, and join Activity.

```js
await attachEvidenceScreenshot({
  name: 'revoked-editor',
  page: writerPage,
  testInfo,
});
```

Place it after the second test has verified the revoked state, removed editor, and denied cached tool.

```js
await ownerPage.locator('[data-governance-tab="review"]').click();
await attachEvidenceScreenshot({
  name: 'proposal-conflicts',
  page: ownerPage,
  testInfo,
});
```

Place it after `hasSameLocationConflictGroup(ownerPage)` becomes true and before the Owner resolves a Proposal.

```js
await attachEvidenceScreenshot({
  name: 'offline-grant-revalidated',
  page: writerPage,
  testInfo,
});
```

Place it after the fourth test has received the Reviewer Grant, recreated the collaborative editor, restored `reconnectedText`, and recorded the Grant-change Activity, but before it assigns Editor again.

- [ ] **Step 6: Record and attach the manual Writer context video**

In the fourth test, create the Writer context with Evidence-only recording:

```js
const writerContext = await browser.newContext(isEvidenceRun(testInfo)
  ? {
      recordVideo: {
        dir: testInfo.outputPath('manual-video'),
      },
    }
  : {});
```

After creating `writerPage`, retain its optional video:

```js
const writerPage = await writerContext.newPage();
const writerVideo = writerPage.video();
```

Extend the existing `finally` block:

```js
  } finally {
    resumeGovernanceRefresh();
    await writerContext.close();

    if (writerVideo) {
      const videoPath = testInfo.outputPath('offline-grant-revalidation.webm');
      await writerVideo.saveAs(videoPath);
      await testInfo.attach('offline-grant-revalidation-video', {
        contentType: 'video/webm',
        path: videoPath,
      });
    }
  }
```

The default run returns no manual `Video`, so it adds no success artifact or cost outside Evidence mode.

- [ ] **Step 7: Verify normal governance behavior first**

Run:

```bash
npm run build
npm run test:e2e:governance:prebuilt
```

Expected: 4 passed. Successful default runs retain no trace, screenshot, or video.

- [ ] **Step 8: Verify Evidence artifacts**

Run:

```bash
npm run test:e2e:evidence
```

Then rerun the Node artifact assertion from Step 1, extended to reject traces:

```bash
node -e "const fs=require('node:fs');const path=require('node:path');const walk=(dir)=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>{const target=path.join(dir,entry.name);return entry.isDirectory()?walk(target):[target];}):[];const files=walk('test-results/evidence');const png=files.filter((file)=>file.endsWith('.png'));const webm=files.filter((file)=>file.endsWith('.webm'));const trace=files.filter((file)=>file.endsWith('.zip'));if(png.length!==4)throw new Error('expected exactly four named PNG attachments');if(webm.length<5)throw new Error('expected managed videos plus the manual Writer video');if(trace.length)throw new Error('Evidence must not retain traces');console.log({png:png.length,webm:webm.length,trace:trace.length});"
```

Expected:

- 4 tests passed.
- Exactly 4 PNG attachments.
- At least 5 WebM files, including `offline-grant-revalidation.webm`.
- 0 trace ZIP files.
- `playwright-report/evidence/index.html` exists.

- [ ] **Step 9: Commit the evidence capture behavior**

```bash
git add tests/e2e/governance.spec.js tests/e2e/helpers/app-fixture.js
git diff --cached --check
git commit -m "test: capture governed collaboration evidence"
```

---

### Task 3: Validate the Four Governance Flows on Ubuntu CI

**Files:**
- Modify: `.github/workflows/docker-publish.yml:37-40`

**Interfaces:**
- Consumes: `npm run check`, `npm run test:e2e:governance:prebuilt`.
- Produces: a `Run governed collaboration E2E` validation step before Docker build/publish.

- [ ] **Step 1: Run the governance flow in a disposable Ubuntu environment**

Run this from a clean feature worktree after Tasks 1 and 2 are committed:

```bash
E2E_UBUNTU_DIR="$(mktemp -d /private/tmp/collabmd-ubuntu-e2e.XXXXXX)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
git archive HEAD | tar -x -C "$E2E_UBUNTU_DIR"
docker run --rm \
  -e HOST_UID="$HOST_UID" \
  -e HOST_GID="$HOST_GID" \
  -v "$E2E_UBUNTU_DIR:/workspace" \
  -w /workspace \
  node:26-bookworm \
  bash -lc 'trap '\''chown -R "$HOST_UID":"$HOST_GID" /workspace'\'' EXIT; apt-get update && apt-get install -y ripgrep && npm ci && npx playwright install --with-deps chromium && npm run build && CI=1 npm run test:e2e:governance:prebuilt'
UBUNTU_E2E_STATUS="$?"
case "$E2E_UBUNTU_DIR" in
  /private/tmp/collabmd-ubuntu-e2e.*)
    rm -rf "$E2E_UBUNTU_DIR"
    ;;
  *)
    exit 1
    ;;
esac
test "$UBUNTU_E2E_STATUS" -eq 0
```

Expected: 4 governance tests pass under Node 26, Ubuntu, Chromium, and ripgrep. If the Docker or package download is blocked, request network approval rather than weakening this check.

- [ ] **Step 2: Add the focused CI step**

Insert after `Run project validation` in `.github/workflows/docker-publish.yml`:

```yaml
      - name: Run governed collaboration E2E
        run: npm run test:e2e:governance:prebuilt
```

Keep `npm run check` unchanged so lint remains in CI. Do not add artifact upload.

- [ ] **Step 3: Verify the workflow diff and focused commands**

Run:

```bash
git diff --check
rg -n "Run project validation|Run governed collaboration E2E|npm run check|test:e2e:governance:prebuilt" .github/workflows/docker-publish.yml package.json
node --test tests/node/playwright-evidence-config.test.js
```

Expected: the governance step follows the check, and the config test passes.

- [ ] **Step 4: Commit the CI gate**

```bash
git add .github/workflows/docker-publish.yml
git diff --cached --check
git commit -m "ci: validate governed collaboration flows"
```

---

### Task 4: Make Agent Guidance Use One Source of Truth

**Files:**
- Create: `CLAUDE.md`
- Modify: `AGENTS.md:20-43`
- Modify: `AGENTS.md:93-106`

**Interfaces:**
- Produces: root project guidance for Codex and an exact Claude Code import.

- [ ] **Step 1: Add the Evidence commands to Runtime and commands**

Add these lines after the existing full suite entry in `AGENTS.md`:

```markdown
- Governed E2E: `npm run build && npm run test:e2e:governance:prebuilt`
- Local Evidence: `npm run test:e2e:evidence`
```

- [ ] **Step 2: Add durable governance invariants**

Append these bullets to `## Product invariants`:

```markdown
- `collabmd.governance.json` is the Role and Capability source of truth. Do not
  duplicate Role maps in client code.
- Client gating is user experience; the server reauthorizes every WebMCP
  execution.
- `participantKind` is self-declared presentation metadata, never verified
  authorization identity.
- Proposal, Conflict, and Activity records are outside document Undo and Redo
  semantics.
- The supported governance threat boundary covers the shipped UI and WebMCP
  flows, not malicious raw Yjs clients.
```

Add this Evidence artifact line in `## Testing and completion` after the existing failure-artifact paragraph:

```markdown
Successful governed Evidence is generated only by
`npm run test:e2e:evidence`; its ignored output is not a snapshot baseline or
the final Challenge demo.
```

- [ ] **Step 3: Create the Claude Code import**

Create `CLAUDE.md` with exactly:

```text
@AGENTS.md
```

The file must end with one newline and contain no other text.

- [ ] **Step 4: Verify the SSOT**

Run:

```bash
node -e "const fs=require('node:fs');const value=fs.readFileSync('CLAUDE.md','utf8');if(value!=='@AGENTS.md\n')throw new Error('CLAUDE.md must contain only @AGENTS.md');"
rg -n "collabmd.governance.json|participantKind|Local Evidence|Successful governed Evidence" AGENTS.md
git diff --check
```

Expected: the Node assertion passes and every durable term is found once.

- [ ] **Step 5: Commit agent guidance**

```bash
git add AGENTS.md CLAUDE.md
git diff --cached --check
git commit -m "docs: align agent governance guidance"
```

---

### Task 5: Audit Coverage and Complete the Pre-Rewrite Verification Gate

**Files:**
- Review: all files under `tests/node/`, `tests/browser/`, and `tests/e2e/` changed by `main...HEAD`.
- Generated only: `dist/`, `test-results/`, `playwright-report/`.

**Interfaces:**
- Produces: a clean, fully verified final tree ready for history reconstruction.

- [ ] **Step 1: Audit added and removed test intent**

Run:

```bash
git diff --unified=0 main...HEAD -- tests | rg "^diff --git|^[+-][[:space:]]*(test|it)(\\.|\\()"
git diff --numstat main...HEAD -- tests
```

Review the output with these exact rules:

- Node tests own pure rules and server/client boundary behavior.
- Browser tests own DOM, editor gating, accessibility, and presentation.
- E2E owns multi-participant convergence, routing, offline behavior, and execution-time denial.
- Visual snapshots own stable rendering; Evidence PNGs are non-asserting artifacts.
- Removed image paste, attachment, and unsupported governed-surface tests match the approved MVP exclusions.

Expected: no same-boundary duplicate with equal assertions. Make no deletion when duplication is not proven. If the output contradicts this reviewed baseline, stop and report the exact test pair before changing code.

- [ ] **Step 2: Run the complete non-E2E check**

Run:

```bash
npm run check
```

Expected:

- lint: 0 errors
- guardrails: 6 passed
- unit: existing 669 plus the new config test, all passed
- integration: 119 passed
- browser: 159 passed

Existing lint warnings are allowed only if no new warning is introduced.

- [ ] **Step 3: Run the complete inherited E2E suite**

Run:

```bash
npm run test:e2e:prebuilt
```

Expected: 198 passed and 2 expected skipped:

- Excalidraw fork API-dependent Undo/Redo test.
- Seeded nightly Excalidraw stress test.

Inspect any failure artifact before rerunning. Do not update snapshots to hide a failure.

- [ ] **Step 4: Regenerate Evidence last and inspect it**

Run:

```bash
npm run test:e2e:evidence
```

Run the artifact assertion from Task 2 Step 8. Open `playwright-report/evidence/index.html` and inspect all four PNGs and the Writer video for readable, non-blank UI and absence of credentials.

Expected: 4 passed, four named PNGs, successful videos, explicit Writer video, no trace.

- [ ] **Step 5: Validate packaging, secrets, formatting, and tracked state**

Run:

```bash
docker compose -f docker-compose.demo.yml config
git diff --check main...HEAD
git status --short --branch
git diff --name-only main...HEAD | rg "(^|/)(\\.env$|id_rsa|credentials|secret|token)(/|$)" || true
git grep -nE "(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" -- ':!package-lock.json' || true
git diff --exit-code main...HEAD -- LICENSE
```

Expected:

- Compose config succeeds.
- Diff check is clean.
- Feature worktree has no tracked or untracked change.
- Credential filename scan has no hit.
- High-confidence credential content scan has no hit.
- `LICENSE` is unchanged.
- Ignored Evidence artifacts do not appear in Git status.

Do not proceed to Task 6 if any check is not satisfied.

---

### Task 6: Rebuild the Branch as Four Semantic Commits

**Files:**
- Rewrite: all tracked changes in `main...codex/webmcp-governance`.

**Interfaces:**
- Consumes: clean verified feature tree and Git's native `ORIG_HEAD` recovery pointer.
- Produces: exactly four commits after `main`, with a tree identical to the verified pre-rewrite tree.

- [ ] **Step 1: Reconfirm the base and record the recovery state**

Run:

```bash
git status --porcelain -uall
git -C /Users/a1004/Documents/_projects/openai-webmcp-challenge status --porcelain -uall
git merge-base main HEAD
git rev-parse main
git rev-parse HEAD
git rev-parse HEAD^{tree}
```

Expected:

- Both status commands print nothing.
- `git merge-base main HEAD` equals `git rev-parse main`.
- The printed feature SHA and tree SHA are retained in the task log.

- [ ] **Step 2: Reset the feature branch to its actual merge base**

Run:

```bash
git reset --mixed "$(git merge-base main HEAD)"
git rev-parse ORIG_HEAD
git rev-parse ORIG_HEAD^{tree}
git status --short
```

Expected:

- `ORIG_HEAD` equals the pre-reset feature SHA printed in Step 1.
- All final changes remain in the working tree.
- No file content is lost.

- [ ] **Step 3: Create `feat: add governed collaboration core`**

Stage exactly:

```bash
git add \
  collabmd.governance.json \
  src/domain/comment-threads.js \
  src/domain/governance-activity.js \
  src/domain/governance-contract.js \
  src/domain/governance-proposals.js \
  src/server/config/governance-manifest.js \
  src/server/create-app-server.js \
  src/server/domain/collaboration/collaboration-room.js \
  src/server/domain/governance-session-registry.js \
  src/server/infrastructure/git/local-exclude.js \
  src/server/infrastructure/http/create-governance-api-handler.js \
  src/server/infrastructure/http/create-request-handler.js \
  tests/node/collaboration-room.test.js \
  tests/node/comment-threads.test.js \
  tests/node/governance-activity.test.js \
  tests/node/governance-api-handler.test.js \
  tests/node/governance-contract.test.js \
  tests/node/governance-manifest.test.js \
  tests/node/governance-proposals.test.js \
  tests/node/governance-session-registry.test.js \
  tests/node/integration/http-server.test.js \
  tests/node/local-exclude.test.js
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add governed collaboration core"
```

Inspect the cached diff before committing. It must contain no client UI, E2E, packaging, or documentation file.

- [ ] **Step 4: Create `feat: add governed collaboration experience`**

Stage exactly:

```bash
git add \
  src/client/app/index.html \
  src/client/application/app-shell-elements.js \
  src/client/application/app-shell/comments-feature.js \
  src/client/application/app-shell/governance-feature.js \
  src/client/application/app-shell/ui-feature-shell.js \
  src/client/application/app-shell/ui-feature-tab-activity.js \
  src/client/application/app-shell/ui-feature-toolbar.js \
  src/client/application/workspace-coordinator.js \
  src/client/application/workspace-route-controller.js \
  src/client/bootstrap/collabmd-app-shell.js \
  src/client/domain/runtime-paths.js \
  src/client/infrastructure/comment-thread-store.js \
  src/client/infrastructure/editor-collaboration-client.js \
  src/client/infrastructure/editor-session.js \
  src/client/infrastructure/editor-view-adapter.js \
  src/client/infrastructure/governance-client.js \
  src/client/infrastructure/tab-activity-lock.js \
  src/client/infrastructure/webmcp-tool-registry.js \
  src/client/presentation/comment-ui-controller.js \
  src/client/presentation/comment-ui/comment-ui-layout.js \
  src/client/presentation/comment-ui/comment-ui-state.js \
  src/client/presentation/file-action-controller.js \
  src/client/presentation/file-explorer-controller.js \
  src/client/presentation/governance-ui-controller.js \
  src/client/styles/features/governance.css \
  src/client/styles/style.css \
  tests/browser/comment-ui-controller.browser.test.js \
  tests/browser/editor-view-adapter.browser.test.js \
  tests/browser/governance-client.browser.test.js \
  tests/browser/governance-ui-controller.browser.test.js \
  tests/browser/ui-feature.browser.test.js \
  tests/node/comment-thread-store.test.js \
  tests/node/editor-session.test.js \
  tests/node/file-action-controller.test.js \
  tests/node/governance-client.test.js \
  tests/node/runtime-paths.test.js \
  tests/node/tab-activity-lock.test.js \
  tests/node/webmcp-tool-registry.test.js \
  tests/node/workspace-coordinator.test.js \
  tests/node/workspace-route-controller.test.js
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add governed collaboration experience"
```

Inspect the cached diff before committing. It must contain the client experience and its focused Node/browser tests, not E2E or docs.

- [ ] **Step 5: Create `test: cover governed collaboration workflows`**

Stage exactly:

```bash
git add \
  .github/workflows/docker-publish.yml \
  package.json \
  playwright.config.js \
  playwright.evidence.config.js \
  tests/node/playwright-evidence-config.test.js \
  tests/e2e/auth.spec.js \
  tests/e2e/collaboration.spec.js \
  tests/e2e/diagram-preview.spec.js \
  tests/e2e/governance.spec.js \
  tests/e2e/helpers/app-fixture.js \
  tests/e2e/mobile.spec.js \
  tests/e2e/preview-navigation.spec.js \
  tests/e2e/ui-visual.spec.js \
  tests/e2e/ui-visual.spec.js-snapshots/desktop-dark-create-menu-chromium-darwin.png \
  tests/e2e/ui-visual.spec.js-snapshots/desktop-workspace-shell-chromium-darwin.png \
  tests/e2e/ui-visual.spec.js-snapshots/mobile-preview-shell-chromium-darwin.png \
  tests/e2e/workspace.spec.js \
  tests/e2e/workspace.spec.js-snapshots/markdown-preview-parity-app-chromium-darwin.png
git diff --cached --check
git diff --cached --stat
git commit -m "test: cover governed collaboration workflows"
```

Do not add generated Evidence artifacts. Inspect the cached diff before committing.

- [ ] **Step 6: Create `docs: package governed collaboration demo`**

Stage exactly:

```bash
git add \
  .env.example \
  AGENTS.md \
  CLAUDE.md \
  README.md \
  deploy/Caddyfile \
  docker-compose.demo.yml \
  docs/demo/launch-plan.md \
  docs/superpowers/plans/2026-08-31-e2e-evidence-and-history-rewrite.md \
  docs/superpowers/specs/2026-08-31-e2e-evidence-and-history-rewrite-design.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs: package governed collaboration demo"
```

- [ ] **Step 7: Prove tree equivalence and commit count**

Run:

```bash
test "$(git rev-parse HEAD^{tree})" = "$(git rev-parse ORIG_HEAD^{tree})"
test "$(git rev-list --count main..HEAD)" -eq 4
git log --reverse --format="%h %s" main..HEAD
git status --porcelain -uall
git diff --check main..HEAD
```

Expected:

- Tree comparison succeeds.
- Exactly four commits exist after `main`.
- Subjects appear in the required order.
- Status prints nothing.
- Diff check succeeds.

- [ ] **Step 8: Re-run final verification on the rewritten branch**

Run:

```bash
npm run check
npm run test:e2e:prebuilt
npm run test:e2e:evidence
docker compose -f docker-compose.demo.yml config
```

Expected: the same results as Task 5. Inspect the Evidence report again because the Evidence run is last.

---

### Task 7: Fast-Forward Local `main`, Verify, and Expose Results

**Files:**
- Merge target: `/Users/a1004/Documents/_projects/openai-webmcp-challenge`
- Modify outside Git: `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md`
- Generated results:
  - `/Users/a1004/Documents/_projects/openai-webmcp-challenge/test-results/evidence/`
  - `/Users/a1004/Documents/_projects/openai-webmcp-challenge/playwright-report/evidence/index.html`

**Interfaces:**
- Consumes: clean rewritten `codex/webmcp-governance`.
- Produces: local `main` at the feature tip, verified Evidence artifacts, and an ignored recording handoff.

- [ ] **Step 1: Reconfirm fast-forward eligibility**

Run from `/Users/a1004/Documents/_projects/openai-webmcp-challenge`:

```bash
git status --porcelain -uall
git -C /private/tmp/openai-webmcp-challenge-webmcp-governance status --porcelain -uall
test "$(git rev-parse HEAD)" = "$(git -C /private/tmp/openai-webmcp-challenge-webmcp-governance merge-base main HEAD)"
git merge --ff-only codex/webmcp-governance
test "$(git rev-parse HEAD)" = "$(git -C /private/tmp/openai-webmcp-challenge-webmcp-governance rev-parse HEAD)"
```

Expected: both worktrees are clean, the merge is fast-forward-only, and `main` equals the feature tip. Stop before merge if the ancestry assertion fails.

- [ ] **Step 2: Run final verification from merged `main`**

Run:

```bash
npm run check
npm run test:e2e:prebuilt
npm run test:e2e:evidence
docker compose -f docker-compose.demo.yml config
git status --short --branch
```

Expected:

- All non-E2E suites pass.
- Full E2E: 198 passed, 2 expected skipped.
- Evidence: 4 passed with four PNGs, successful videos, explicit Writer video, no trace.
- Compose config succeeds.
- `main` is clean.

- [ ] **Step 3: Update the ignored recording handoff**

Append this exact section to `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md` after inspecting that it is not already present:

```markdown
## Automated QA evidence

- Generate: `npm run test:e2e:evidence`
- Screenshots and videos: `/Users/a1004/Documents/_projects/openai-webmcp-challenge/test-results/evidence/`
- HTML report: `/Users/a1004/Documents/_projects/openai-webmcp-challenge/playwright-report/evidence/index.html`
- These are QA artifacts, not the final OpenAI WebMCP Challenge recording.
- Final recording still requires a deployed live ChatGPT WebMCP smoke test.
```

Do not add this external file to the product repository.

- [ ] **Step 4: Verify final paths and boundaries**

Run:

```bash
test -d /Users/a1004/Documents/_projects/openai-webmcp-challenge/test-results/evidence
test -f /Users/a1004/Documents/_projects/openai-webmcp-challenge/playwright-report/evidence/index.html
rg -n "Automated QA evidence|test:e2e:evidence|live ChatGPT WebMCP smoke test" /Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md
git status --short --branch
git log --reverse --format="%h %s" HEAD~4..HEAD
```

Expected: both result paths exist, the ignored handoff contains the exact boundary, `main` is clean, and the four semantic commits are visible.

- [ ] **Step 5: Report completion without external mutation**

Return these clickable paths to the user:

- `/Users/a1004/Documents/_projects/openai-webmcp-challenge/playwright-report/evidence/index.html`
- `/Users/a1004/Documents/_projects/openai-webmcp-challenge/test-results/evidence/`
- `/Users/a1004/Documents/_projects/openai-webmcp-challenge/docs/superpowers/plans/2026-08-31-e2e-evidence-and-history-rewrite.md`
- `/Users/a1004/Documents/_projects/openai-webmcp-challenge/docs/superpowers/specs/2026-08-31-e2e-evidence-and-history-rewrite-design.md`

State explicitly that push, deploy, public repository publication, final demo recording, live ChatGPT smoke testing, and Challenge submission remain undone.
