# Focused Governed Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered, expiry-based governed shell with a focused single-document workspace that uses room-lifetime Roles, explicit access actions, source-labelled Activity, and status-only Pending and Revoked views.

**Architecture:** Shrink the server governance contract first, then propagate its snapshot and request shapes through the shared Activity domain, client application seams, and presentation controller. The focused workspace is the only product shell: remove excluded markup and bootstrap wiring, delete feature-owned files only after reference inspection proves they are unreachable, and retain only shared CodeMirror/Yjs/Proposal primitives with focused consumers.

**Tech Stack:** Node.js 26, ES modules, Yjs, CodeMirror, DOM presentation controllers, Vite, Node test runner, Vitest Browser Mode, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md`

## Global Constraints

- Use Node.js 26 and npm; do not add dependencies.
- Keep `grant.manage`, `/api/governance/grants/*`, and internal `grant_*` event names unless a user-facing requirement needs different copy.
- Remove `defaultGrantMinutes`, `expiresInMinutes`, governed `expiresAt`, the `expired` state, and `document.comment` from the governed contract only.
- A Role lasts until Owner update, Owner revocation, or server restart.
- The server remains authoritative; client visibility is never authorization.
- The focused workspace is the only product mode; do not add a classic/governed switch, CLI flag, URL query, or test-only product mode.
- Remove excluded product markup and runtime wiring instead of CSS-hiding it.
- Delete feature-owned source and product E2E only after repository-wide references show no focused consumer.
- Retain shared CodeMirror, Yjs text, awareness/cursor, Proposal, Activity, and persistence primitives only when focused runtime or focused tests consume them.
- Remove the visible file tree but retain the existing non-visual `FileTreeState`
  projection of `WorkspaceSyncClient` paths for active-editor wiki-link
  completion; do not replace the callback with an empty list.
- Pending and Revoked states expose no document text, editor, preview, comments, or WebMCP document tools.
- Public Activity shows actor, action, timestamp, source, outcome, and target, but never claims tamper resistance or stores full direct-edit diffs.
- Public UI copy uses `Role`, `Access`, `Assign role`, `Update role`, and `Revoke access`; it does not expose Grant duration vocabulary.
- Raw colors remain confined to `src/client/styles/foundation/themes.css`; reuse existing tokens elsewhere.
- Preserve keyboard access, visible focus, reduced motion, and narrow-screen reflow.
- Evidence artifacts remain ignored under `test-results/` and `playwright-report/`.
- Vercel, Supabase, group/document routes, durable audit, and Share are Post-MVP and must not enter implementation.
- Use conventional English commit subjects and stage only files owned by the completed task.

---

## File Structure

### New files

- `src/client/domain/governance-shell-state.js`: pure fail-closed derivation of loading, error, and ready access phases.
- `tests/node/governance-shell-state.test.js`: focused table tests for loading, path matching, failure, and ready access states.
- `tests/node/guardrails/focused-product-surface.test.js`: forbid removed DOM IDs and bootstrap feature entrypoints.

### Primary modified files

- `src/domain/governance-contract.js`: focused capability vocabulary.
- `src/domain/governance-activity.js`: required Activity source vocabulary and validation.
- `src/domain/governance-proposals.js`: propagate source through Proposal creation, revalidation, and resolution.
- `src/server/config/governance-manifest.js`: reject removed duration and Comment contracts.
- `src/server/domain/governance-session-registry.js`: room-lifetime Role state machine and revoke semantics.
- `src/server/infrastructure/http/create-governance-api-handler.js`: `{ roleId }` assignment request contract.
- `src/server/domain/collaboration/collaboration-room.js`: system reconciliation Activity source.
- `collabmd.governance.json`: focused default Role manifest.
- `src/client/application/app-shell/ui-feature-tab-activity.js`: fail-closed governance loading/error lifecycle.
- `src/client/application/app-shell/governance-feature.js`: focused shell rendering, Activity source, and explicit access commands; remove legacy hide/restore behavior.
- `src/client/application/app-shell-elements.js`: bind only focused shell controls and remove excluded surface bindings.
- `src/client/application/workspace-coordinator.js`: authoritative access transitions and clean-versus-dirty discard signal.
- `src/client/infrastructure/editor-collaboration-client.js`: disconnected local-update tracking.
- `src/client/infrastructure/editor-session.js`: expose unsynchronized-local-change state and Activity source.
- `src/client/presentation/governance-ui-controller.js`: Owner-only rail, status views, source-labelled Activity, and explicit Manage access form.
- `src/client/bootstrap/collabmd-app-shell.js`: wire new callbacks and clear document presentation on access loss.
- `src/client/app/index.html`: focused status panel and simplified Manage access markup.
- `src/client/styles/features/governance.css`: focused layout, status views, and narrow-screen reflow.
- `tests/e2e/helpers/app-fixture.js`: visible explicit Role-action helpers.
- `tests/e2e/governance.spec.js`: focused multi-context workflow and five evidence states.
- `tests/e2e/ui-visual.spec.js`: reviewed focused governed baselines.
- `README.md`: user-facing focused workflow, configuration, Activity, and limitations.
- `AGENTS.md`: durable focused-governance invariants and test guidance.

### Existing focused test files

- `tests/node/governance-contract.test.js`
- `tests/node/governance-manifest.test.js`
- `tests/node/governance-session-registry.test.js`
- `tests/node/governance-api-handler.test.js`
- `tests/node/governance-activity.test.js`
- `tests/node/governance-proposals.test.js`
- `tests/node/editor-session.test.js`
- `tests/node/workspace-coordinator.test.js`
- `tests/node/file-tree-state.test.js`
- `tests/node/wiki-link-completions.test.js`
- `tests/node/wiki-link-resolver.test.js`
- `tests/node/collaboration-room.test.js`
- `tests/node/integration/http-server.test.js`
- `tests/node/integration/package-packaging.test.js`
- `tests/browser/governance-ui-controller.browser.test.js`
- `tests/browser/ui-feature.browser.test.js`
- `tests/browser/editor-view-adapter.browser.test.js`
- `tests/node/playwright-evidence-config.test.js`

---

### Task 1: Record the Approved Redesign

**Files:**
- Add: `docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md`
- Add: `docs/superpowers/plans/2026-09-01-focused-governed-workspace.md`

**Interfaces:**
- Consumes: approved As-is/To-be decisions from the current thread.
- Produces: immutable execution inputs for every later task.

- [ ] **Step 1: Verify that only the approved documents are untracked**

Run:

```bash
git status --short --branch
```

Expected: `main` plus exactly the new spec and plan paths; stop if unrelated changes appear.

- [ ] **Step 2: Verify document formatting**

Run:

```bash
git diff --no-index --check /dev/null docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md || test $? -eq 1
git diff --no-index --check /dev/null docs/superpowers/plans/2026-09-01-focused-governed-workspace.md || test $? -eq 1
node -e 'const fs=require("fs");const paths=process.argv.slice(1);const banned=["T"+"BD","T"+"ODO","FIX"+"ME","PLACE"+"HOLDER","implement "+"later","add "+"appropriate","similar to "+"Task"];for(const path of paths){const text=fs.readFileSync(path,"utf8");for(const token of banned){if(text.includes(token)){console.error(path+": "+token);process.exitCode=1;}}}' \
  docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md \
  docs/superpowers/plans/2026-09-01-focused-governed-workspace.md
```

Expected: both diff checks produce no whitespace diagnostics; `rg` produces no matches.

- [ ] **Step 3: Commit the approved design checkpoint**

```bash
git add docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md \
  docs/superpowers/plans/2026-09-01-focused-governed-workspace.md
git commit -m "docs: define focused governed workspace"
```

---

### Task 2: Simplify the Server Governance Contract

**Files:**
- Modify: `src/domain/governance-contract.js:1-12`
- Modify: `src/server/config/governance-manifest.js:8-51`
- Modify: `src/server/domain/governance-session-registry.js:1-188`
- Modify: `src/server/infrastructure/http/create-governance-api-handler.js:83-158`
- Modify: `collabmd.governance.json`
- Test: `tests/node/governance-contract.test.js`
- Test: `tests/node/governance-manifest.test.js`
- Test: `tests/node/governance-session-registry.test.js`
- Test: `tests/node/governance-api-handler.test.js`
- Test: `tests/node/integration/http-server.test.js`
- Test: `tests/node/integration/package-packaging.test.js`

**Interfaces:**
- Consumes: current `GovernanceSessionRegistry` and `/api/governance/grants/:participantSessionId` route names.
- Produces: `assignRole(ownerCredential, { participantSessionId, roleId })`; snapshots with `pending | active | revoked`, no `expiresAt`; PUT body `{ roleId }`; focused manifest without Comment or duration.

- [ ] **Step 1: Rewrite the manifest and capability tests first**

Replace the valid test manifest with:

```js
const validManifest = {
  roles: {
    owner: [
      'document.read',
      'document.suggest',
      'document.edit',
      'conflict.resolve',
      'grant.manage',
    ],
    editor: ['document.read', 'document.suggest', 'document.edit'],
    reviewer: ['document.read', 'document.suggest'],
  },
};
```

Add exact rejection coverage:

```js
assert.throws(
  () => validateGovernanceManifest({ ...validManifest, defaultGrantMinutes: 60 }),
  /defaultGrantMinutes is not supported/,
);
assert.throws(
  () => validateGovernanceManifest({
    roles: { ...validManifest.roles, reviewer: ['document.read', 'document.comment'] },
  }),
  /Unknown governance capability: document\.comment/,
);
```

- [ ] **Step 2: Rewrite registry tests for the three-state lifecycle**

Add or replace assertions with:

```js
registry.assignRole(owner.credential, {
  participantSessionId: writer.participantSessionId,
  roleId: 'editor',
});
const active = registry.getSnapshot(writer.credential);
assert.equal(active.state, 'active');
assert.equal(active.roleId, 'editor');
assert.equal(Object.hasOwn(active, 'expiresAt'), false);

registry.revoke(owner.credential, writer.participantSessionId);
const revoked = registry.getSnapshot(writer.credential);
assert.equal(revoked.state, 'revoked');
assert.equal(revoked.roleId, undefined);
assert.deepEqual(revoked.capabilities, []);
```

Add strict same-Role idempotency:

```js
const before = registry.getSnapshot(owner.credential).version;
registry.assignRole(owner.credential, {
  participantSessionId: writer.participantSessionId,
  roleId: 'editor',
});
assert.equal(registry.getSnapshot(owner.credential).version, before);
```

- [ ] **Step 3: Rewrite API tests for a Role-only body**

Use:

```js
const response = await harness.request('PUT', path, {
  body: { roleId: 'editor' },
  credential: owner.credential,
});
assert.equal(response.status, 200);
assert.equal(response.body.state, 'active');
assert.equal(Object.hasOwn(response.body, 'expiresAt'), false);
```

Add a failure for a removed input:

```js
assert.equal((await harness.request('PUT', path, {
  body: { expiresInMinutes: 60, roleId: 'editor' },
  credential: owner.credential,
})).status, 400);
```

- [ ] **Step 4: Run the RED server contract tests**

Run:

```bash
node --test \
  tests/node/governance-contract.test.js \
  tests/node/governance-manifest.test.js \
  tests/node/governance-session-registry.test.js \
  tests/node/governance-api-handler.test.js
```

Expected: failures mention `document.comment`, `defaultGrantMinutes`, `expiresInMinutes`, `expiresAt`, and the retained Role after revoke.

- [ ] **Step 5: Implement the focused capability and manifest contracts**

Set the capability vocabulary to:

```js
export const GOVERNANCE_CAPABILITIES = Object.freeze([
  'document.read',
  'document.suggest',
  'document.edit',
  'conflict.resolve',
  'grant.manage',
]);
```

Add explicit removed-field validation before Role validation:

```js
if (Object.hasOwn(manifest, 'defaultGrantMinutes')) {
  throw new TypeError('defaultGrantMinutes is not supported by the focused governance manifest.');
}
```

Update `collabmd.governance.json` to the exact `validManifest` shape from Step 1.

- [ ] **Step 6: Implement the room-lifetime registry state machine**

Remove `isGrantDuration` and every `expiresAt` read/write. Use this public signature:

```js
assignRole(ownerCredential, { participantSessionId, roleId })
```

Implement state precedence and revoke semantics as:

```js
const state = participant.revokedAt !== undefined
  ? 'revoked'
  : participant.roleId === undefined
    ? 'pending'
    : 'active';
```

```js
const revokedAt = this.#now();
participant.revokedAt = revokedAt;
participant.roleId = undefined;
room.version += 1;
return this.#snapshot(room, participant, revokedAt);
```

Before issuing a new Role, make same-Role active assignment a no-op; otherwise set `issuedAt`, clear `revokedAt`, set `roleId`, and increment version once.

- [ ] **Step 7: Implement the Role-only HTTP request**

Parse only `roleId` and reject every extra field. Add beside
`isNonEmptyString`:

```js
const isObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);
```

Use the existing `jsonResponse` helper:

```js
if (!isObject(body)
  || typeof body.roleId !== 'string'
  || Object.keys(body).length !== 1) {
  jsonResponse(request, response, 400, { error: 'Role assignment requires only roleId.' });
  return;
}
const snapshot = registry.assignRole(session.credential, {
  participantSessionId,
  roleId: body.roleId,
});
```

Keep route names and Owner authorization unchanged.

- [ ] **Step 8: Align integration and packaging fixtures**

Replace duration/comment manifests in `http-server.test.js` and `package-packaging.test.js` with the focused manifest. Assert the packed default manifest has no `defaultGrantMinutes` and no `document.comment`.

- [ ] **Step 9: Run focused server verification**

Run:

```bash
node --test \
  tests/node/governance-contract.test.js \
  tests/node/governance-manifest.test.js \
  tests/node/governance-session-registry.test.js \
  tests/node/governance-api-handler.test.js \
  tests/node/integration/http-server.test.js \
  tests/node/integration/package-packaging.test.js
```

Expected: all listed tests pass.

- [ ] **Step 10: Commit the server contract**

```bash
git add collabmd.governance.json \
  src/domain/governance-contract.js \
  src/server/config/governance-manifest.js \
  src/server/domain/governance-session-registry.js \
  src/server/infrastructure/http/create-governance-api-handler.js \
  tests/node/governance-contract.test.js \
  tests/node/governance-manifest.test.js \
  tests/node/governance-session-registry.test.js \
  tests/node/governance-api-handler.test.js \
  tests/node/integration/http-server.test.js \
  tests/node/integration/package-packaging.test.js
git commit -m "refactor: simplify governed role lifecycle"
```

---

### Task 3: Record How Each Activity Happened

**Files:**
- Modify: `src/domain/governance-activity.js:1-36`
- Modify: `src/domain/governance-proposals.js:71-218`
- Modify: `src/client/infrastructure/editor-session.js:268-280,515-563`
- Modify: `src/client/application/app-shell/governance-feature.js:60-108,240-275`
- Modify: `src/server/domain/collaboration/collaboration-room.js:628-639`
- Test: `tests/node/governance-activity.test.js`
- Test: `tests/node/governance-proposals.test.js`
- Test: `tests/node/editor-session.test.js`
- Test: `tests/node/collaboration-room.test.js`
- Test: `tests/browser/ui-feature.browser.test.js`

**Interfaces:**
- Consumes: existing `appendActivity(activityArray, record)` and Proposal APIs.
- Produces: required `record.source`; `GOVERNANCE_ACTIVITY_SOURCES`; source-aware `createProposal` and `revalidateOpenProposals` inputs.

- [ ] **Step 1: Add RED Activity source tests**

Add:

```js
assert.throws(() => appendActivity(activity, {
  action: 'direct_edit_applied',
  actor,
  outcome: 'applied',
  target: 'document',
}), /Activity source is required/);

assert.throws(() => appendActivity(activity, {
  action: 'direct_edit_applied',
  actor,
  outcome: 'applied',
  source: 'unknown_channel',
  target: 'document',
}), /Unknown Activity source/);
```

Add a successful record assertion using `source: 'document_editor'`.

- [ ] **Step 2: Add RED writer tests**

Assert these exact sources:

```js
assert.equal(activity.at(0).source, 'webmcp_proposal');
assert.equal(activity.at(-1).source, 'owner_decision');
```

In editor-session tests, assert local bursts use `document_editor` and structured exact edits use `webmcp_apply`. In collaboration-room reconciliation tests, assert `system_reconciliation`. In `ui-feature.browser.test.js`, replace the expiry-cycle test with a transition test proving snapshot observation appends `participant_joined` only and never synthesizes `grant_assigned`, `grant_changed`, or `grant_revoked`.

- [ ] **Step 3: Make Activity writers unambiguous in tests and implementation**

Keep `appendGovernanceLifecycleActivity()` as a snapshot-observer writer for
`participant_joined` only. Remove the `expired` branch entirely. The explicit
Owner access commands remain the only writer for `grant_assigned`,
`grant_changed`, and `grant_revoked`, and they append only after the server
acknowledges the request.

Add one duplicate-prevention assertion: a single Role assignment changes the
shared Activity array by exactly one access-management record.

- [ ] **Step 4: Run the RED Activity tests**

Run:

```bash
node --test \
  tests/node/governance-activity.test.js \
  tests/node/governance-proposals.test.js \
  tests/node/editor-session.test.js \
  tests/node/collaboration-room.test.js
npm run test:browser -- tests/browser/ui-feature.browser.test.js
```

Expected: failures show that `source` is absent from stored Activity records.

- [ ] **Step 5: Add the domain source vocabulary**

```js
export const GOVERNANCE_ACTIVITY_SOURCES = Object.freeze([
  'document_editor',
  'webmcp_apply',
  'webmcp_proposal',
  'owner_decision',
  'access_management',
  'system_reconciliation',
]);
```

In `appendActivity`, validate and store:

```js
const source = requiredString(record.source, 'Activity source');
if (!GOVERNANCE_ACTIVITY_SOURCES.includes(source)) {
  throw new TypeError(`Unknown Activity source: ${source}.`);
}
```

- [ ] **Step 6: Propagate sources through every writer**

Use these exact mappings:

```js
// Local CodeMirror/Yjs edit burst
source: 'document_editor'

// Structured apply, failed exact target, and its revalidation
source: 'webmcp_apply'

// Proposal creation
source: 'webmcp_proposal'

// Keep current / Apply and resulting revalidation
source: 'owner_decision'

// Participant join
source: 'access_management'

// Role assign/change/revoke from explicit Owner command
source: 'access_management'

// Filesystem reconciliation and its revalidation
source: 'system_reconciliation'
```

Change `revalidateOpenProposals` to accept a required `source` option and pass it into each `proposal_status_changed` Activity. Change `createProposal` to require `input.source`, because a failed WebMCP apply and a Proposal tool call use different sources. `resolveProposal` supplies `owner_decision` internally.

Repeated snapshot observation and Yjs replay must leave each
command-authored access record singular.

- [ ] **Step 7: Run focused Activity verification**

Run the Step 4 commands again.

Expected: all listed tests pass, every stored Activity record has one allowed
source, and snapshot observation cannot duplicate command-authored access
Activity.

- [ ] **Step 8: Commit Activity provenance**

```bash
git add src/domain/governance-activity.js \
  src/domain/governance-proposals.js \
  src/client/infrastructure/editor-session.js \
  src/client/application/app-shell/governance-feature.js \
  src/server/domain/collaboration/collaboration-room.js \
  tests/node/governance-activity.test.js \
  tests/node/governance-proposals.test.js \
  tests/node/editor-session.test.js \
  tests/node/collaboration-room.test.js \
  tests/browser/ui-feature.browser.test.js
git commit -m "feat: record governance activity sources"
```

---

### Task 4: Replace the CollabMD Shell with the Focused Product

**Files:**
- Create: `src/client/domain/governance-shell-state.js`
- Create: `tests/node/governance-shell-state.test.js`
- Create: `tests/node/guardrails/focused-product-surface.test.js`
- Modify: `src/client/application/app-shell/ui-feature-tab-activity.js:36-83`
- Modify: `src/client/application/app-shell/governance-feature.js:4-221`
- Modify: `src/client/application/app-shell/ui-feature-shell.js`
- Modify: `src/client/application/app-shell/ui-feature-toolbar.js`
- Modify: `src/client/application/app-shell-elements.js:1-114`
- Modify: `src/client/application/workspace-route-controller.js`
- Modify: `src/client/application/workspace-coordinator.js`
- Modify: `src/client/bootstrap/collabmd-app-shell.js:178-216,826-834`
- Modify: `src/client/presentation/governance-ui-controller.js:1-401`
- Modify: `src/client/app/index.html:153-625`
- Modify: `src/client/styles/features/governance.css`
- Reuse unchanged: `src/client/presentation/file-tree-state.js`
- Test: `tests/browser/ui-feature.browser.test.js`
- Test: `tests/browser/governance-ui-controller.browser.test.js`
- Test: `tests/node/file-tree-state.test.js`
- Test: `tests/node/wiki-link-completions.test.js`
- Test: `tests/node/wiki-link-resolver.test.js`

**Interfaces:**
- Consumes: snapshots with `pending | active | revoked` and focused Role capabilities.
- Produces: `deriveGovernanceShellState(input)` returning `{ accessState, phase }`; `#governanceStatusPanel`; Owner-only rail; no legacy shell markup or runtime initialization; non-visual current-vault paths for active-editor wiki-link completion.

- [ ] **Step 1: Write the pure shell-state RED tests**

Use this table:

```js
const cases = [
  {
    expected: { accessState: null, phase: 'loading' },
    input: { currentFilePath: 'README.md', requestedDocumentPath: 'README.md', snapshot: null },
  },
  {
    expected: { accessState: null, phase: 'error' },
    input: { currentFilePath: 'README.md', error: new Error('offline'), requestedDocumentPath: 'README.md', snapshot: null },
  },
  {
    expected: { accessState: 'pending', phase: 'ready' },
    input: {
      currentFilePath: 'README.md',
      requestedDocumentPath: 'README.md',
      snapshot: { documentPath: 'README.md', state: 'pending' },
    },
  },
];
```

Add a mismatched-snapshot case that stays `loading`, never `ready`.

- [ ] **Step 2: Run the shell-state test to verify RED**

Run:

```bash
node --test tests/node/governance-shell-state.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `governance-shell-state.js`.

- [ ] **Step 3: Implement pure state derivation**

```js
export const deriveGovernanceShellState = ({
  currentFilePath,
  error = null,
  requestedDocumentPath,
  snapshot,
} = {}) => {
  if (error) {
    return { accessState: null, phase: 'error' };
  }
  if (!currentFilePath
    || requestedDocumentPath !== currentFilePath
    || snapshot?.documentPath !== currentFilePath) {
    return { accessState: null, phase: 'loading' };
  }
  return { accessState: snapshot.state, phase: 'ready' };
};
```

- [ ] **Step 4: Add a RED removed-surface guardrail**

The guardrail reads `src/client/app/index.html`,
`src/client/application/app-shell-elements.js`,
`src/client/bootstrap/collabmd-app-shell.js`, the app-shell feature index, and
`src/client/styles/features/governance.css`.
Use an explicit forbidden list:

```js
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
```

Assert each `id="..."` is absent from HTML and each corresponding bootstrap
binding/import token is absent. Also forbid the literal
`getFileList: () => []` and require the focused bootstrap to retain
`WorkspaceSyncClient` plus `FileTreeState`. The test must fail against the
current shell. Forbid `data-governed`, `isGovernedMode`, and
`GOVERNED_SURFACE_KEYS`; permanent focused styling uses its own shell classes,
not a dormant mode switch.

- [ ] **Step 5: Remove excluded markup and bootstrap entrypoints**

Delete the sidebar, file-tree navigation, Create, global Search, generic Share,
Chat, formatting/wrap toolbar, split/preview controls and pane, Comments UI,
outline, old presence/follow, and toolbar overflow markup from `index.html`.

Remove their element bindings, event listeners, controller construction, and
feature mixins from the focused bootstrap. Do not replace them with hidden
elements or no-op buttons. Keep the document title, connection state,
Participant bar, editor container, governance status panel, Owner rail, Manage
access dialog, display-name onboarding dialog, and tab-lock overlay.

Rewire `WorkspaceRouteController` and `WorkspaceCoordinator` to open only the
route-selected Markdown document and create `EditorSession` directly. Remove
preview/diff/file-explorer callbacks from their focused constructor paths. Do
not pass `getFileList: () => []`: current wiki-link resolution and autocomplete
still depend on a live document list.

Keep `WorkspaceSyncClient` as non-visual infrastructure and reuse the existing
`FileTreeState` class directly in bootstrap; do not add a second document-index
helper or keep a hidden file-explorer controller:

```js
this.documentIndex = new FileTreeState();
this.workspaceSync = new WorkspaceSyncClient({
  onTreeChange: (tree) => {
    this.documentIndex.setTree(tree);
  },
  onWorkspaceEvent: (event) => void this.handleIncomingWorkspaceEvent(event),
});
```

Pass the current lists with the existing semantics:

```js
getFileList: () => this.documentIndex.flatFiles.filter(
  (path) => !isImageAttachmentFilePath(path),
),
getVaultFileList: () => this.documentIndex.flatFiles,
```

Use those callbacks in `WorkspaceCoordinator` and `EditorSession`. Pending and
Revoked states still create no editor, and access loss clears the session in
Task 6. Do not retain `FileExplorerController` as a hidden data adapter. Keep
`WikiLinkFileController` out of the runtime because its click consumer was the
removed preview; retain the pure resolver tests.

- [ ] **Step 6: Add the status surface and focused elements**

Add directly after the Participant bar:

```html
<section id="governanceStatusPanel" class="governance-status-panel" hidden aria-live="polite">
  <div class="governance-status-card">
    <span class="governance-status-icon" aria-hidden="true"></span>
    <h2 data-governance-status-title></h2>
    <p data-governance-status-copy></p>
    <button type="button" class="ui-button ui-button--secondary" data-governance-retry hidden>Retry</button>
  </div>
</section>
```

Bind only the new status panel fields plus the retained editor, Participant,
rail, Manage access, connection, onboarding, and tab-lock elements.

- [ ] **Step 7: Add focused wiki-link coverage for the retained document index**

In `ui-feature.browser.test.js`, drive `WorkspaceSyncClient.onTreeChange` with
`README.md`, `docs/guide.md`, and one image attachment, then assert the editor
`getFileList` callback returns only the two non-image paths while
`getVaultFileList` still includes the image path. Also assert there is no
file-explorer DOM or controller in the focused runtime. Keep the existing
`FileTreeState`, wiki-link completion, and pure resolver tests.

- [ ] **Step 8: Make application initialization fail closed**

Track one application state object:

```js
this.governanceLoad = {
  documentPath,
  error: null,
  phase: 'loading',
};
```

Set it before `restoreOrCreate`. On success set `phase: 'ready'`; on failure
retain the document path, set `phase: 'error'`, clear the snapshot, and render
the safe error shell. The focused product has no writable fallback shell.

Change the initializer signature to:

```js
async initializeGovernanceTabActivity(documentPath, { force = false } = {})
```

The Retry button calls the same method with the current path and
`{ force: true }`; it does not reload the whole page. Delete
`GOVERNED_SURFACE_KEYS`, `_governanceSurfaceState`, `syncGovernedSurfaces`, and
`isGovernedMode`; remove body `data-governed` toggling and rewrite the focused
CSS selectors without that attribute gate. The product has one shell.

- [ ] **Step 9: Render Role-aware focused states**

Pass `shellState` to `GovernanceUiController.render`:

```js
this.governanceUi.render({
  activity: context?.activity?.toArray?.() ?? [],
  connectionState: this.connectionState,
  participants: this.governanceSnapshot?.participants ?? [],
  reviewGroups,
  roles: this.governanceRoles ?? {},
  session: this.governanceSnapshot,
  shellState: deriveGovernanceShellState(...),
});
```

Rules:

```js
const isOwner = state.session?.state === 'active'
  && state.roles[state.session?.roleId]?.includes('grant.manage') === true;
```

- Owner: show editor, Participant bar, rail, and Manage access.
- Active non-Owner: show editor and Participant bar; hide rail and Manage access.
- Pending: show Participant bar plus `Waiting for access`; hide document and rail.
- Revoked: show Participant bar plus `Access revoked`; hide document and rail.
- Loading/error: show only the neutral status surface; error exposes Retry.

The Participant bar renders one compact connection label from
`connectionState.status`: `Connecting`, `Connected`, or `Disconnected`. Do not
recreate the removed old presence/user-count surface.

Render avatars with the self-contained `governance-avatar` class only; remove
the inherited `user-avatar` class and move the small flex, centering, border,
and radius rules needed by the focused avatar into `governance.css`. Extend the
removed-surface guardrail to reject `user-avatar` in the governance controller.

Guard the Manage access click handler with the same `isOwner` predicate before `showModal()`.

- [ ] **Step 10: Remove Activity filters and render source labels**

Delete `activityFilters` and the Human/AI/Access chip rendering. Add:

```js
const ACTIVITY_SOURCE_LABELS = Object.freeze({
  access_management: 'Access management',
  document_editor: 'Document editor',
  owner_decision: 'Owner decision',
  system_reconciliation: 'System reconciliation',
  webmcp_apply: 'WebMCP apply',
  webmcp_proposal: 'WebMCP proposal',
});
```

Each latest-first Activity item renders actor, Role, action, source, outcome, target, and time. It never renders a full direct-edit diff.

- [ ] **Step 11: Run focused shell verification**

Run:

```bash
node --test tests/node/governance-shell-state.test.js
node --test tests/node/guardrails/focused-product-surface.test.js
node --test \
  tests/node/file-tree-state.test.js \
  tests/node/wiki-link-completions.test.js \
  tests/node/wiki-link-resolver.test.js
npm run test:browser -- tests/browser/ui-feature.browser.test.js tests/browser/governance-ui-controller.browser.test.js
```

Expected: pure state, absent-surface guardrail, retained wiki-link behavior, and
focused browser UI tests pass.

- [ ] **Step 12: Commit the focused shell**

```bash
git add src/client/domain/governance-shell-state.js \
  src/client/application/app-shell/ui-feature-tab-activity.js \
  src/client/application/app-shell/governance-feature.js \
  src/client/application/app-shell/ui-feature-shell.js \
  src/client/application/app-shell/ui-feature-toolbar.js \
  src/client/application/app-shell-elements.js \
  src/client/application/workspace-route-controller.js \
  src/client/application/workspace-coordinator.js \
  src/client/bootstrap/collabmd-app-shell.js \
  src/client/presentation/governance-ui-controller.js \
  src/client/app/index.html \
  src/client/styles/features/governance.css \
  tests/node/governance-shell-state.test.js \
  tests/node/guardrails/focused-product-surface.test.js \
  tests/browser/ui-feature.browser.test.js \
  tests/browser/governance-ui-controller.browser.test.js
git commit -m "feat: add focused governed workspace shell"
```

---

### Task 5: Make Access Changes Explicit and Reversible

**Files:**
- Modify: `src/client/presentation/governance-ui-controller.js:403-460`
- Modify: `src/client/application/app-shell/governance-feature.js:225-279`
- Modify: `src/client/bootstrap/collabmd-app-shell.js:182-197`
- Modify: `src/client/app/index.html:703-714`
- Modify: `src/client/styles/features/governance.css`
- Test: `tests/browser/governance-ui-controller.browser.test.js`
- Test: `tests/browser/ui-feature.browser.test.js`
- Test: `tests/node/governance-api-handler.test.js`

**Interfaces:**
- Consumes: PUT `{ roleId }`, snapshots with cleared revoked `roleId`, Owner-only shell state.
- Produces: `onAssignRole(participantSessionId, roleId): Promise<void>`; `onRevoke(participantSessionId): Promise<void>`; row-local draft/loading/error state; explicit `data-role-submit` controls.

- [ ] **Step 1: Write RED browser tests for explicit submission**

Assert that selection alone does not call the application callback:

```js
const role = row.querySelector('[data-role-control]');
role.value = 'editor';
role.dispatchEvent(new Event('change', { bubbles: true }));
expect(onAssignRole).not.toHaveBeenCalled();
```

Then click the visible action:

```js
row.querySelector('[data-role-submit]').click();
await vi.waitFor(() => expect(onAssignRole).toHaveBeenCalledWith('writer-session', 'editor'));
expect(manageAccessDialog.open).toBe(true);
```

Add tests for:

- Pending/Revoked label `Assign role`;
- Active non-Owner label `Update role` plus `Revoke access`;
- Owner row locked;
- request pending disables only that row;
- failure restores authoritative active Role or Pending/Revoked placeholder;
- failure renders inline error and leaves modal open;
- non-Owner trigger cannot open the modal.

In `ui-feature.browser.test.js`, assert each successful assign, change, and
revoke command appends exactly one corresponding Activity record with
`source: 'access_management'`. Replaying the refreshed snapshot must not append
a second access record, and a same-Role assignment must append none.

- [ ] **Step 2: Run the RED Manage access browser test**

Run:

```bash
npm run test:browser -- tests/browser/governance-ui-controller.browser.test.js
```

Expected: immediate-change tests fail because no explicit row action exists.

- [ ] **Step 3: Replace the duration form with row-local Role drafts**

Remove `data-expiry-control`. Render:

```html
<select class="ui-input" data-role-control aria-label="Role for Writer AI">
  <option value="">Select role</option>
  <option value="editor">Editor</option>
  <option value="reviewer">Reviewer</option>
</select>
<button type="button" class="ui-button ui-button--primary ui-button--compact" data-role-submit>
  Assign role
</button>
<p data-role-inline-status aria-live="polite"></p>
```

Keep draft values in a `Map` keyed by `participantSessionId`. Keep row request state in another `Map` with `{ error, pending, success }`. Do not rerender from a `change` event; rerender only for authoritative snapshots or explicit request-state changes.

- [ ] **Step 4: Make application callbacks propagate success and failure**

Change the callback to:

```js
onAssignRole: (participantSessionId, roleId) => (
  this.assignGovernanceRole(participantSessionId, roleId)
),
```

Implement:

```js
async assignGovernanceRole(participantSessionId, roleId) {
  const participant = this.governanceSnapshot?.participants?.find((item) => (
    item.participantSessionId === participantSessionId
  ));
  const changed = participant?.state !== 'active' || participant.roleId !== roleId;
  await this.governanceRequest(`/api/governance/grants/${encodeURIComponent(participantSessionId)}`, {
    body: JSON.stringify({ roleId }),
    method: 'PUT',
  });
  if (changed) {
    this.appendGovernanceGrantActivity(
      participant?.state === 'active' ? 'grant_changed' : 'grant_assigned',
      participantSessionId,
    );
  }
  await this.governanceClient.refresh();
}
```

Do not catch row errors into a toast; let the awaited callback reject so the row renders the error.

- [ ] **Step 5: Make revoke explicit and authoritative**

Use a per-row `Revoke access` button. Before the request, show the existing native confirmation with copy that names the Participant and warns only that unsynchronized local work may be discarded. On cancel, send nothing. On failure, preserve Active state and render inline error. On success, append `grant_revoked` with source `access_management`, refresh, and keep the modal open.

- [ ] **Step 6: Run focused Manage access verification**

Run:

```bash
npm run test:browser -- \
  tests/browser/governance-ui-controller.browser.test.js \
  tests/browser/ui-feature.browser.test.js
node --test tests/node/governance-api-handler.test.js
```

Expected: all explicit action, rollback, and Owner authorization tests pass.

- [ ] **Step 7: Commit explicit access actions**

```bash
git add src/client/presentation/governance-ui-controller.js \
  src/client/application/app-shell/governance-feature.js \
  src/client/bootstrap/collabmd-app-shell.js \
  src/client/app/index.html \
  src/client/styles/features/governance.css \
  tests/browser/governance-ui-controller.browser.test.js \
  tests/browser/ui-feature.browser.test.js \
  tests/node/governance-api-handler.test.js
git commit -m "feat: make governed access changes explicit"
```

---

### Task 6: Clear Governed Document State on Access Loss

**Files:**
- Modify: `src/client/infrastructure/editor-collaboration-client.js:8-144,238-270`
- Modify: `src/client/infrastructure/editor-session.js:96-130,331-351,610-628`
- Modify: `src/client/application/workspace-coordinator.js:177-270`
- Modify: `src/client/bootstrap/collabmd-app-shell.js:504-525,600-635`
- Test: `tests/node/editor-session.test.js`
- Test: `tests/node/workspace-coordinator.test.js`

**Interfaces:**
- Consumes: authoritative Role transitions and status-only shell rendering.
- Produces: `EditorSession.hasUnsynchronizedLocalChanges(): boolean`; `onGovernanceAccessChanged({ discarded, state })`; `onGovernanceDocumentCleared()`.

- [ ] **Step 1: Write RED dirty-state tests**

In `editor-session.test.js`, simulate a local Y.Doc update while provider status is disconnected and assert:

```js
assert.equal(session.hasUnsynchronizedLocalChanges(), true);
```

After a successful `sync` event, assert the flag resets to false. A remote update whose origin is the provider must not set it.

- [ ] **Step 2: Write RED transition tests**

Add clean revoke coverage:

```js
session.hasUnsynchronizedLocalChanges = () => false;
await coordinator.applyGovernanceTransition(activeEditor, revokedSnapshot);
assert.deepEqual(accessChanges, [{ discarded: false, state: 'revoked' }]);
assert.equal(clearGovernedDocumentCalls, 1);
```

Add dirty revoke and Editor-to-Reviewer coverage with `discarded: true`, one clear callback, session destruction, and a fresh empty personal history boundary.

- [ ] **Step 3: Run the RED transition tests**

Run:

```bash
node --test \
  tests/node/editor-session.test.js \
  tests/node/workspace-coordinator.test.js
```

Expected: failures show there is no dirty-state API, clear callback, or clean revoke signal.

- [ ] **Step 4: Track disconnected local document updates**

In `EditorCollaborationClient`, track:

```js
this.connected = false;
this.unsynchronizedLocalChanges = false;
```

Update `connected` from provider status. Register one named Y.Doc update handler and set `unsynchronizedLocalChanges = true` only when the update origin is not the provider and the provider is disconnected. Clear the flag after `sync(true)`. Remove the Y.Doc observer and clear the flag during destroy. Expose:

```js
hasUnsynchronizedLocalChanges() {
  return this.unsynchronizedLocalChanges;
}
```

Delegate the same method from `EditorSession`.

- [ ] **Step 5: Make WorkspaceCoordinator report real discard state**

Before destroying a session, calculate:

```js
const discarded = this.session?.hasUnsynchronizedLocalChanges?.() === true;
```

Call `onGovernanceDocumentCleared()` whenever document access is lost. Call `onGovernanceAccessChanged({ discarded, state })` with the calculated value, not `Boolean(session)`.

- [ ] **Step 6: Clear all governed presentation state**

Wire `onGovernanceDocumentCleared` in the app shell to:

```js
this.elements.editorContainer?.replaceChildren();
```

The focused shell has no preview, Comment, outline, or layout controller to
clear. Do not reintroduce them for transition cleanup. `EditorSession.destroy()`
remains responsible for Yjs bindings and personal history.

- [ ] **Step 7: Show discarded-state copy only when true**

Keep the callback shape:

```js
onGovernanceAccessChanged: ({ discarded, state }) => {
  if (discarded) {
    this.toastController.show(`Access changed (${state}). Unsynchronized local changes were discarded.`);
  }
},
```

No toast is shown for a clean transition.

- [ ] **Step 8: Run focused transition verification**

Run the Step 3 command again, then:

```bash
npm run test:browser -- tests/browser/editor-view-adapter.browser.test.js
```

Expected: clean/dirty transition tests pass and existing Undo/Redo authorization remains green.

- [ ] **Step 9: Commit access-loss cleanup**

```bash
git add src/client/infrastructure/editor-collaboration-client.js \
  src/client/infrastructure/editor-session.js \
  src/client/application/workspace-coordinator.js \
  src/client/bootstrap/collabmd-app-shell.js \
  tests/node/editor-session.test.js \
  tests/node/workspace-coordinator.test.js \
  tests/browser/editor-view-adapter.browser.test.js
git commit -m "fix: clear governed state on access loss"
```

---

### Task 7: Rewrite Focused E2E and Visual Evidence

**Files:**
- Modify: `tests/e2e/helpers/app-fixture.js:220-250,378-402`
- Modify: `tests/e2e/governance.spec.js`
- Modify: `tests/e2e/ui-visual.spec.js:13-59`
- Modify: `tests/node/playwright-evidence-config.test.js`
- Create after inspection: `tests/e2e/ui-visual.spec.js-snapshots/focused-owner-workspace-chromium-darwin.png`
- Create after inspection: `tests/e2e/ui-visual.spec.js-snapshots/focused-manage-access-chromium-darwin.png`
- Create after inspection: `tests/e2e/ui-visual.spec.js-snapshots/focused-proposal-conflicts-chromium-darwin.png`
- Create after inspection: `tests/e2e/ui-visual.spec.js-snapshots/focused-pending-chromium-darwin.png`
- Create after inspection: `tests/e2e/ui-visual.spec.js-snapshots/focused-revoked-chromium-darwin.png`
- Remove after confirmed replacement: the six classic Create/diff/workspace/Base/preview snapshots; retain `auth-gate-password-chromium-darwin.png`.

**Interfaces:**
- Consumes: explicit `data-role-submit`, status-only shell, source-labelled Activity, room-lifetime snapshots.
- Produces: user-level multi-context flows; five named PNG evidence states; one governed evidence video per Playwright test; reviewed focused desktop baseline.

- [ ] **Step 1: Rewrite the Role helper around visible actions**

Use:

```js
export async function assignGovernedRole(ownerPage, participantSessionId, roleId) {
  const dialog = ownerPage.locator('#manageAccessDialog');
  if (!await dialog.evaluate((element) => element.open)) {
    await ownerPage.getByRole('button', { name: 'Manage access' }).click();
  }
  const row = dialog.locator(`[data-participant-session-id="${participantSessionId}"]`);
  await row.locator('[data-role-control]').selectOption(roleId);
  await row.locator('[data-role-submit]').click();
  await expect(row.locator('[data-role-inline-status]')).toContainText(/assigned|updated/i);
  await expect(dialog).toHaveAttribute('open', '');
}
```

Update revoke helper to click `Revoke access`, accept the confirmation, await Revoked state, and leave the modal open. Remove every expiry input operation.

- [ ] **Step 2: Use separate Owner, Writer, and Reviewer contexts**

Create and close contexts explicitly in each multi-participant test:

```js
const contextOptions = {
  baseURL: e2eServer.baseURL,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  viewport: { height: 720, width: 1280 },
};
const ownerContext = await browser.newContext(contextOptions);
const writerContext = await browser.newContext({
  ...contextOptions,
  ...(isEvidenceRun(testInfo)
    ? { recordVideo: { dir: testInfo.outputPath('writer-video'), size: contextOptions.viewport } }
    : {}),
});
const reviewerContext = await browser.newContext({
  ...contextOptions,
  ...(isEvidenceRun(testInfo)
    ? { recordVideo: { dir: testInfo.outputPath('reviewer-video'), size: contextOptions.viewport } }
    : {}),
});
const ownerPage = await ownerContext.newPage();
const writerPage = await writerContext.newPage();
const reviewerPage = await reviewerContext.newPage();
```

Include `e2eServer` and `testInfo` in the test fixture arguments. Use
`try/finally` and close all three contexts. Save or attach any manual video
before closing the context that owns it.

- [ ] **Step 3: Replace current governance flows with focused behaviors**

Keep the file `tests/e2e/governance.spec.js` and cover:

1. Pending AI Reviewer has a status-only view, no inherited controls, no document content, no Manage access, and no credential in the URL.
2. Owner opens Manage access, assigns Editor and Reviewer through explicit row buttons, then sees the focused Owner shell and source-labelled Activity.
3. Writer edits converge; Reviewer proposes; same-location stale proposals group; Owner resolves one.
4. Owner revokes Writer; Writer shows status-only Revoked, stale document text is absent, and a cached apply tool is denied.
5. The focused Owner, Pending, and Revoked shells have no page-level horizontal overflow at 360px and contain none of the forbidden legacy DOM IDs.
6. A duplicate tab with the same Participant session is blocked and can take
   over without blocking another Participant session.

Delete assertions that exercise Comments, formatting, preview tasks, Chat, old
presence, file navigation, or classic shell restoration. These are no longer
product behavior.

- [ ] **Step 4: Attach the five required evidence screenshots**

Use these exact names:

```text
focused-owner-workspace
focused-manage-access
focused-proposal-conflicts
focused-pending
focused-revoked
```

Take screenshots only after the state is stable and before secondary contexts close. Keep the existing awaited path-backed attachment and source unlink pattern.

- [ ] **Step 5: Run focused E2E RED/GREEN**

Run:

```bash
npm run build
npx playwright test tests/e2e/governance.spec.js --workers=1
```

Expected before helper/spec rewrite: failures for removed minute controls and old rail/preview expectations. Expected after rewrite: all focused governance tests pass.

- [ ] **Step 6: Review visual output before updating snapshots**

Run:

```bash
npx playwright test tests/e2e/ui-visual.spec.js --workers=1
```

Expected: all classic workspace/create/preview snapshots fail or no longer match
the focused visual test set.

Inspect the failure PNGs in `test-results/`. Confirm the focused Owner screenshot contains one editor, Participant bar, Owner rail, and no excluded surface. Replace `ui-visual.spec.js` with focused Owner, Manage access, Pending, Revoked, and Proposal/Conflict states, then update only those reviewed snapshots:

```bash
npx playwright test tests/e2e/ui-visual.spec.js \
  --grep "focused workspace" \
  --update-snapshots \
  --workers=1
```

Remove obsolete classic workspace, mobile preview, Create, Base editor, and
other excluded-feature snapshots after the focused snapshots are inspected.

- [ ] **Step 7: Run Evidence last and validate artifacts**

Run:

```bash
npm run test:e2e:evidence
```

Then assert:

```bash
node -e 'const fs=require("fs");const path=require("path");const walk=(d)=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>{const p=path.join(d,e.name);return e.isDirectory()?walk(p):[p]}):[];const files=walk("test-results/evidence");const png=files.filter((f)=>f.endsWith(".png"));const webm=files.filter((f)=>f.endsWith(".webm"));const trace=files.filter((f)=>f.endsWith(".zip"));if(png.length!==5||webm.length<5||trace.length!==0)process.exit(1);console.log({png:png.length,webm:webm.length,trace:trace.length});'
```

Expected: 5 PNG, at least 5 WebM, 0 trace ZIP, and `playwright-report/evidence/index.html` exists.

- [ ] **Step 8: Commit focused E2E and evidence**

```bash
git add tests/e2e/helpers/app-fixture.js \
  tests/e2e/governance.spec.js \
  tests/e2e/ui-visual.spec.js \
  tests/e2e/ui-visual.spec.js-snapshots \
  tests/node/playwright-evidence-config.test.js
git commit -m "test: cover focused governed workflows"
```

Do not stage `test-results/` or `playwright-report/`.

---

### Task 8: Delete the First Unreachable CollabMD Feature Wave

**Files:**
- Delete: `src/client/application/app-shell/chat-feature.js`
- Delete: `src/client/application/app-shell/export-feature.js`
- Delete: `src/client/application/app-shell/git-feature.js`
- Delete: `src/client/application/app-shell/presence-feature.js`
- Delete: `src/client/application/app-shell/comments-feature.js`
- Delete: `src/client/application/app-shell/ui-feature-sidebar.js`
- Delete: `src/client/application/quick-switcher-loader.js`
- Delete: `src/client/presentation/backlinks-panel.js`
- Delete: `src/client/presentation/comment-overview-controller.js`
- Delete: `src/client/presentation/comment-ui-controller.js`
- Delete: `src/client/presentation/comment-ui/comment-ui-card.js`
- Delete: `src/client/presentation/comment-ui/comment-ui-layout.js`
- Delete: `src/client/presentation/comment-ui/comment-ui-render.js`
- Delete: `src/client/presentation/comment-ui/comment-ui-state.js`
- Delete: `src/client/presentation/create-menu-presenter.js`
- Delete: `src/client/presentation/file-explorer-controller.js`
- Delete: `src/client/presentation/file-explorer-view.js`
- Delete: `src/client/presentation/file-history-view-controller.js`
- Delete: `src/client/presentation/git-diff-view-controller.js`
- Delete: `src/client/presentation/git-panel-controller.js`
- Delete: `src/client/presentation/quick-switcher-controller.js`
- Delete: `src/client/presentation/quick-switcher-text-search.js`
- Delete: `src/client/styles/features/backlinks.css`
- Delete: `src/client/styles/features/collaboration-chat.css`
- Delete: `src/client/styles/features/collaboration-presence.css`
- Delete: `src/client/styles/features/comment-card.css`
- Delete: `src/client/styles/features/comment-overlays.css`
- Delete: `src/client/styles/features/quick-switcher.css`
- Modify: `src/client/styles/style.css`
- Delete: `src/server/domain/comment-overview.js`
- Modify: `src/client/infrastructure/vault-api-client.js`
- Modify: `src/server/infrastructure/http/create-vault-api-query-handler.js`
- Modify: `src/server/infrastructure/persistence/sidecar-store.js`
- Modify: `src/server/infrastructure/persistence/vault-file-store.js`
- Delete: `tests/e2e/workspace.spec.js`
- Delete: `tests/e2e/mobile.spec.js`
- Delete: `tests/e2e/preview-navigation.spec.js`
- Delete: `tests/e2e/diagram-preview.spec.js`
- Delete: `tests/e2e/excalidraw-reliability.spec.js`
- Delete: `tests/e2e/collaboration.spec.js`
- Delete: matching feature-only Node and browser tests listed in Step 3.
- Delete: `tests/node/comment-overview.test.js`
- Delete: `tests/browser/comment-ui-controller.browser.test.js`
- Delete: `tests/browser/__screenshots__/ui-feature.browser.test.js/uiFeature-browser-helpers-collapses-the-sidebar-for-mobile-restores-1.png`
- Modify: `tests/node/vault-api-client.test.js`
- Modify: `tests/node/vault-file-store.test.js`

**Interfaces:**
- Consumes: Task 4's focused bootstrap/route wiring and Task 7's replacement
  coverage for document convergence, tab lock, narrow layout, and evidence.
- Produces: no product runtime or product E2E entrypoint for the deleted first
  wave; retained Comment-compatible Proposal codec and preview/diagram/server
  primitives that still have references.

- [ ] **Step 1: Prove focused replacements are green before deletion**

Run:

```bash
npm run build
npx playwright test tests/e2e/governance.spec.js tests/e2e/ui-visual.spec.js --workers=1
node --test tests/node/guardrails/focused-product-surface.test.js
```

Expected: focused workflow, duplicate-tab replacement coverage, focused visual
states, and removed-surface guardrail pass.

- [ ] **Step 2: Verify every source deletion candidate has no focused importer**

Run one `rg -n` query per path basename across `src`, excluding the candidate
file itself. For example:

```bash
rg -n "chat-feature|presence-feature|comments-feature|comment-ui-controller|export-feature|git-feature|ui-feature-sidebar|quick-switcher-loader|backlinks-panel|comment-overview-controller|create-menu-presenter|file-explorer-controller|file-explorer-view|file-history-view-controller|git-diff-view-controller|git-panel-controller|quick-switcher-controller|quick-switcher-text-search" src
```

Expected: no import from the focused entry graph. If a focused importer remains,
remove that importer in Task 4's owned shell wiring before deleting the file;
do not replace it with a stub.

- [ ] **Step 3: Delete isolated client features and their focused-irrelevant tests**

Stage the exact first-wave deletions now. Do not use `git add -u`:

```bash
git rm \
  src/client/application/app-shell/chat-feature.js \
  src/client/application/app-shell/export-feature.js \
  src/client/application/app-shell/git-feature.js \
  src/client/application/app-shell/presence-feature.js \
  src/client/application/app-shell/comments-feature.js \
  src/client/application/app-shell/ui-feature-sidebar.js \
  src/client/application/quick-switcher-loader.js \
  src/client/presentation/backlinks-panel.js \
  src/client/presentation/comment-overview-controller.js \
  src/client/presentation/comment-ui-controller.js \
  src/client/presentation/comment-ui/comment-ui-card.js \
  src/client/presentation/comment-ui/comment-ui-layout.js \
  src/client/presentation/comment-ui/comment-ui-render.js \
  src/client/presentation/comment-ui/comment-ui-state.js \
  src/client/presentation/create-menu-presenter.js \
  src/client/presentation/file-explorer-controller.js \
  src/client/presentation/file-explorer-view.js \
  src/client/presentation/file-history-view-controller.js \
  src/client/presentation/git-diff-view-controller.js \
  src/client/presentation/git-panel-controller.js \
  src/client/presentation/quick-switcher-controller.js \
  src/client/presentation/quick-switcher-text-search.js \
  src/client/styles/features/backlinks.css \
  src/client/styles/features/collaboration-chat.css \
  src/client/styles/features/collaboration-presence.css \
  src/client/styles/features/comment-card.css \
  src/client/styles/features/comment-overlays.css \
  src/client/styles/features/quick-switcher.css \
  tests/e2e/workspace.spec.js \
  tests/e2e/mobile.spec.js \
  tests/e2e/preview-navigation.spec.js \
  tests/e2e/diagram-preview.spec.js \
  tests/e2e/excalidraw-reliability.spec.js \
  tests/e2e/collaboration.spec.js \
  tests/node/backlinks-panel.test.js \
  tests/node/comment-overview.test.js \
  tests/node/comments-feature.test.js \
  tests/node/file-history-view-controller.test.js \
  tests/node/git-diff-view-controller.test.js \
  tests/node/git-feature.test.js \
  tests/node/git-panel-controller.test.js \
  tests/node/presence-feature.test.js \
  tests/node/quick-switcher-controller.test.js \
  tests/browser/create-menu-presenter.browser.test.js \
  tests/browser/comment-ui-controller.browser.test.js \
  tests/browser/__screenshots__/ui-feature.browser.test.js/uiFeature-browser-helpers-collapses-the-sidebar-for-mobile-restores-1.png \
  tests/browser/file-explorer-view.browser.test.js \
  tests/browser/git-diff-view-controller.browser.test.js \
  tests/browser/quick-switcher-controller.browser.test.js
```

Remove the deleted feature imports from `src/client/styles/style.css`. Also
remove its global imports of `comment-markdown.css`, `comments-drawer.css`, and
`comment-overview.css`; the focused HTML has no Comment surface. Keep those
three files because `src/client/excalidraw-editor.js` imports them directly.
Keep `comment-ui-shared.js` for the same reachable diagram-row consumer.

Do not delete governance, auth, landing, focused visual, Yjs text, WebMCP,
Proposal, Activity, or tab-lock tests.

- [ ] **Step 4: Remove server Comment overview only**

Delete `src/server/domain/comment-overview.js`, remove
`GET /api/comments/overview` from `create-vault-api-query-handler.js`, remove
`VaultFileStore.readCommentOverview()`, and remove
`SidecarStore.listCommentThreadEntries()` plus its list-only storage-root
helper.

```bash
git rm src/server/domain/comment-overview.js
```

Also remove the remaining client and test references to that endpoint:

- delete `VaultApiClient.readCommentOverview()` from
  `src/client/infrastructure/vault-api-client.js`;
- remove the `/api/comments/overview` request assertion from
  `tests/node/vault-api-client.test.js`;
- delete the `VaultFileStore reads comment overview...` block from
  `tests/node/vault-file-store.test.js`.

Keep all of these because Proposals still consume them:

```text
src/domain/comment-threads.js
Y.Array('comments')
serializeCommentThread(s)
populateCommentThreads
src/client/presentation/comment-ui/comment-ui-shared.js
src/client/styles/features/comment-markdown.css
src/client/styles/features/comment-overview.css
src/client/styles/features/comments-drawer.css
comment sidecar read/write/rename/delete
CollaborationRoom comment/proposal hydrate and persist
```

Do not delete preview, diagram, export-pipeline, file-tree server, PlantUML,
Structurizr, or Proposal-storage internals in this wave if any source reference
remains. Their deep removal is explicitly deferred by the spec.

- [ ] **Step 5: Run the absent-entrypoint and compile checks**

Run:

```bash
node --test tests/node/guardrails/focused-product-surface.test.js
npm run lint
npm run build
node --test tests/node/vault-api-client.test.js tests/node/vault-file-store.test.js
```

Expected: no removed DOM/import entrypoint returns, lint has no errors, and Vite
builds without a deleted module import.

- [ ] **Step 6: Run retained focused and shared tests**

Run:

```bash
node --test \
  tests/node/governance-activity.test.js \
  tests/node/governance-proposals.test.js \
  tests/node/editor-session.test.js \
  tests/node/tab-activity-lock.test.js \
  tests/node/webmcp-tool-registry.test.js \
  tests/node/workspace-coordinator.test.js \
  tests/node/integration/package-packaging.test.js
npm run test:browser
npx playwright test tests/e2e/governance.spec.js tests/e2e/ui-visual.spec.js --workers=1
```

Expected: every retained focused consumer remains green. A failure in an
unreachable legacy module is not repaired by reintroducing its product entry;
delete the orphan module and its feature-only test only when references confirm
it is isolated.

- [ ] **Step 7: Commit the verified first deletion wave**

```bash
git add src/client/infrastructure/vault-api-client.js \
  src/client/styles/style.css \
  src/server/infrastructure/http/create-vault-api-query-handler.js \
  src/server/infrastructure/persistence/sidecar-store.js \
  src/server/infrastructure/persistence/vault-file-store.js \
  tests/node/vault-api-client.test.js \
  tests/node/vault-file-store.test.js
git diff --cached --name-status
git diff --name-only --diff-filter=D
git commit -m "refactor: remove legacy CollabMD product features"
```

Review `git diff --cached --name-status` before committing. The unstaged
deletion check must print nothing because `git rm` already staged every planned
deletion in Steps 3 and 4. The cached diff must not include the Proposal codec,
comment sidecar persistence, Yjs text/awareness, governance, WebMCP, auth,
landing, or Post-MVP code.

---

### Task 9: Align Documentation, Packaging, and Final Verification

**Files:**
- Modify: `README.md:1-190`
- Modify: `AGENTS.md:96-115,138-160`
- Modify: `docs/superpowers/specs/2026-08-30-webmcp-governed-collaboration-design.md:1-8`
- Verify: `collabmd.governance.json`
- Verify: `Dockerfile`
- Verify: `docker-compose.demo.yml`
- Verify: `.github/workflows/docker-publish.yml`

**Interfaces:**
- Consumes: final user-visible Role, Activity, shell, and evidence behavior.
- Produces: accurate README/agent guidance and a release-ready verified branch.

- [ ] **Step 1: Update README to the implemented contract**

Document exactly:

- one focused governed document;
- room-lifetime Owner/Editor/Reviewer Roles;
- no duration, expiry, Comment capability, preview, Chat, file tree, or
  multi-document product UI;
- explicit `Assign role`, `Update role`, and `Revoke access`;
- Pending and Revoked status-only pages;
- Owner-only Review/Activity/Roles and Manage access;
- Activity actor/action/time/source/outcome/target fields and non-audit limitation;
- current WebMCP tool matrix;
- deterministic seed/reset and separate browser-context walkthrough;
- Post-MVP Vercel/Supabase/group/share work as future investigation only.

Use the focused manifest JSON verbatim.

- [ ] **Step 2: Mark the base design as amended**

Add below its metadata:

```markdown
> **Amendment:** The focused workspace, room-lifetime Role, and governed UI
> requirements are superseded by
> `docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md`.
```

- [ ] **Step 3: Update durable AGENTS guidance**

Add concise invariants:

```markdown
- Governed Roles are room-lifetime: Pending, Active, or Revoked; do not
  reintroduce duration or Comment capability without a new approved design.
- Removed CollabMD product surfaces must have no DOM, bootstrap, focus, or
  accessibility-tree entry; do not reintroduce them as hidden controls.
- Pending and Revoked pages are status-only and must not retain document
  content, removed-feature UI, or personal-history state in the page.
- Activity source is required and uses the fixed domain vocabulary.
```

- [ ] **Step 4: Run focused checks before broad checks**

Run:

```bash
node --test \
  tests/node/governance-contract.test.js \
  tests/node/governance-manifest.test.js \
  tests/node/governance-session-registry.test.js \
  tests/node/governance-api-handler.test.js \
  tests/node/governance-activity.test.js \
  tests/node/governance-proposals.test.js \
  tests/node/governance-shell-state.test.js \
  tests/node/editor-session.test.js \
  tests/node/workspace-coordinator.test.js \
  tests/node/integration/package-packaging.test.js
npm run test:browser
npm run build
npx playwright test tests/e2e/governance.spec.js tests/e2e/ui-visual.spec.js --workers=1
```

Expected: all focused checks pass.

- [ ] **Step 5: Run full source verification**

Run with Node 26:

```bash
npm run lint
npm run build
npm run check
npm run test:e2e:prebuilt
```

Expected: lint has 0 errors; build, non-E2E checks, and full Playwright suite pass. Inspect any Playwright failure artifact before rerunning.

- [ ] **Step 6: Run packaging and Compose smoke**

Run:

```bash
npm pack --dry-run
WEBMCP_HOSTNAME=governed-collaboration.example docker compose -f docker-compose.demo.yml config --quiet
docker build -t collabmd-governed:focused .
docker run --rm -d \
  --name collabmd-governed-focused-smoke \
  -p 127.0.0.1:12345:1234 \
  -e HOST=0.0.0.0 \
  -e PORT=1234 \
  -e COLLABMD_VAULT_DIR=/data \
  -e COLLABMD_GIT_ENABLED=false \
  -e AUTH_STRATEGY=none \
  collabmd-governed:focused
curl -fsS http://127.0.0.1:12345/
docker stop collabmd-governed-focused-smoke
```

Inspect the pack list and image output. Confirm the focused default `collabmd.governance.json` is included and the image starts without a custom manifest bind.

- [ ] **Step 7: Re-run Evidence as the final artifact-producing check**

Run:

```bash
npm run test:e2e:evidence
```

Re-run the artifact assertion from Task 7 Step 7. Confirm the HTML report exists and contains the five named PNG attachments.

- [ ] **Step 8: Review the final diff and commit documentation**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Then:

```bash
git add README.md AGENTS.md \
  docs/superpowers/specs/2026-08-30-webmcp-governed-collaboration-design.md
git commit -m "docs: align focused governed workspace"
```

- [ ] **Step 9: Confirm a clean local result without publishing**

Run:

```bash
git status --short --branch
git log --oneline -9
```

Expected: clean branch with the nine semantic task commits. Do not push, deploy, publish, merge, or submit the Challenge without a separate explicit request.
