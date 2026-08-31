# Governed Collaboration E2E Evidence and History Rewrite Design

**Date:** 2026-08-31
**Status:** Approved in chat; pending written-spec review
**Target:** OpenAI WebMCP Challenge follow-up hardening
**Base branch:** `main`
**Feature branch:** `codex/webmcp-governance`

## 1. Summary

Add a reproducible Playwright evidence mode for the four governed-collaboration MVP flows, audit the existing test boundaries without creating duplicate coverage, add those four flows to pull-request validation, and make `AGENTS.md` the shared instruction source for Codex and Claude Code.

After implementation and verification, replace the feature branch's incremental commit history with four semantic English commits while preserving the exact final Git tree. Merge the rewritten branch into local `main` with a fast-forward-only merge.

The evidence recordings are QA artifacts. They support review and later filming, but they do not replace the final Challenge demo or a live ChatGPT WebMCP smoke test.

## 2. Confirmed Baseline

- `tests/e2e/governance.spec.js` already contains four end-to-end tests covering the governed MVP.
- The default Playwright configuration retains screenshots, traces, and videos only for failures.
- Playwright result and report directories are already ignored by Git.
- The existing governance coverage is layered across Node, integration, browser, and E2E tests.
- No high-confidence same-layer duplicate governance test was found in the final read-only audit.
- `AGENTS.md` already documents the repository structure, commands, architecture, product invariants, and test boundaries.
- `CLAUDE.md` does not exist.
- The Docker validation workflow runs `npm run check`, which includes lint and all non-E2E suites, but it does not run the Playwright E2E suite.
- `main` is currently the feature branch's merge base. This must be rechecked immediately before rewriting and merging.

## 3. Scope

### Included

- A separate Playwright Evidence configuration.
- Reuse of the existing four governance E2E tests.
- One named screenshot attachment for the key actor state in each governance flow.
- Successful video recording for the Playwright-managed contexts.
- Explicit video recording and attachment for the manually-created Writer context in the offline and Grant-change flow.
- A local npm command that builds the app and generates the Evidence report.
- The four governance E2E flows in the existing pull-request/main Docker validation job after the existing non-E2E check.
- Snapshot configuration that never creates missing visual baselines implicitly.
- A focused audit of changed tests for unique boundary ownership, deleted coverage, and brittle or redundant assertions.
- A concise durable governance section in `AGENTS.md`.
- A root `CLAUDE.md` containing exactly `@AGENTS.md`.
- An update to the existing ignored recording handoff with the Evidence command and output paths.
- Final history reconstruction and local fast-forward merge into `main`.

### Excluded

- A duplicate showcase or demo E2E suite.
- Recording all CollabMD E2E tests on successful runs.
- Committing generated PNG, WebM, trace, or HTML report artifacts.
- Uploading Playwright traces or recordings from CI.
- Treating Evidence recordings as the final Challenge submission video.
- Live ChatGPT WebMCP discovery, permission, or execution verification before deployment.
- The full inherited CollabMD E2E suite on Ubuntu CI. It remains a required local final check on its existing macOS snapshot platform.
- Linux visual-regression baselines.
- Changes to npm publish, Homebrew release, or landing deployment workflows.
- New product behavior, governance capabilities, accounts, SDK extraction, or image support.
- Push, deployment, publication, or Challenge submission.

## 4. Evidence Flow Boundary

"Each user flow" means the four approved WebMCP Governed Collaboration MVP flows, not every inherited CollabMD capability:

1. **Participant identity and Role presentation**
   - Create a human Owner and an AI Reviewer.
   - Assign the Reviewer Role.
   - Verify the public URL contains only self-declared participant-kind metadata and no credential.
   - Capture the Reviewer page as `ai-reviewer-role`.

2. **Grant lifecycle and execution-time denial**
   - Assign Editor and Reviewer Roles to isolated participant sessions.
   - Verify duplicate-tab locking remains participant-scoped.
   - Change and revoke the Editor Grant.
   - Verify a cached edit tool is denied after revocation.
   - Capture the revoked Writer page as `revoked-editor`.

3. **Collaborative edit, Proposal, Conflict, and resolution**
   - Converge a Writer edit with the Owner document.
   - Create Reviewer and Writer Proposals without direct Reviewer mutation.
   - Produce two same-location Conflicts.
   - Resolve one Conflict and persist terminal Proposal and Activity state.
   - Capture the Owner Review rail as `proposal-conflicts` before resolution.

4. **Local actions, offline freeze, and Grant revalidation**
   - Exercise representative typing, text paste, formatting, task toggle, Undo, and Redo.
   - Freeze mutation after the document connection is interrupted.
   - Reconnect under the same Grant, then change the Grant while refresh is delayed.
   - Discard stale local state and verify the recreated Editor has empty personal history.
   - Capture the Writer page as `offline-grant-revalidated`.

These are existing behavior tests. Evidence capture adds artifacts, not new behavior assertions.

## 5. Playwright Evidence Configuration

Add `playwright.evidence.config.js` by importing the existing configuration and constructing one new config object. Spread shared scalar and `use` settings as needed, but replace the `projects` array completely. Do not pass the base and override as separate arguments to `defineConfig()`, because Playwright merges differently named projects and would retain the default projects.

Use these Evidence settings:

- Test selection: `tests/e2e/governance.spec.js` only.
- Project name: `governance-evidence`.
- Browser: Chromium only.
- Headless execution.
- `viewport: { width: 1280, height: 720 }`.
- `reducedMotion: 'reduce'`.
- `video: 'on'` for Playwright-managed contexts.
- `screenshot: 'off'`; screenshots are explicit named attachments.
- `trace: 'off'` to avoid retaining credentials and network authorization data in successful Evidence artifacts.
- `outputDir: 'test-results/evidence'`.
- HTML report under `playwright-report/evidence` with `open: 'never'`.
- A concise terminal reporter for the run result.

Add `test:e2e:evidence` to `package.json`:

```text
npm run build && playwright test --config=playwright.evidence.config.js
```

The default `playwright.config.js` failure-artifact policy remains unchanged.

Set `updateSnapshots: 'none'` in the default configuration. Existing macOS baselines remain the supported visual-regression reference. Updating or adding a baseline must use an explicit `--update-snapshots` command followed by visual inspection. Ubuntu CI runs the governance file only and therefore does not encounter the macOS-only visual assertions.

## 6. Named Evidence Attachments

Add one small helper to `tests/e2e/governance.spec.js`:

- It runs only when `testInfo.project.name === 'governance-evidence'`.
- It captures the provided actor page at a state already protected by assertions.
- It attaches the screenshot through `testInfo.attach()` using a semantic name and `image/png` content type.
- It does not add snapshot comparison or baseline files.

Each screenshot is captured before the relevant secondary page or context closes. This avoids the default automatic-screenshot limitation where only pages still open at test-function completion are available.

## 7. Manual Writer Context Video

The fourth governance test creates a Writer context through `browser.newContext()` to isolate WebSocket interception and delayed governance refresh behavior. Playwright's normal test-runner video fixture does not manage this context's video lifecycle.

In Evidence mode only:

1. Create that context with an explicit `recordVideo` directory inside the test's ignored output directory.
2. Keep the `Video` handle from the Writer page.
3. Close the Writer context in the existing `finally` path so the recording is finalized.
4. Save and attach the recording with a semantic Writer-flow name.

Normal E2E runs create the same context without `recordVideo`; their behavior and cost remain unchanged.

## 8. Platform-Portable Governance Shortcuts

The governance E2E currently contains macOS-only `Meta` shortcuts, and the shared `replaceEditorContent()` helper uses `Meta+A`. The new Ubuntu CI path must not depend on macOS keyboard semantics.

- Use `Meta` on Darwin and `Control` elsewhere for Undo, Redo, and Select All.
- Reuse one small shortcut formatter in the governance test where practical.
- Update the shared replacement helper to make Select All platform-aware.
- Do not refactor unrelated shortcut tests unless the targeted Ubuntu governance run proves they are in its execution path.

Run the four governance flows in a Node 26 Ubuntu environment with Chromium and ripgrep before changing CI. This is a required validation of the new CI path, not an assumption based on the macOS run.

## 9. Test Audit Rules

Review the changed tests against their actual boundary:

- Pure governance rules and deterministic Proposal algorithms belong in Node tests.
- HTTP, session, manifest, collaboration-room, and authorization wiring belong in integration tests.
- DOM semantics, accessibility, editor action gates, and presentation state belong in browser tests.
- Multi-participant convergence, routing, offline behavior, and execution-time denial belong in E2E tests.
- Visual regression snapshots remain assertions about stable rendering.
- Evidence screenshots remain non-asserting attachments.

Delete a test only when the audit proves that another test at the same boundary detects the same regression with equal or stronger assertions. Do not remove tests merely because a broader E2E reaches the same feature. Do not add coverage-percentage tooling.

Review tests deleted during the governance work against the approved MVP exclusions. Deliberately unsupported governed surfaces, including image paste and attachment upload, do not require replacement governed-mode E2E coverage.

The expected outcome is that no tests are removed unless the audit finds concrete duplication or a false assertion. "No deletion" is a valid audited result.

## 10. CI Validation

Keep the existing `npm run check` step because it includes lint and all non-E2E suites. Add this focused wrapper to `package.json`:

```text
"test:e2e:governance:prebuilt": "playwright test tests/e2e/governance.spec.js"
```

Then add a separate subsequent workflow step:

```text
npm run test:e2e:governance:prebuilt
```

The workflow already installs Node 26, Chromium, and ripgrep. The governance E2E uses the build produced by the non-E2E check. The complete inherited E2E suite remains mandatory before history reconstruction and after the local merge, but it is not promoted to Ubuntu CI in this MVP because its current visual baselines are macOS-only and unrelated inherited tests still contain platform-specific shortcuts.

Do not replace `npm run check` with the current `npm test`: the current `npm test` command does not include lint. Do not upload `test-results/` from CI because failure traces can contain authorization material. Failure artifacts remain useful locally. Do not add Linux snapshots automatically; `updateSnapshots: 'none'` must make missing baselines fail explicitly.

## 11. Agent Instruction SSOT

Keep `AGENTS.md` as the only substantive project instruction file.

Add only durable guidance:

- `collabmd.governance.json` is the Role and Capability source of truth; do not duplicate Role maps in client code.
- Client gating is user experience, while the server must reauthorize WebMCP execution.
- `participantKind` is self-declared presentation metadata, not verified authorization identity.
- Proposal, Conflict, and Activity records are outside document Undo and Redo semantics.
- The supported threat boundary covers the shipped UI and WebMCP flows, not malicious raw Yjs clients.
- Generated Evidence artifacts remain ignored and are created with `npm run test:e2e:evidence`.

Create `CLAUDE.md` with exactly:

```text
@AGENTS.md
```

Do not add Claude-specific duplicate instructions.

## 12. Ignored Recording Handoff

Update `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md` with:

- `npm run test:e2e:evidence`.
- `test-results/evidence/` and `playwright-report/evidence/`.
- A note that these are QA artifacts, not the final Challenge recording.
- A reminder that the final recording still requires a deployed live ChatGPT WebMCP smoke test.

This file is outside the product repository and ignored by its owning workspace. It is a non-Git side effect, is not included in `FINAL_TREE`, and must be verified separately after the product branch is merged.

## 13. History Reconstruction

History reconstruction happens only after implementation is complete, all intended files are committed, and the feature worktree is clean.

### Capture exact state

1. Recompute `BASE` with `git merge-base main HEAD`; do not assume a commit count or use `HEAD~N`.
2. Record the final commit SHA.
3. Record `HEAD^{tree}` as `FINAL_TREE`.
4. Confirm both the feature worktree and the local `main` worktree are clean.

### Preserve changes and rebuild history

Reset the feature branch to `BASE` with a mixed reset so tracked file changes remain in the working tree. Recommit the final tree in these semantic groups:

1. `feat: add governed collaboration core`
   - Governance contracts, `collabmd.governance.json`, manifest loading, session control, server authorization, Proposal/Activity domain logic, and their focused Node/integration tests.

2. `feat: add governed collaboration experience`
   - Client governance state, mutation gates, WebMCP registry behavior, collaboration integration, UI, styles, and their browser/focused Node tests.

3. `test: cover governed collaboration workflows`
   - E2E fixture adaptations, governance E2E, existing-flow adaptations, visual snapshots, Evidence configuration, npm Evidence command, and CI validation.

4. `docs: package governed collaboration demo`
   - README and environment documentation, Docker/Caddy deployment packaging, launch and design documentation, `AGENTS.md`, and `CLAUDE.md`.

Before each commit, inspect the staged diff. Assign whole files to one semantic group where possible; use partial staging only when a cross-cutting file genuinely contains two independently-owned changes.

### Prove equivalence

After the fourth commit:

- The feature worktree must be clean.
- The rewritten `HEAD^{tree}` must equal `FINAL_TREE` exactly.
- `git diff --check BASE..HEAD` must pass.
- Review the complete rewritten branch diff and each semantic commit.

The recorded pre-rewrite commit SHA remains the immediate recovery point until the merge and final verification complete.

## 14. Merge Safety

Immediately before merging:

1. Confirm local `main` is clean.
2. Confirm `main` has not moved since `BASE` was recorded.
3. Confirm `git merge-base main HEAD` equals `main`.
4. Stop and re-evaluate if any of these checks fail.
5. Merge with `git merge --ff-only codex/webmcp-governance` from the `main` worktree.

Do not push, deploy, publish, or delete the feature worktree as part of this scope.

## 15. Verification

Run focused checks while implementing, then run this final sequence on the rewritten branch:

1. `npm run lint`
2. Focused changed Node and browser tests
3. `npm run check`
4. `npm run test:e2e:prebuilt`
5. `npm run test:e2e:evidence`
6. Verify the Evidence report contains four passing governance flows, four named screenshots, Playwright-managed successful videos, and the explicit Writer-context video.
7. Verify `test-results/` and `playwright-report/` remain untracked.
8. `docker compose -f docker-compose.demo.yml config`
9. Run `npm run test:e2e:governance:prebuilt` in the Node 26 Ubuntu/Chromium/ripgrep environment used by CI.
10. Verify no missing snapshot baseline was generated and `updateSnapshots` is `none` by default.
11. `git diff --check BASE..HEAD`
12. Verify the feature worktree is clean.

After the fast-forward merge, rerun at minimum:

1. `npm run check`
2. `npm run test:e2e:prebuilt`
3. `npm run test:e2e:evidence`
4. Verify the ignored recording handoff contains the Evidence command, paths, and live-smoke boundary.
5. Verify local `main` is clean and points to the rewritten feature tip.

## 16. Acceptance Criteria

- The default E2E configuration still retains artifacts only for failures.
- One command generates ignored successful Evidence for exactly four governance tests.
- The Evidence report exposes one semantic screenshot per flow.
- The fourth flow includes a Writer-page video from its manually-created context.
- Evidence mode produces no trace files.
- No generated Evidence artifact is tracked by Git.
- No duplicate showcase test suite exists.
- Existing tests are removed only with concrete same-boundary duplication evidence.
- Pull requests and `main` run lint, non-E2E tests, and the four governance E2E flows before Docker publication.
- Missing visual baselines are never created implicitly.
- The governance E2E shortcuts pass in the Ubuntu CI environment.
- `AGENTS.md` contains concise durable governance guidance.
- `CLAUDE.md` contains exactly `@AGENTS.md`.
- Rewritten history contains four semantic English commits after `main`.
- The rewritten Git tree exactly matches the verified pre-rewrite final tree.
- Local `main` receives the branch only through a fast-forward merge.
- The ignored recording handoff is updated separately and remains outside the Git tree.
- Push, deployment, publication, and live ChatGPT verification remain unperformed.

## 17. Primary References

- [Playwright recording options](https://playwright.dev/docs/test-use-options)
- [Playwright `testInfo.attach()`](https://playwright.dev/docs/api/class-testinfo#test-info-attach)
- [Playwright videos](https://playwright.dev/docs/videos)
- [OpenAI Codex project instructions with `AGENTS.md`](https://developers.openai.com/codex/guides/agents-md)
- [Claude Code `AGENTS.md` import guidance](https://code.claude.com/docs/en/memory#agentsmd)
