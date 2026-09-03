# Ground Release and Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden, publish, deploy, and visibly prove the complete Ground MVP, then prepare every repository, media, and submission artifact without claiming an unrun check.

**Architecture:** GitHub `origin` is the public source, Vercel serves the Vite app and two stateless Functions, and one hosted Supabase project owns production Auth/Postgres/Realtime/Cron. A staged production deployment is tested before promotion. Existing Playwright evidence infrastructure records curated successful flows; actual ChatGPT WebMCP validation remains an explicit live acceptance step.

**Tech Stack:** GitHub, GitHub Actions, Vercel Node.js 24 Functions, Supabase hosted Postgres/Auth/Realtime/Cron, Vite, Playwright, WebMCP, Markdown documentation

**Spec:** `docs/superpowers/specs/2026-09-03-ground-hosted-mvp-design.md`

## Global Constraints

- Complete the data-foundation and hosted-product plans first.
- The verified repository remote is `https://github.com/Gumball12/ground`; never force-push or overwrite remote history.
- Resolve exact Vercel team/project and Supabase organization/project with read-only account checks before creating or changing remote resources.
- Never paste Supabase secret keys, access tokens, or Vercel tokens into chat, files, command output, screenshots, or git.
- Production Supabase values are Production-scoped only; Preview receives no production database credentials.
- Use a staged Production deployment (`--prod --skip-domain`), run smoke tests, then promote. Roll back instead of patching live state blindly.
- Preserve CollabMD's MIT license and upstream attribution.
- Keep `.vercel/`, local Supabase state, Playwright output, capacity raw data, and final working footage ignored.
- Automatic Evidence videos are test artifacts; the final narrated submission video is recorded later with the user's other AI collaborator.
- Do not claim actual ChatGPT, hosted isolation, Cron, or production success until each corresponding step is executed and recorded.

## File Structure

- `vercel.json`: Vite output, Node function settings, canonical document rewrite, security headers.
- `src/client/app/robots.txt`: disallow indexing.
- `tests/node/vercel-config.test.js`: routing, environment isolation, and header guardrails.
- `.github/workflows/docker-publish.yml`: existing PR/main validation extended with Supabase and Ground E2E; no duplicate workflow.
- `docs/evidence/ground-hosted-capacity.md`: concrete hosted measurements and selected limits.
- `playwright.ground-evidence.config.js`: curated successful Ground evidence configuration.
- `tests/e2e/helpers/ground-evidence-reporter.js`: required PNG/WebM validation using existing reporter helpers.
- `docs/submission/ground-submission.md`: actual live/repository/evidence links and manual acceptance status.
- `docs/adr/0004-ground-hosted-supabase-runtime.md`: durable local-versus-Ground architecture decision.
- `README.md`, `.env.example`, `AGENTS.md`, `CONTEXT.md`, `docs/architecture.md`: startup, deployment, security, and source-of-truth documentation.
- `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md`: ignored, cross-agent final recording handoff.

---

### Task 1: Configure Vercel routing and browser security

**Files:**
- Create: `vercel.json`
- Create: `src/client/app/robots.txt`
- Create: `tests/node/vercel-config.test.js`
- Modify: `src/client/app/index.html`
- Modify: `src/server/config/ground-hosted-env.js`
- Modify: `tests/node/ground-hosted-env.test.js`

**Interfaces:**
- Produces `/` and exactly one-segment 22-character `/:docId` SPA routes.
- Produces `/app-config.js` -> `/api/app-config` and leaves `/api/ground` as a Function.
- `loadGroundHostedEnv` exposes `allowedOrigins`: configured production origin plus exact `https://${VERCEL_URL}` for the current staged deployment.

- [ ] **Step 1: Write failing Vercel configuration tests**

```js
test('rewrites only a 22-character document id to index.html', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.deepEqual(config.rewrites, [
    { source: '/app-config.js', destination: '/api/app-config' },
    { source: '/:docId([A-Za-z0-9_-]{22})', destination: '/index.html' },
  ]);
  assert.equal(config.outputDirectory, 'dist/client');
});
```

Add four exact cases: API paths precede and do not match the document regex; every security header has the required value; `robots.txt` disallows `/`; and `vercel.json` contains no Supabase URL/key or Preview credential mapping.

- [ ] **Step 2: Run RED**

Run: `node --test tests/node/vercel-config.test.js tests/node/ground-hosted-env.test.js`

Expected: FAIL because `vercel.json` and staged-origin behavior do not exist.

- [ ] **Step 3: Add the minimal Vercel configuration**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "dist/client",
  "framework": null,
  "functions": {
    "api/ground.js": {
      "maxDuration": 10,
      "includeFiles": ["collabmd.governance.json", "docs/demo/launch-plan.md"]
    },
    "api/app-config.js": { "maxDuration": 10 }
  },
  "rewrites": [
    { "source": "/app-config.js", "destination": "/api/app-config" },
    { "source": "/:docId([A-Za-z0-9_-]{22})", "destination": "/index.html" }
  ]
}
```

Add headers for `/` and `/:docId`:

```text
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
```

Set `<meta name="robots" content="noindex,nofollow">` and serve `robots.txt` with `Disallow: /`.

Remove the inline startup script from `index.html` so `script-src 'self'` produces no CSP violation. Move its legacy hash-to-attribute initialization into the external `main-entry.js` before choosing Ground or local bootstrap.

- [ ] **Step 4: Support the exact staged deployment Origin**

`allowedOrigins` contains `GROUND_PUBLIC_ORIGIN` and, only when present, `https://${VERCEL_URL}`. Do not allow suffix matching, arbitrary `*.vercel.app`, `Origin: null`, or caller-provided hosts.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/node/vercel-config.test.js tests/node/ground-hosted-env.test.js
npm run build
npm run test:guardrails
git diff --check
```

Expected: PASS.

```bash
git add vercel.json src/client/app/robots.txt src/client/app/index.html src/server/config/ground-hosted-env.js tests/node/vercel-config.test.js tests/node/ground-hosted-env.test.js
git commit -m "feat: configure secure Ground deployment"
```

### Task 2: Extend existing CI without duplicating it

**Files:**
- Modify: `.github/workflows/docker-publish.yml`
- Modify: `tests/node/guardrails/ground-supabase-tooling.test.js`

**Interfaces:**
- Produces one existing `validate` job that gates local CollabMD plus Ground Supabase and E2E behavior on pull requests and `main`.

- [ ] **Step 1: Extend the failing workflow guard**

Assert the existing workflow contains, in order:

```text
setup-node 24
npm ci
playwright chromium install
npm run supabase:start
npm run test:supabase
npm run check
npm run test:e2e:governance:prebuilt
npm run test:e2e:ground
npm run supabase:stop with if: always()
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/node/guardrails/ground-supabase-tooling.test.js`

Expected: FAIL because CI does not run the Ground suites.

- [ ] **Step 3: Update the existing validation job**

Do not add a second PR workflow. Start Supabase once, reset it through `test:supabase`, run both app suites, and stop containers in an `if: always()` step. Keep Docker image build/publish behavior unchanged.

- [ ] **Step 4: Verify workflow and local equivalents**

Run:

```bash
node --test tests/node/guardrails/ground-supabase-tooling.test.js tests/node/guardrails/ground-node-runtime.test.js
npm run test:supabase
npm run check
npm run test:e2e:governance:prebuilt
npm run test:e2e:ground
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/docker-publish.yml tests/node/guardrails/ground-supabase-tooling.test.js
git commit -m "ci: validate Ground hosted flows"
```

### Task 3: Produce curated Ground screenshots and videos

**Files:**
- Create: `playwright.ground-evidence.config.js`
- Create: `tests/e2e/helpers/ground-evidence-reporter.js`
- Modify: `tests/e2e/helpers/governance-evidence-reporter.js`
- Modify: `tests/e2e/ground-hosted.spec.js`
- Modify: `package.json`
- Modify: `tests/node/playwright-evidence-config.test.js`

**Interfaces:**
- Produces `npm run test:e2e:ground:evidence`.
- Output: `test-results/ground-evidence/` and `playwright-report/ground-evidence/`, both ignored.

- [ ] **Step 1: Write RED evidence-contract tests**

Require these exact PNG attachment names:

```js
[
  'ground-owner-document',
  'ground-pending',
  'ground-manage-access',
  'ground-concurrent-edit',
  'ground-proposal-conflicts',
  'ground-revoked',
  'ground-recovered-owner',
]
```

Require at least one non-empty WebM for each meaningful participant flow: `owner-flow`, `editor-flow`, `reviewer-flow`, and `recovery-flow`. Require zero trace attachments on success.

- [ ] **Step 2: Generalize only the reusable reporter validator**

Extract from the current reporter:

```js
// tests/e2e/helpers/ground-evidence-reporter.js
import GovernanceEvidenceReporter, {
  validateEvidenceResults,
} from './governance-evidence-reporter.js';

const REQUIRED_GROUND_SCREENSHOTS = [
  'ground-concurrent-edit',
  'ground-manage-access',
  'ground-owner-document',
  'ground-pending',
  'ground-proposal-conflicts',
  'ground-recovered-owner',
  'ground-revoked',
];

export default class GroundEvidenceReporter extends GovernanceEvidenceReporter {
  getRequirements() {
    return {
      expectedTestCount: 7,
      meaningfulVideoNames: new Set(['owner-flow', 'editor-flow', 'reviewer-flow', 'recovery-flow']),
      requiredScreenshotNames: REQUIRED_GROUND_SCREENSHOTS,
    };
  }
}
```

Refactor the existing reporter so `onEnd` calls `validateEvidenceResults(results, this.getRequirements())`; its default `getRequirements()` returns the existing six-test/five-PNG governance contract.

Keep the current governance reporter behavior unchanged. The new Ground reporter supplies the Ground requirements above instead of copying the validator.

- [ ] **Step 3: Add the Ground evidence configuration**

Use Chromium, 1280x720, reduced motion, one worker, no retry, explicit test-attached screenshots/videos, and the Ground reporter. Point `baseURL` to `GROUND_E2E_BASE_URL` when set; otherwise use the local `groundServer` fixture.

Add:

```json
"test:e2e:ground:evidence": "npm run build && playwright test --config=playwright.ground-evidence.config.js"
```

- [ ] **Step 4: Attach success evidence at semantic checkpoints**

Reuse the existing `attachEvidenceScreenshot`, `withEvidenceVideo`, and `attachEvidenceVideo` pattern. Record one uninterrupted participant video per flow and only the seven named screenshots. Do not record secrets, recovery token text, browser storage, environment values, or dashboards.

- [ ] **Step 5: Run and inspect every artifact**

Run:

```bash
npm run test:e2e:ground:evidence
find test-results/ground-evidence -type f -maxdepth 4 -print
```

Open all seven PNGs and at least one video from each participant category. Confirm readable text, correct roles, no white-on-white surfaces, no secret token, and no unrelated CollabMD controls.

- [ ] **Step 6: Commit code, not generated media**

```bash
git add playwright.ground-evidence.config.js tests/e2e/helpers tests/e2e/ground-hosted.spec.js tests/node/playwright-evidence-config.test.js package.json package-lock.json
git commit -m "test: capture Ground submission evidence"
```

### Task 4: Calibrate and freeze hosted safety limits

**Files:**
- Modify: `src/domain/ground-hosted-contract.js`
- Modify: `tests/node/ground-hosted-contract.test.js`
- Create: `docs/evidence/ground-hosted-capacity.md`
- Modify: `scripts/measure-ground-hosted-limits.mjs`

**Interfaces:**
- Consumes a staged Vercel production URL and hosted Supabase project.
- Produces committed `MAX_GROUND_DOCUMENT_BYTES`, `MAX_GROUND_UPDATE_BYTES`, and `GROUND_COMPACTION_UPDATE_COUNT` with reproducible evidence.

- [ ] **Step 1: Perform a read-only account and target check**

Run the available equivalents of:

```bash
git remote -v
vercel whoami
supabase projects list
```

Expected: origin is `Gumball12/ground`; exact Vercel and Supabase targets are identified. If no target exists or multiple targets are plausible, stop and ask the user to select the exact organization/project before creating one.

- [ ] **Step 2: Create or select a non-production calibration target only with confirmed authority**

Use no production data. Link the repository to the selected Supabase project and a staged Vercel project, apply migrations, configure anonymous Auth and private Realtime, and set scoped secrets through platform credential stores. Never echo their values.

- [ ] **Step 3: Run the deterministic candidate matrix**

Run ten create/hydrate/reconnect samples for `64_000`, `200_000`, `500_000`, and `1_000_000` bytes, plus replay counts `50`, `100`, and `200`. The selection algorithm is exactly the one tested in the data-foundation plan.

Expected: JSON output names one passing document/update/compaction tuple. If no candidate passes, stop and return to architecture review; do not invent limits.

- [ ] **Step 4: Record evidence and turn it into a failing test**

Write `docs/evidence/ground-hosted-capacity.md` with date, Vercel deployment ID, Supabase region, candidate table, raw-output ignored path, selection formula, and selected constants. Update the contract test to expect those exact values before changing the implementation; run it and confirm RED.

- [ ] **Step 5: Commit the selected constants and verify**

Update the three exports, run:

```bash
node --test tests/node/ground-hosted-contract.test.js
npm run test:supabase
npm run test:e2e:ground
```

Expected: PASS.

```bash
git add src/domain/ground-hosted-contract.js tests/node/ground-hosted-contract.test.js docs/evidence/ground-hosted-capacity.md scripts/measure-ground-hosted-limits.mjs
git commit -m "perf: calibrate Ground hosted limits"
```

### Task 5: Align product, architecture, and deployment documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `AGENTS.md`
- Verify unchanged: `CLAUDE.md`
- Modify: `CONTEXT.md`
- Modify: `docs/architecture.md`
- Create: `docs/adr/0004-ground-hosted-supabase-runtime.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/client/app/index.html`
- Modify: `docs/assets/ground-thumbnail.png`
- Verify: `src/client/app/ground-icon.svg`
- Test: `tests/node/guardrails/focused-product-surface.test.js`
- Test: `tests/node/integration/package-packaging.test.js`

**Interfaces:**
- Produces one accurate public setup/deploy guide and consistent Ground submission branding.

- [ ] **Step 1: Write RED documentation/metadata guards**

Assert:

```text
package name/description/repository identify Ground and https://github.com/Gumball12/ground
LICENSE remains MIT and README credits https://github.com/andes90/collabmd
README contains local Ground, local CollabMD, Supabase migration, Vercel deployment, and Evidence commands
.env.example contains new public/secret names but no values
AGENTS/CONTEXT/architecture distinguish local filesystem truth from Ground Supabase truth
CLAUDE.md is exactly @AGENTS.md
page title/description/favicon use Ground
```

- [ ] **Step 2: Update public README and environment contract**

Lead README with:

```text
Ground - One document, Different roles
Ground is a shared Markdown editor for people and agents. The owner decides who can edit, who can only propose, and who gets no access. The server applies those rules to every WebMCP action.
```

Document exact commands from the prior plans. Explain that `collabmd.governance.json` loads before requests, changing Role composition requires restart/redeploy, and new Capabilities require code. List all environment variable names without sample secrets.

- [ ] **Step 3: Add the hosted ADR and update invariants**

ADR 0004 records Supabase as Ground's durable source, Vercel as stateless, ordered Yjs updates/snapshots, anonymous Auth, document RLS, local CollabMD preservation, and why ADRs 0001-0003 remain a separate CollabMD offering.

Update `AGENTS.md`, `CONTEXT.md`, and `docs/architecture.md` with the same bounded distinction. Do not rewrite unrelated historical documentation.

- [ ] **Step 4: Align package and page metadata**

Set package name to `ground-webmcp`, description to the approved elevator pitch, repository/homepage/bugs to `Gumball12/ground`, and license to MIT. Keep CollabMD CLI attribution and executable behavior documented; do not publish the renamed package in this project.

Use `ground-icon.svg` as favicon and Ground title/description in HTML.

- [ ] **Step 5: Correct the thumbnail identity model**

Visually inspect `docs/assets/ground-thumbnail.png`. Remove Human/AI selectors or badges, retain the approved Ground name, Role distinction, blue/light visual language, and readable dark text on light surfaces. Verify the final image at 3000x2000 and open it after editing. Do not regenerate unrelated screenshots.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test tests/node/guardrails/focused-product-surface.test.js tests/node/integration/package-packaging.test.js
npm run lint
npm run build
git diff --check
```

Expected: PASS; `CLAUDE.md` still contains only `@AGENTS.md`.

```bash
git add README.md .env.example AGENTS.md CONTEXT.md docs/architecture.md docs/adr/0004-ground-hosted-supabase-runtime.md package.json package-lock.json src/client/app/index.html src/client/app/ground-icon.svg docs/assets/ground-thumbnail.png tests/node
git commit -m "docs: prepare Ground for deployment"
```

### Task 6: Publish and stage the production deployment

**Files:**
- No product source changes expected.
- Generated and ignored: `.vercel/`, local environment files, platform CLI state.
- Create after success: `docs/submission/ground-submission.md`

**Interfaces:**
- Produces exact public repository URL, staged deployment URL, production URL, Supabase project reference/region, and deployment IDs without secrets.

- [ ] **Step 1: Run the pre-publish clean-room gate**

Run:

```bash
npm ci
npm run supabase:start
npm run test:supabase
npm run check
npm run test:e2e:governance:prebuilt
npm run test:e2e:ground
npm run test:e2e:ground:evidence
git diff --check
git status --short
```

Expected: all checks PASS; only explicitly intended commits/files remain. Do not use `git clean`, reset, or force-add ignored evidence.

- [ ] **Step 2: Inspect the full branch and push normally**

Run:

```bash
git log --oneline --decorate --reverse upstream/main..HEAD
git diff --stat upstream/main...HEAD
git remote get-url origin
git push -u origin main
```

Expected: push to `https://github.com/Gumball12/ground`; no force push.

- [ ] **Step 3: Configure hosted Supabase without exposing credentials**

Link the exact approved project. Enable anonymous sign-ins, disable public Realtime channels, enable Cron, inspect migration dry-run, then apply migrations. Add only the Vercel Production-scoped `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`, plus a generated `GROUND_RATE_LIMIT_HMAC_KEY`. Do not add these values to Preview or local committed files.

- [ ] **Step 4: Link Vercel and stage Production without assigning the domain**

Set `GROUND_PUBLIC_ORIGIN` to the exact project production domain. Deploy:

```bash
vercel link
vercel --prod --skip-domain
```

Record the returned immutable URL. Verify `/`, `/app-config.js`, `/api/ground?operation=config`, a valid 22-character route, an invalid route, response headers, and absence of secret config.

- [ ] **Step 5: Run hosted smoke and promote**

Run the Ground Playwright suite and Evidence suite with `GROUND_E2E_BASE_URL` set through the process environment, not a committed file. Check Vercel error logs for that deployment. If all pass:

Store the exact returned URL in the current shell as `GROUND_VERIFIED_DEPLOYMENT_URL`, then run:

```bash
vercel promote "$GROUND_VERIFIED_DEPLOYMENT_URL"
```

If any check fails, do not promote; fix through a reviewed commit and new staged deployment.

- [ ] **Step 6: Write and commit actual deployment references**

Create `docs/submission/ground-submission.md` with the repository URL, production URL, immutable tested deployment ID, Supabase region/project reference (not keys), commit SHA, automated command results, Evidence paths, and unchecked live ChatGPT/final-video boxes.

```bash
git add docs/submission/ground-submission.md
git commit -m "docs: record Ground deployment evidence"
git push origin main
```

### Task 7: Verify actual ChatGPT WebMCP and finish the handoff

**Files:**
- Modify: `docs/submission/ground-submission.md`
- Modify outside git: `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md`

**Interfaces:**
- Produces a live acceptance record and a ready-to-record handoff for the user's other AI collaborator.

- [ ] **Step 1: Run the actual ChatGPT Role matrix**

Using the production URL and separate browser contexts:

```text
Owner creates the Launch plan document and saves the recovery link
Writer Agent joins Pending -> Owner assigns Editor
Reviewer Agent joins Pending -> Owner assigns Reviewer
Editor ChatGPT discovers read/apply/propose and applies $100K -> $110K
Reviewer ChatGPT discovers read/propose but not apply and proposes $120K
Owner creates/resolves the overlapping Conflict
Owner revokes Writer; cached apply is denied and local state rehydrates
Activity shows actor, action, time, source, outcome, and target
reload confirms content, proposals, conflicts, Activity, and Roles persist
```

Capture no recovery token, JWT, platform dashboard, or secret. Record exact tool names and outcomes in the submission document.

- [ ] **Step 2: Prove cross-document isolation live**

Create a second document in another anonymous context. Attempt direct read and mutation requests for the first document using the second session. Record safe denial codes and confirm neither response nor Realtime exposes content.

- [ ] **Step 3: Inspect production health after the live run**

Check Vercel Function errors, Supabase Auth/Postgres/Realtime logs, Cron job presence/history, current connection usage, and unexpected 4xx/5xx counts. Redact identifiers and secrets from any saved evidence.

- [ ] **Step 4: Update the ignored recording handoff**

Replace stale statements in `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md` with the verified production URL, exact demo personas, ordered scene list, safe Evidence paths, recovery-token warning, known limitations, and the fact that automatic WebM videos are raw evidence rather than the final narrated video.

- [ ] **Step 5: Finish submission facts without submitting on the user's behalf**

Update `docs/submission/ground-submission.md` with checked live WebMCP results and final asset paths. Leave the final narrated-video URL and submission confirmation unchecked until the user and recording collaborator actually create and submit them. Do not claim submission completion early.

- [ ] **Step 6: Run final verification and commit the public record**

Run:

```bash
npm run check
npm run test:supabase
npm run test:e2e:governance:prebuilt
npm run test:e2e:ground
npm run test:e2e:ground:evidence
git diff --check
git status --short
```

Expected: PASS. Confirm the ignored handoff is not staged.

```bash
git add docs/submission/ground-submission.md
git commit -m "docs: verify Ground live demo"
git push origin main
```
