# WebMCP Governed Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend CollabMD with a one-document, WebMCP-native workspace where a Human Owner assigns page-session Roles to human or AI participants, Editors apply changes, Reviewers create Proposals, and the Owner visibly resolves deterministic Conflicts.

**Architecture:** Preserve CollabMD at pinned upstream commit `d5fab4784df72bdfb5199e42ac838052767e72ec`. Add a server-authoritative in-memory control plane for page sessions and Grants, while document text, comments/Proposals, and collaboration Activity continue to use the existing Yjs document. The supported client polls the control plane once per second, gates every mutation path, and never treats tool visibility as authorization.

**Tech Stack:** Node.js 26+, npm, JavaScript ES modules, Yjs/y-websocket, CodeMirror 6/y-codemirror.next, WebMCP imperative tools, Node test runner, Vitest Browser Mode, Playwright, Vite, Docker, Caddy.

**Spec:** `docs/superpowers/specs/2026-08-30-webmcp-governed-collaboration-design.md`

## Global Constraints

- Import upstream CollabMD history from `https://github.com/andes90/collabmd.git` and pin the working base to `d5fab4784df72bdfb5199e42ac838052767e72ec` before editing source.
- Use Node.js `>=26` and the checked-in `package-lock.json`; add no runtime dependency for configuration, authorization, IDs, or polling.
- Govern exactly one active Markdown document in the demo UI. Preserve underlying CollabMD support but hide file-tree, Git, drawing, diagram, image-paste, and attachment-upload mutation surfaces in governed mode.
- Fixed Capabilities are `document.read`, `document.comment`, `document.suggest`, `document.edit`, `conflict.resolve`, and `grant.manage`.
- Default Roles are Owner, Editor, and Reviewer. Owner is immutable and lasts for the room lifetime; collaborator Grants expire after 60 minutes unless the Owner chooses a different duration.
- Treat `human` and `ai` as display labels only. Never authorize from caller-supplied actor, Role, kind, display name, URL query, DOM attribute, or Yjs awareness data.
- Store the opaque page-session credential only in tab-scoped `sessionStorage`. Store the non-secret `participantSessionId` separately and use it as the tab-lock scope.
- Use HTTP control endpoints with one-second polling. Do not add a control WebSocket, policy engine, database, account system, public SDK, Role inheritance, deny rules, or multi-document scope.
- Enforce supported UI and WebMCP flows. Do not claim malicious raw Yjs client protection, verified AI identity, semantic Conflict detection, immutable audit logging, or enterprise authorization.
- Undo/Redo require `document.edit`. Proposal accept/reject and Conflict keep/apply require `conflict.resolve`, use a governance Yjs origin, and never enter personal Undo history.
- Plain-text paste is supported. Image paste and attachment upload are disabled in governed mode.
- Reuse upstream baseline tests. Add only governance intersections; do not duplicate generic Yjs, Markdown Undo/Redo, comment CRUD, formatting, image-paste parsing, or Excalidraw history coverage.
- Do not commit, push, publish a repository, deploy, create external resources, or expose credentials without explicit user authorization. Commit steps below are future checkpoints, not current authorization.

---

## File Responsibility Map

### New production files

- `collabmd.governance.json` — default Role-to-Capability manifest.
- `src/domain/governance-contract.js` — shared constants, record normalization, public snapshots, and Capability checks that do not access storage.
- `src/domain/governance-proposals.js` — Proposal transitions, exact-target Conflict checks, overlap revalidation, grouping, and atomic resolution helpers.
- `src/domain/governance-activity.js` — Activity record creation and exactly-once append helpers.
- `src/server/config/governance-manifest.js` — manifest file loading and startup validation.
- `src/server/domain/governance-session-registry.js` — in-memory room, page-session, Owner, Grant, expiry, revoke, and monotonically increasing version state.
- `src/server/infrastructure/http/create-governance-api-handler.js` — the five governed control routes.
- `src/client/infrastructure/governance-client.js` — sessionStorage restore/create, authenticated requests, one-second polling, fresh authorization, and stale-response suppression.
- `src/client/application/app-shell/governance-feature.js` — shell orchestration for participant state, access transitions, proposal decisions, and control-only mode.
- `src/client/presentation/governance-ui-controller.js` — Participant Bar, Review/Activity/Roles rail, and Manage access dialog rendering.
- `src/client/styles/features/governance.css` — governed UI styles using existing CollabMD tokens.

### Existing production files with focused changes

- `src/server/create-app-server.js` — construct and inject governance services.
- `src/server/infrastructure/http/create-request-handler.js` — fan out `/api/governance/*` requests.
- `src/server/domain/collaboration/collaboration-room.js` — expose Proposal/Activity shared types and revalidate on external reconciliation.
- `src/domain/comment-threads.js` — serialize/hydrate `kind: "proposal"`, including terminal Proposals.
- `src/client/bootstrap/collabmd-app-shell.js` — replace throwaway query-token wiring with page-session bootstrap and compose governed features.
- `src/client/application/workspace-coordinator.js` — create, freeze, destroy, and reload EditorSession from current Grant state.
- `src/client/infrastructure/editor-collaboration-client.js` — expose `comments`, `governanceActivity`, connection state, and controlled reconnect hooks.
- `src/client/infrastructure/editor-session.js` — pass capability callbacks, execute governed mutations, and reset history on edit-capability transitions.
- `src/client/infrastructure/editor-view-adapter.js` — common CodeMirror transaction filter, read-only mode, Undo/Redo gate, and local-edit notifications.
- `src/client/infrastructure/comment-thread-store.js` — apply `document.comment` to existing comment mutations.
- `src/client/infrastructure/webmcp-tool-registry.js` — Role-aware read/apply/propose registration plus fresh authorize-before-execute.
- `src/client/infrastructure/tab-activity-lock.js` — scope the existing lock by participant session.
- `src/client/application/app-shell/comments-feature.js` and `src/client/presentation/comment-ui/*` — route Proposals to governed review UI and reuse anchored marker layout.
- `src/client/application/app-shell/ui-feature-tab-activity.js` — coordinate the participant-scoped tab lock.
- `src/client/application/app-shell/ui-feature-toolbar.js` and `src/client/application/app-shell/ui-feature-shell.js` — remove disabled governed surfaces from both UI and execution paths.
- `src/client/application/app-shell-elements.js`, `src/client/app/index.html`, and `src/client/styles/style.css` — bind and load governed UI.

### New focused tests

- `tests/node/governance-contract.test.js`
- `tests/node/governance-manifest.test.js`
- `tests/node/governance-session-registry.test.js`
- `tests/node/governance-api-handler.test.js`
- `tests/node/governance-client.test.js`
- `tests/node/governance-proposals.test.js`
- `tests/node/governance-activity.test.js`
- `tests/browser/governance-ui-controller.browser.test.js`
- `tests/e2e/governance.spec.js`

### Test-local helper contracts

These helpers live only in the named test file; they are not production abstractions.

- `createRegistry({ now? })` returns `new GovernanceSessionRegistry({ manifest: approvedManifest, now, randomBytes: deterministicBytes })`.
- `createGovernanceApiHarness()` returns `{ request(method, path, { bearer?, body? }), registry }` around `createGovernanceApiHandler()` with in-memory request/response stubs matching existing HTTP-handler tests.
- `createTwoSessions(harness)` POSTs Owner and pending Reviewer sessions and returns both response bodies.
- `createGovernanceDoc(text)` returns `{ ydoc, ytext, comments, activity }` using `Y.Doc`, `getText('codemirror')`, `getArray('comments')`, and `getArray('governanceActivity')`.
- `createTextAnchor(ytext, from, to)` returns the existing JSON-serialized Yjs relative start/end positions used by `CommentThreadStore`.
- `readProposal(comments, proposalId)` serializes and returns the matching `kind: 'proposal'` record.
- `ownerActor`, `editorActor`, and `reviewerActor` are frozen test records containing `participantSessionId`, `displayName`, `kind`, and `roleId`.
- `acceptedProposalFixture()` creates a governance document, one accepted Proposal, and returns `{ ...context, proposalId }`.
- `createRegistryHarness({ roleId })` extends the existing WebMCP registry test harness with a fake `GovernanceClient`, `setRole()`, `registeredNames()`, and current participant snapshot.
- `ORIGINAL_TEXT`, `validApplyInput`, and `validProposalInput` are test-local constants built from `README.md`, its computed revision, and one unique exact replacement.
- `createGovernedEditor({ roleId })` extends the existing browser editor harness with fake capability state plus `run(action)`, `revoke()`, `text()`, `activityCount()`, and `proposalState()`.
- `createController()` builds `GovernanceUiController` with the concrete DOM fixture and callback spies in `tests/browser/governance-ui-controller.browser.test.js`.
- `governanceFixture()` returns the approved Owner/Writer/Reviewer, Role matrix, Review groups, and Activity records for controller tests.

---

### Task 1: Bootstrap the Product Repository from Pinned CollabMD

**Files:**
- Preserve: `docs/superpowers/specs/2026-08-30-webmcp-governed-collaboration-design.md`
- Preserve: `docs/superpowers/plans/2026-08-30-webmcp-governed-collaboration.md`
- Import: upstream repository tree at `d5fab4784df72bdfb5199e42ac838052767e72ec`

**Interfaces:**
- Consumes: empty saved project directory containing only approved planning documents.
- Produces: a local Git repository on `main`, an `upstream` remote, unchanged CollabMD source at the pinned commit, installed dependencies, and a recorded green baseline.

- [ ] **Step 1: Verify the target is still safe to bootstrap**

Run:

```bash
cd /Users/a1004/Documents/_projects/openai-webmcp-challenge
find . -maxdepth 4 -type f -print
```

Expected: only the approved spec and plan. If any unrelated file appears, stop and ask the user; do not overwrite it.

- [ ] **Step 2: Initialize Git and check out the exact upstream commit**

Run only after confirming Step 1:

```bash
git init --initial-branch=codex/bootstrap
git remote add upstream https://github.com/andes90/collabmd.git
git fetch --depth=1 upstream d5fab4784df72bdfb5199e42ac838052767e72ec
git switch -c main FETCH_HEAD
git rev-parse HEAD
```

Expected final line: `d5fab4784df72bdfb5199e42ac838052767e72ec`. The untracked `docs/superpowers/` files remain present.

- [ ] **Step 3: Install exactly the locked dependencies**

Run:

```bash
node --version
npm --version
npm ci
npx playwright install chromium
```

Expected: Node reports `v26.x` or newer, `npm ci` exits `0` without changing `package-lock.json`, and Playwright confirms Chromium is installed. On a Linux host missing browser system libraries, use the environment's approved package-install path before retrying; do not hide the failure.

- [ ] **Step 4: Establish the untouched upstream baseline**

Run:

```bash
npm run build
npm run check
```

Expected: both exit `0`. Record any upstream-only failure before product edits; do not weaken a test to continue.

- [ ] **Step 5: Review repository state**

Run:

```bash
git status --short
git diff --check
```

Expected: only the approved planning documents are untracked; no source diff exists.

- [ ] **Step 6: Commit the planning baseline only if explicitly authorized**

```bash
git add docs/superpowers/specs/2026-08-30-webmcp-governed-collaboration-design.md docs/superpowers/plans/2026-08-30-webmcp-governed-collaboration.md
git commit -m "docs: add governed collaboration design and plan"
```

Expected: one documentation commit. Skip this step without explicit commit authorization.

---

### Task 2: Implement the Capability Manifest and In-Memory Session/Grant Registry

**Files:**
- Create: `collabmd.governance.json`
- Create: `src/domain/governance-contract.js`
- Create: `src/server/config/governance-manifest.js`
- Create: `src/server/domain/governance-session-registry.js`
- Create: `tests/node/governance-contract.test.js`
- Create: `tests/node/governance-manifest.test.js`
- Create: `tests/node/governance-session-registry.test.js`

**Interfaces:**
- Consumes: `documentPath`, display-only `displayName`/`kind`, server time, and Node `crypto.randomBytes`.
- Produces:
  - `GOVERNANCE_CAPABILITIES: readonly string[]`
  - `hasCapability(manifest, roleId, capability): boolean`
  - `loadGovernanceManifest({ cwd, fileName? }): Promise<GovernanceManifest>`
  - `GovernanceSessionRegistry.createSession({ documentPath, displayName, kind }): SessionCredentials`
  - `getSnapshot(credential): GovernanceSnapshot | undefined`
  - `assignRole(ownerCredential, { participantSessionId, roleId, expiresInMinutes }): GovernanceSnapshot`
  - `revoke(ownerCredential, participantSessionId): GovernanceSnapshot`
  - `authorize(credential, { documentPath, capability, at? }): AuthorizationResult`

- [ ] **Step 1: Write failing manifest and Capability tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOVERNANCE_CAPABILITIES,
  hasCapability,
} from '../../src/domain/governance-contract.js';
import { validateGovernanceManifest } from '../../src/server/config/governance-manifest.js';

test('default roles expose only the approved capabilities', () => {
  const manifest = validateGovernanceManifest({
    defaultGrantMinutes: 60,
    roles: {
      owner: [...GOVERNANCE_CAPABILITIES],
      editor: ['document.read', 'document.comment', 'document.suggest', 'document.edit'],
      reviewer: ['document.read', 'document.comment', 'document.suggest'],
    },
  });

  assert.equal(hasCapability(manifest, 'reviewer', 'document.edit'), false);
  assert.equal(hasCapability(manifest, 'editor', 'document.edit'), true);
});

test('manifest validation rejects unknown capabilities', () => {
  assert.throws(
    () => validateGovernanceManifest({ defaultGrantMinutes: 60, roles: { owner: ['document.destroy'] } }),
    /Unknown governance capability/,
  );
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
node --test tests/node/governance-contract.test.js tests/node/governance-manifest.test.js
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Add the manifest and shared contract**

`collabmd.governance.json`:

```json
{
  "roles": {
    "owner": ["document.read", "document.comment", "document.suggest", "document.edit", "conflict.resolve", "grant.manage"],
    "editor": ["document.read", "document.comment", "document.suggest", "document.edit"],
    "reviewer": ["document.read", "document.comment", "document.suggest"]
  },
  "defaultGrantMinutes": 60
}
```

Core contract:

```js
export const GOVERNANCE_CAPABILITIES = Object.freeze([
  'document.read',
  'document.comment',
  'document.suggest',
  'document.edit',
  'conflict.resolve',
  'grant.manage',
]);

export const hasCapability = (manifest, roleId, capability) => (
  manifest.roles[roleId]?.includes(capability) === true
);
```

Validation must reject non-object JSON, unknown Capabilities, missing Owner, an Owner missing any fixed Capability, empty Role arrays, duplicate Capabilities, and non-integer `defaultGrantMinutes` outside `1..1440`.

- [ ] **Step 4: Write failing registry tests**

```js
test('the first page session is immutable Owner and later sessions are pending', () => {
  const registry = createRegistry({ now: () => 1_000 });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  assert.equal(registry.getSnapshot(owner.credential).roleId, 'owner');
  assert.equal(registry.getSnapshot(writer.credential).state, 'pending');
  assert.throws(() => registry.revoke(owner.credential, owner.participantSessionId), /Owner/);
});

test('authorization ignores caller labels and expires collaborator Grants', () => {
  const clock = { now: 1_000 };
  const registry = createRegistry({ now: () => clock.now });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const reviewer = registry.createSession({ documentPath: 'README.md', displayName: 'Reviewer', kind: 'ai' });
  registry.assignRole(owner.credential, {
    participantSessionId: reviewer.participantSessionId,
    roleId: 'reviewer',
    expiresInMinutes: 1,
  });

  assert.equal(registry.authorize(reviewer.credential, {
    capability: 'document.edit',
    documentPath: 'README.md',
    role: 'owner',
  }).ok, false);
  clock.now += 60_001;
  assert.equal(registry.getSnapshot(reviewer.credential).state, 'expired');
});
```

- [ ] **Step 5: Implement the minimal registry and make tests GREEN**

Use one `Map` keyed by document path and one `Map` keyed by a SHA-256 digest of the credential. Generate credentials with:

```js
const credential = randomBytes(32).toString('base64url');
const credentialDigest = createHash('sha256').update(credential).digest('hex');
```

Do not `await` between the room existence check and Owner insertion. Increment `snapshot.version` for every session/Grant transition. Derive `pending | active | expired | revoked` on read; do not add timers or a job queue.

Run:

```bash
node --test tests/node/governance-contract.test.js tests/node/governance-manifest.test.js tests/node/governance-session-registry.test.js
npm run lint
```

Expected: all targeted tests pass and lint exits `0`.

- [ ] **Step 6: Commit only if explicitly authorized**

```bash
git add collabmd.governance.json src/domain/governance-contract.js src/server/config/governance-manifest.js src/server/domain/governance-session-registry.js tests/node/governance-contract.test.js tests/node/governance-manifest.test.js tests/node/governance-session-registry.test.js
git commit -m "feat: add page-session governance core"
```

---

### Task 3: Add the HTTP Control API, Polling Client, and Participant-Scoped Tab Lock

**Files:**
- Create: `src/server/infrastructure/http/create-governance-api-handler.js`
- Create: `src/client/infrastructure/governance-client.js`
- Create: `tests/node/governance-api-handler.test.js`
- Create: `tests/node/governance-client.test.js`
- Create: `tests/node/tab-activity-lock.test.js`
- Modify: `src/server/create-app-server.js`
- Modify: `src/server/infrastructure/http/create-request-handler.js`
- Modify: `src/client/bootstrap/collabmd-app-shell.js`
- Modify: `src/client/infrastructure/tab-activity-lock.js`
- Modify: `src/client/application/app-shell/ui-feature-tab-activity.js`

**Interfaces:**
- Consumes: `GovernanceSessionRegistry` from Task 2.
- Produces:
  - `POST /api/governance/session`
  - `GET /api/governance/session`
  - `GET /api/governance/roles`
  - `PUT /api/governance/grants/:participantSessionId`
  - `DELETE /api/governance/grants/:participantSessionId`
  - `POST /api/governance/authorize`
  - `GovernanceClient.restoreOrCreate({ documentPath, displayName, kind })`
  - `subscribe(listener): () => void`
  - `authorize(capability, documentPath): Promise<AuthorizationResult>`

- [ ] **Step 1: Write failing API contract tests**

```js
test('governance sessions use Bearer credentials and never echo them in participant snapshots', async () => {
  const harness = createGovernanceApiHarness();
  const response = await harness.request('POST', '/api/governance/session', {
    body: { documentPath: 'README.md', displayName: 'Mina', kind: 'human' },
  });

  assert.equal(response.status, 201);
  assert.equal(typeof response.body.credential, 'string');
  assert.equal(JSON.stringify(response.body.participants).includes(response.body.credential), false);
});

test('only Owner can assign and revoke a collaborator Role', async () => {
  const harness = createGovernanceApiHarness();
  const { owner, reviewer } = await createTwoSessions(harness);
  const path = `/api/governance/grants/${reviewer.participantSessionId}`;
  assert.equal((await harness.request('PUT', path, {
    bearer: reviewer.credential,
    body: { roleId: 'editor', expiresInMinutes: 60 },
  })).status, 403);
  assert.equal((await harness.request('PUT', path, {
    bearer: owner.credential,
    body: { roleId: 'reviewer', expiresInMinutes: 60 },
  })).status, 200);
  assert.equal((await harness.request('DELETE', path, { bearer: owner.credential })).status, 200);
});
```

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/node/governance-api-handler.test.js
```

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement the narrow route-table handler and inject it**

Use the existing exact/prefix route pattern. Parse the credential only from:

```js
const credential = request.headers.authorization?.startsWith('Bearer ')
  ? request.headers.authorization.slice('Bearer '.length)
  : '';
```

Return `401` for an invalid credential, `403` for a valid but unauthorized session, `404` for an unknown target participant, and `400` for malformed JSON/Role/duration. Never log request Authorization headers.

- [ ] **Step 4: Implement the polling client and sessionStorage boundary**

```js
const SESSION_STORAGE_KEY = 'collabmd-governance-session';

export class GovernanceClient {
  constructor({ fetchImpl = fetch, pollIntervalMs = 1000, storage = sessionStorage } = {}) {}
  async restoreOrCreate({ documentPath, displayName, kind }) {}
  async authorize(capability, documentPath) {}
  subscribe(listener) {}
  destroy() {}
}
```

Store `{ credential, participantSessionId, documentPath }` in `sessionStorage`, never in `localStorage`, the URL, a DOM attribute, or app-config. Apply a poll response only when `snapshot.version >= currentVersion`. Stop the timer on `destroy()`.

Add `tests/node/governance-client.test.js` with a map-backed storage stub, queued fetch responses, and a fake timer. Verify restore-before-create, `Authorization: Bearer` use, one-second polling, stale lower-version response rejection, and timer cleanup.

- [ ] **Step 5: Port the participant-scoped tab-lock behavior with tests**

```js
test('different participant scopes can activate on the same origin', () => {
  const owner = new TabActivityLock({ scope: 'owner-session' });
  const reviewer = new TabActivityLock({ scope: 'reviewer-session' });
  assert.equal(owner.tryAcquire(), true);
  assert.equal(reviewer.tryAcquire(), true);
});

test('a duplicate tab in one participant scope remains blocked', () => {
  const first = new TabActivityLock({ scope: 'writer-session' });
  const duplicate = new TabActivityLock({ scope: 'writer-session' });
  assert.equal(first.tryAcquire(), true);
  assert.equal(duplicate.tryAcquire(), false);
});
```

Wire `participantSessionId`, not the credential, into `TabActivityLock`. Preserve original behavior when no scope is provided.

- [ ] **Step 6: Verify the task**

```bash
node --test tests/node/governance-api-handler.test.js tests/node/governance-client.test.js tests/node/tab-activity-lock.test.js
npm run test:integration
npm run lint
```

Expected: targeted and existing integration tests pass.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add src/server/create-app-server.js src/server/infrastructure/http/create-request-handler.js src/server/infrastructure/http/create-governance-api-handler.js src/client/infrastructure/governance-client.js src/client/bootstrap/collabmd-app-shell.js src/client/infrastructure/tab-activity-lock.js src/client/application/app-shell/ui-feature-tab-activity.js tests/node/governance-api-handler.test.js tests/node/governance-client.test.js tests/node/tab-activity-lock.test.js
git commit -m "feat: add governed page-session control plane"
```

---

### Task 4: Implement the Yjs Proposal, Conflict, and Activity Engine

**Files:**
- Create: `src/domain/governance-proposals.js`
- Create: `src/domain/governance-activity.js`
- Create: `tests/node/governance-proposals.test.js`
- Create: `tests/node/governance-activity.test.js`
- Modify: `src/domain/comment-threads.js`
- Modify: `src/client/infrastructure/editor-collaboration-client.js`
- Modify: `src/server/domain/collaboration/collaboration-room.js`
- Modify: `tests/node/comment-threads.test.js`
- Modify: `tests/node/collaboration-room.test.js`

**Interfaces:**
- Consumes: one `Y.Doc`, `Y.Text('codemirror')`, `Y.Array('comments')`, `Y.Array('governanceActivity')`, a current actor snapshot, and an authorized command.
- Produces:
  - `createProposal(context, input): ProposalRecord`
  - `revalidateOpenProposals(context, { actor, origin, system? }): RevalidationResult`
  - `resolveProposal(context, { proposalId, resolution, actor }): ProposalRecord`
  - `groupReviewItems(context): ReviewGroup[]`
  - `appendActivity(activityArray, record): ActivityRecord`

- [ ] **Step 1: Write failing lifecycle, atomicity, and persistence tests**

```js
test('governance resolution updates text, Proposal, overlaps, and Activity in one Yjs update', () => {
  const context = createGovernanceDoc('Budget is $100K.');
  const proposal = createProposal(context, {
    anchor: createTextAnchor(context.ytext, 10, 15),
    baseRevision: 'base',
    expectedText: '$100K',
    replacementText: '$120K',
    actor: reviewerActor,
  });
  const updates = [];
  context.ydoc.on('update', (update, origin) => updates.push({ update, origin }));

  resolveProposal(context, { proposalId: proposal.id, resolution: 'apply_proposed', actor: ownerActor });

  assert.equal(context.ytext.toString(), 'Budget is $120K.');
  assert.equal(readProposal(context.comments, proposal.id).status, 'accepted');
  assert.equal(context.activity.length, 1);
  assert.equal(updates.length, 1);
});

test('terminal Proposals persist and never reopen after later edits', () => {
  const context = acceptedProposalFixture();
  context.ytext.insert(0, 'Updated: ');
  revalidateOpenProposals(context, { actor: editorActor, origin: 'direct-edit' });
  assert.equal(readProposal(context.comments, context.proposalId).status, 'accepted');
});
```

- [ ] **Step 2: Run RED tests**

```bash
node --test tests/node/governance-proposals.test.js tests/node/governance-activity.test.js tests/node/comment-threads.test.js
```

Expected: FAIL because the governance domain modules and Proposal schema do not exist.

- [ ] **Step 3: Implement the Proposal schema and transition rules**

```js
export const GOVERNANCE_ORIGIN = Object.freeze({ type: 'governance-resolution' });
export const PROPOSAL_STATUSES = Object.freeze(['open', 'accepted', 'rejected', 'conflict']);

export const resolveProposal = (context, { proposalId, resolution, actor }) => {
  let result;
  context.ydoc.transact(() => {
    result = applyResolution(context, { proposalId, resolution, actor });
    revalidateOverlaps(context, result.changedRange, actor);
    appendActivity(context.activity, proposalActivity(result, actor));
  }, GOVERNANCE_ORIGIN);
  return result.proposal;
};
```

Requirements:

- `collabmd_propose_text_edit` represents one exact replacement.
- Missing anchors are `Unlocated conflicts`; only `keep_current` is allowed.
- `accepted`/`rejected` are terminal and idempotent.
- Group located items by resolved document position, tie-break by `createdAt`; sort Unlocated last.
- Scan all non-terminal Proposals after a supported mutation; do not build an index.

- [ ] **Step 4: Extend comment serialization without changing ordinary comment semantics**

`serializeCommentThread()` must continue omitting resolved ordinary comments when upstream expects that behavior, while retaining terminal records where `kind === 'proposal'`. `populateCommentThreads()` must accept terminal Proposal records. Add a full serialize/populate round-trip test.

- [ ] **Step 5: Bind Activity and external-system reconciliation**

In `EditorCollaborationClient.initialize()` bind:

```js
this.commentThreads = this.ydoc.getArray('comments');
this.governanceActivity = this.ydoc.getArray('governanceActivity');
```

In server external reconciliation, run text replacement, Proposal revalidation, and one `system` Activity append under the existing `workspace-reconcile` transaction. Remote observers render but never append.

- [ ] **Step 6: Verify persistence and task tests**

```bash
node --test tests/node/governance-proposals.test.js tests/node/governance-activity.test.js tests/node/comment-threads.test.js tests/node/collaboration-room.test.js
npm run lint
```

Expected: all pass, including refresh/server snapshot round-trip and exactly one update for Owner resolution.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add src/domain/governance-proposals.js src/domain/governance-activity.js src/domain/comment-threads.js src/client/infrastructure/editor-collaboration-client.js src/server/domain/collaboration/collaboration-room.js tests/node/governance-proposals.test.js tests/node/governance-activity.test.js tests/node/comment-threads.test.js tests/node/collaboration-room.test.js
git commit -m "feat: add shared proposal conflict engine"
```

---

### Task 5: Make WebMCP Tools Role-Aware and Reauthorize at Execution

**Files:**
- Modify: `src/client/infrastructure/webmcp-tool-registry.js`
- Modify: `src/client/infrastructure/governance-client.js`
- Modify: `src/client/infrastructure/editor-session.js`
- Modify: `src/client/bootstrap/collabmd-app-shell.js`
- Modify: `tests/node/webmcp-tool-registry.test.js`

**Interfaces:**
- Consumes: cached Governance snapshot for tool visibility, `GovernanceClient.authorize()` for fresh execution checks, and Task 4 Proposal helpers.
- Produces:
  - unchanged `collabmd_read_active_document`
  - unchanged `collabmd_apply_text_edits`
  - new `collabmd_propose_text_edit`
  - `EditorSession.applyGovernedTextEdits({ edits, actor }): ApplyResult`
  - `EditorSession.proposeTextEdit({ oldText, newText, revision, actor }): ProposalRecord`
  - structured `{ code, message }` denials with no document mutation.

- [ ] **Step 1: Write failing Role/tool and stale-call tests**

```js
test('Reviewer sees read and propose but cannot execute a cached apply tool', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  const cachedApply = harness.registered.get('collabmd_apply_text_edits').execute;
  harness.setRole('reviewer');

  assert.deepEqual(harness.registeredNames(), [
    'collabmd_read_active_document',
    'collabmd_propose_text_edit',
  ]);
  await assert.rejects(() => cachedApply(validApplyInput), /document\.edit/);
  assert.equal(harness.documentText(), ORIGINAL_TEXT);
});

test('caller actor and Role fields never affect authorization or attribution', async () => {
  const harness = createRegistryHarness({ roleId: 'reviewer' });
  const result = await harness.execute('collabmd_propose_text_edit', {
    ...validProposalInput,
    actorId: 'owner-session',
    role: 'owner',
  });
  assert.equal(result.createdByParticipantSessionId, harness.participantSessionId);
  assert.equal(result.createdByRole, 'reviewer');
});
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/node/webmcp-tool-registry.test.js
```

Expected: the new tool and fresh authorization behavior are missing.

- [ ] **Step 3: Split visibility from authorization**

```js
const TOOL_CAPABILITIES = Object.freeze({
  collabmd_read_active_document: 'document.read',
  collabmd_apply_text_edits: 'document.edit',
  collabmd_propose_text_edit: 'document.suggest',
});

async function requireFreshCapability(name, path) {
  const capability = TOOL_CAPABILITIES[name];
  const result = await governanceClient.authorize(capability, path);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.snapshot;
}
```

Register only cached-visible tools, but call `requireFreshCapability()` immediately before read/propose/mutation. Remove the throwaway `webmcpGrant` URL input and `collabmd_get_active_role` spike tool.

- [ ] **Step 4: Implement exact apply/propose behavior**

- Apply all exact targets in one Yjs transaction only when every current target still matches.
- A stale revision with still-matching exact targets is safe to apply.
- If any target is missing/changed, apply zero text edits and create one Conflict Proposal per failed edit.
- Propose accepts one `oldText`/`newText` replacement and never mutates text.
- Attribute from the current page-session snapshot, not tool input.
- Revalidate overlapping open/conflict Proposals and append one Activity event at the action origin.

- [ ] **Step 5: Verify Role refresh and abort/error paths**

```bash
node --test tests/node/webmcp-tool-registry.test.js
npm run test:browser
npm run lint
```

Expected: Writer apply, Reviewer propose, revoked stale denial, active-document guard, revision behavior, and existing abort tests pass.

- [ ] **Step 6: Commit only if explicitly authorized**

```bash
git add src/client/infrastructure/webmcp-tool-registry.js src/client/infrastructure/governance-client.js src/client/infrastructure/editor-session.js src/client/bootstrap/collabmd-app-shell.js tests/node/webmcp-tool-registry.test.js
git commit -m "feat: enforce governed WebMCP tools"
```

---

### Task 6: Gate Every Editor Action and Implement Safe Grant/Connection Transitions

**Files:**
- Modify: `src/client/infrastructure/editor-view-adapter.js`
- Modify: `src/client/infrastructure/editor-session.js`
- Modify: `src/client/application/workspace-coordinator.js`
- Modify: `src/client/infrastructure/editor-collaboration-client.js`
- Modify: `src/client/infrastructure/comment-thread-store.js`
- Modify: `src/client/application/app-shell/ui-feature-toolbar.js`
- Modify: `src/client/application/app-shell/ui-feature-shell.js`
- Modify: `src/client/bootstrap/collabmd-app-shell.js`
- Modify: `tests/browser/editor-view-adapter.browser.test.js`
- Modify: `tests/node/editor-session.test.js`
- Modify: `tests/node/workspace-coordinator.test.js`
- Modify: `tests/node/comment-thread-store.test.js`

**Interfaces:**
- Consumes: current Governance snapshot/capabilities and Task 4 revalidation/Activity helpers.
- Produces:
  - `EditorViewAdapter({ canEdit, onLocalEdit, ...existingOptions })`
  - `EditorViewAdapter.setCanEdit(value): void`
  - `EditorSession.freezeForDisconnect(): void`
  - `WorkspaceCoordinator.applyGovernanceTransition(previous, next): Promise<void>`

- [ ] **Step 1: Write the representative RED matrix**

```js
for (const action of ['typing', 'plain-paste', 'toolbar-format', 'task-toggle']) {
  test(`Reviewer cannot mutate through ${action}`, async () => {
    const harness = await createGovernedEditor({ roleId: 'reviewer' });
    await harness.run(action);
    assert.equal(harness.text(), ORIGINAL_TEXT);
    assert.equal(harness.activityCount(), 0);
    assert.equal(harness.proposalState(), 'open');
  });
}

test('revoked Undo and Redo do not change text, Proposals, or Activity', async () => {
  const harness = await createGovernedEditor({ roleId: 'editor' });
  await harness.type('local');
  harness.revoke();
  await harness.undo();
  await harness.redo();
  assert.equal(harness.text(), 'local');
  assert.equal(harness.activityKinds().includes('undo'), false);
});
```

- [ ] **Step 2: Run RED browser and node tests**

```bash
npx vitest run --config vitest.config.mjs --browser=chromium tests/browser/editor-view-adapter.browser.test.js
node --test tests/node/editor-session.test.js tests/node/workspace-coordinator.test.js tests/node/comment-thread-store.test.js
```

Expected: Reviewer/revoke paths can still reach existing mutation entry points.

- [ ] **Step 3: Add one CodeMirror transaction gate and explicit history gate**

```js
import { ySyncAnnotation } from 'y-codemirror.next';

const governanceTransactionFilter = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || transaction.annotation(ySyncAnnotation)) return transaction;
  return this.canEdit() ? transaction : [];
});
```

Use a Compartment to reconfigure `EditorState.readOnly`/`EditorView.editable` for UX. Keep the transaction filter for programmatic dispatches. Before `undoManager.undo()` or `redo()`, return `false` unless `canEdit()` is true. Do not block remote Yjs updates carrying `ySyncAnnotation`.

- [ ] **Step 4: Gate comments and hide image/file mutation execution paths**

Pass `canWrite: () => hasCapability(snapshot, 'document.comment')` into `CommentThreadStore`, including reactions. In governed mode:

- do not inject `onImagePaste` into `EditorSession`;
- exclude `[data-markdown-action="image"]` from toolbar rendering;
- reject the image handler even if a stale element invokes it;
- no-op quick switcher shortcuts and wiki-link file creation/navigation.

- [ ] **Step 5: Implement disconnect and Grant transition semantics**

- On connection loss, set editor/comment controls read-only and pause tools immediately.
- Keep the current Y.Doc only for already-unsynchronized changes.
- Poll the server before allowing provider reconnect.
- Same active Editor Grant: reconnect the same Y.Doc/UndoManager.
- Expired/revoked or gained/lost `document.edit`: destroy EditorSession/Y.Doc/UndoManager, load authoritative content, start empty history, and show access-changed feedback.
- Pending/expired/revoked: control-only view, no document provider or document tools.

- [ ] **Step 6: Implement exactly-once local Activity bursts and revalidation**

Only the action-origin page appends. Coalesce native typing/IME/delete/cut until one second idle, blur, or a discrete command. Paste/format/task-toggle/Undo/Redo each emit at most one event. Revalidate only open/conflict Proposals; never reopen terminal Proposals.

- [ ] **Step 7: Verify the task**

```bash
npx vitest run --config vitest.config.mjs --browser=chromium tests/browser/editor-view-adapter.browser.test.js
node --test tests/node/editor-session.test.js tests/node/workspace-coordinator.test.js tests/node/comment-thread-store.test.js
npm run test:integration
npm run lint
```

Expected: representative action matrix, offline/reconnect, comment gate, and all upstream editor tests pass.

- [ ] **Step 8: Commit only if explicitly authorized**

```bash
git add src/client/infrastructure/editor-view-adapter.js src/client/infrastructure/editor-session.js src/client/application/workspace-coordinator.js src/client/infrastructure/editor-collaboration-client.js src/client/infrastructure/comment-thread-store.js src/client/application/app-shell/ui-feature-toolbar.js src/client/application/app-shell/ui-feature-shell.js src/client/bootstrap/collabmd-app-shell.js tests/browser/editor-view-adapter.browser.test.js tests/node/editor-session.test.js tests/node/workspace-coordinator.test.js tests/node/comment-thread-store.test.js
git commit -m "feat: govern all document actions"
```

---

### Task 7: Build the Approved Single-Document Governance UI

**Files:**
- Create: `src/client/presentation/governance-ui-controller.js`
- Create: `src/client/application/app-shell/governance-feature.js`
- Create: `src/client/styles/features/governance.css`
- Create: `tests/browser/governance-ui-controller.browser.test.js`
- Modify: `src/client/app/index.html`
- Modify: `src/client/application/app-shell-elements.js`
- Modify: `src/client/bootstrap/collabmd-app-shell.js`
- Modify: `src/client/application/app-shell/comments-feature.js`
- Modify: `src/client/presentation/comment-ui-controller.js`
- Modify: `src/client/presentation/comment-ui/comment-ui-state.js`
- Modify: `src/client/presentation/comment-ui/comment-ui-layout.js`
- Modify: `src/client/presentation/comment-ui/comment-ui-shared.js`
- Modify: `src/client/styles/style.css`
- Modify: `tests/browser/comment-ui-controller.browser.test.js`
- Modify: `tests/browser/ui-feature.browser.test.js`

**Interfaces:**
- Consumes: Governance snapshot subscription, `ReviewGroup[]`, Activity records, manifest roles, and Owner callbacks.
- Produces:
  - `GovernanceUiController.render({ session, participants, reviewGroups, activity, roles })`
  - callbacks `onAssignRole`, `onRevoke`, `onResolveProposal`, `onSelectProposal`
  - stable selectors listed below.

- [ ] **Step 1: Add failing controller accessibility tests**

```js
test('renders participant identity labels and an immutable Owner row', () => {
  const controller = createController();
  controller.render(governanceFixture());
  assert.equal(document.querySelector('[data-owner="true"] [data-role-control]').hasAttribute('disabled'), true);
  assert.equal(document.querySelector('[data-participant-kind="ai"]').textContent.includes('AI'), true);
  assert.equal(document.querySelector('[data-grant-state="revoked"]').textContent.includes('Revoked'), true);
});

test('uses semantic tabs, a Role table, and keyboard navigation', () => {
  const controller = createController();
  controller.render(governanceFixture());
  assert.equal(document.querySelector('#governanceRail [role="tablist"]') != null, true);
  assert.equal(document.querySelector('#roleCapabilityMatrix').tagName, 'TABLE');
});
```

- [ ] **Step 2: Run RED browser tests**

```bash
npx vitest run --config vitest.config.mjs --browser=chromium tests/browser/governance-ui-controller.browser.test.js
```

Expected: FAIL because the controller and DOM do not exist.

- [ ] **Step 3: Add the DOM structure and one controller**

Add these stable selectors without ever embedding the credential:

```text
#participantBar
[data-participant-session-id]
[data-self="true"]
[data-participant-kind="human|ai"]
[data-grant-state="active|pending|expired|revoked"]
#governanceRail
[data-governance-tab="review|activity|roles"]
[data-governance-panel="review|activity|roles"]
[data-proposal-id]
[data-conflict-group]
#manageAccessBtn
#manageAccessDialog
#roleCapabilityMatrix
```

Use the existing native `<dialog class="app-dialog">`, button/input classes, status badges, presence avatar patterns, and sidebar keyboard-tab behavior. The UI controller has no fetch calls; `governance-feature.js` owns callbacks and state.

- [ ] **Step 4: Reuse comment markers for Proposal and Conflict locations**

- Filter `kind: 'proposal'` out of ordinary Comment rendering.
- Feed precomputed located groups to Comment UI layout.
- Render one marker per location with `data-conflict-count`.
- Keep each Proposal selectable in the Review rail.
- Render Unlocated groups only in the rail and disable Apply.
- Preserve existing comment marker behavior unchanged.

- [ ] **Step 5: Hide unsupported surfaces in DOM and code**

Set both `hidden` and `inert` on the file sidebar, file search/quick switcher, Git history/review, backlinks navigation, drawing/diagram entry actions, and image insertion. Keep presence awareness/cursors but replace the old toolbar presence avatars with the Participant Bar.

- [ ] **Step 6: Add high-contrast, keyboard, and mobile behavior**

Use existing CSS variables only. Always pair state colors with text. Add visible focus, `forced-colors`, and `prefers-reduced-motion` behavior. Use roving `tabindex` for rail tabs, `aria-pressed` for Activity filters, and a semantic table for Roles. At narrow widths, place the rail below the document rather than hiding it.

- [ ] **Step 7: Verify the UI task**

```bash
npx vitest run --config vitest.config.mjs --browser=chromium tests/browser/governance-ui-controller.browser.test.js tests/browser/comment-ui-controller.browser.test.js tests/browser/ui-feature.browser.test.js
npm run test:guardrails
npm run build
```

Expected: governed UI and existing comment/shell tests pass; style guardrails report no raw-color or token violations.

- [ ] **Step 8: Commit only if explicitly authorized**

```bash
git add src/client/presentation/governance-ui-controller.js src/client/application/app-shell/governance-feature.js src/client/styles/features/governance.css src/client/app/index.html src/client/application/app-shell-elements.js src/client/bootstrap/collabmd-app-shell.js src/client/application/app-shell/comments-feature.js src/client/presentation/comment-ui-controller.js src/client/presentation/comment-ui/comment-ui-state.js src/client/presentation/comment-ui/comment-ui-layout.js src/client/presentation/comment-ui/comment-ui-shared.js src/client/styles/style.css tests/browser/governance-ui-controller.browser.test.js tests/browser/comment-ui-controller.browser.test.js tests/browser/ui-feature.browser.test.js
git commit -m "feat: add governed collaboration workspace UI"
```

---

### Task 8: Prove the Three Critical Browser Flows and Run the Release Test Gate

**Files:**
- Create: `tests/e2e/governance.spec.js`
- Modify: `tests/e2e/helpers/app-fixture.js`
- Modify: `tests/e2e/ui-visual.spec.js`

**Interfaces:**
- Consumes: all production interfaces from Tasks 2–7.
- Produces: three stable Playwright scenarios and one governed desktop visual baseline.

- [ ] **Step 1: Add an E2E session helper**

```js
async function createGovernedParticipant(page, { displayName, kind }) {
  await page.goto('/#file=README.md');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Join governed session' }).click();
  return {
    participantSessionId: await page.locator('[data-self="true"]').getAttribute('data-participant-session-id'),
  };
}
```

Use separate Playwright pages with separate tab-scoped storage. For the duplicate-tab case, copy the same governed sessionStorage value before navigation.

- [ ] **Step 2: Write the access/lifecycle scenario**

Cover first-session Owner atomicity, second/third pending, Role assignment, different Participant tabs coexisting, duplicate Participant tab blocked, Editor→Reviewer history reset, revoke control-only state, and a cached apply tool denied after the revoked snapshot is received.

- [ ] **Step 3: Write the collaboration/Proposal scenario**

Cover Human + Writer convergence, Reviewer Proposal without text mutation, two same-location Conflicts, one Owner resolution, overlap revalidation, Unlocated no-Apply, terminal persistence after refresh, and exactly-once Activity.

- [ ] **Step 4: Write the mutation/offline scenario**

Cover representative typing, plain-text paste, toolbar formatting, task toggle, Undo/Redo, disconnect freeze, same-Grant reconnect with unsynchronized state, changed-Grant stale state discard, empty history after recreation, and no Activity replay duplicates.

- [ ] **Step 5: Run focused E2E and update one visual snapshot intentionally**

```bash
npm run build
npx playwright test tests/e2e/governance.spec.js
npx playwright test tests/e2e/ui-visual.spec.js --update-snapshots
npx playwright test tests/e2e/ui-visual.spec.js
```

Expected: all three governance scenarios pass and the second visual run is clean. Inspect the changed screenshot before accepting it.

- [ ] **Step 6: Run the complete release gate**

```bash
npm run check
npm run test:e2e:prebuilt
git diff --check
```

Expected: lint, guardrails, unit, integration, browser, and all E2E tests pass with zero failures.

- [ ] **Step 7: Commit only if explicitly authorized**

```bash
git add tests/e2e/governance.spec.js tests/e2e/helpers/app-fixture.js tests/e2e/ui-visual.spec.js tests/e2e/ui-visual.spec.js-snapshots
git commit -m "test: cover governed collaboration flows"
```

---

### Task 9: Finish English Documentation, Public Demo Packaging, and Live WebMCP Verification

**Files:**
- Create: `docs/demo/launch-plan.md`
- Create: `docker-compose.demo.yml`
- Create: `deploy/Caddyfile`
- Modify: `README.md`
- Modify: `.env.example`
- Preserve: `LICENSE`

**Interfaces:**
- Consumes: a fully green Task 8 build and the existing upstream `Dockerfile`.
- Produces: English challenge documentation, a deterministic seed document, a single-host Docker/Caddy demo configuration, and a live-smoke checklist.

- [ ] **Step 1: Write the English README sections before packaging**

Document:

- problem and product one-liner;
- CollabMD attribution and reused features;
- Human Owner / Writer Editor / Reviewer Reviewer walkthrough;
- `collabmd.governance.json` Role configuration;
- local Node 26 setup and exact test commands;
- supported UI/WebMCP threat boundary;
- explicit exclusions and prohibited security/identity claims;
- live URL and sub-three-minute demo links only after they exist.

Use `page-session capability gating`, `supported UI/WebMCP flows`, and `deterministic overlap conflict`. Do not use the prohibited claims from the spec.

- [ ] **Step 2: Add a deterministic public demo document**

`docs/demo/launch-plan.md` must contain a short English launch brief with exact values `$100K`, `$110K`, and `$120K` described in the filming handoff. At deployment time copy it to the ignored vault:

```bash
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
```

- [ ] **Step 3: Add the minimal single-host Docker/Caddy configuration**

`deploy/Caddyfile`:

```caddyfile
{$WEBMCP_HOSTNAME} {
  reverse_proxy collabmd:1234
}
```

`docker-compose.demo.yml`:

```yaml
services:
  collabmd:
    build: .
    restart: unless-stopped
    environment:
      HOST: 0.0.0.0
      PORT: 1234
      COLLABMD_VAULT_DIR: /data
      COLLABMD_GIT_ENABLED: "false"
      AUTH_STRATEGY: none
    volumes:
      - ./data/vault:/data

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - collabmd
    environment:
      WEBMCP_HOSTNAME: ${WEBMCP_HOSTNAME}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

Do not add OIDC, hosted mode, Kubernetes, a second app replica, or a deployment SDK.

- [ ] **Step 4: Verify packaging locally**

```bash
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
docker compose -f docker-compose.demo.yml config
docker build -t collabmd-governed:local .
docker run --rm -d --name collabmd-governed-local -p 127.0.0.1:1234:1234 --mount type=bind,src="$PWD/data/vault",dst=/data -e HOST=0.0.0.0 -e PORT=1234 -e COLLABMD_VAULT_DIR=/data -e COLLABMD_GIT_ENABLED=false -e AUTH_STRATEGY=none collabmd-governed:local
curl -fsS http://127.0.0.1:1234/
docker stop collabmd-governed-local
```

Expected: compose config and image build pass, HTTP returns the app, and the stopped test container is removed by `--rm`.

The operator-only demo reset is a process restart because Grants are intentionally in memory:

```bash
docker compose -f docker-compose.demo.yml restart collabmd
cp docs/demo/launch-plan.md data/vault/README.md
```

Do not add a public reset endpoint or reset button.

- [ ] **Step 5: Stop for external deployment authority**

Do not continue until the user supplies or approves a host and DNS name, authorizes external deployment, and sets `WEBMCP_HOSTNAME` in the deployment environment. Never request a secret value in chat and never commit credentials.

After authorization, deploy one instance with persistent `./data/vault`, then verify HTTPS and `/ws` proxying through Caddy.

- [ ] **Step 6: Run the live ChatGPT WebMCP smoke test**

From the public top-level page in the current supported ChatGPT desktop built-in browser:

1. Confirm Owner, Writer, and Reviewer page sessions appear independently.
2. Confirm Writer discovers read/apply/propose.
3. Confirm Reviewer discovers read/propose only.
4. Read and edit through actual WebMCP calls.
5. Create and resolve the two-Conflict demo.
6. Revoke Writer, wait for the revoked snapshot, and confirm the cached apply invocation is denied.
7. Confirm no credential appears in URL, DOM, browser-visible logs, or README.

- [ ] **Step 7: Rehearse and record the approved 2:45–2:50 demo**

Use the ignored handoff at `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md`. Record real WebMCP calls and live Yjs synchronization. Keep all public materials in English.

- [ ] **Step 8: Commit/publish only if explicitly authorized**

```bash
git add README.md .env.example docs/demo/launch-plan.md docker-compose.demo.yml deploy/Caddyfile LICENSE
git commit -m "docs: package governed collaboration demo"
```

Creating an `origin`, pushing, publishing the live URL, and submitting the challenge remain separate external actions requiring explicit user authorization.

---

## Final Verification Checklist

- [ ] `git rev-parse HEAD` descends from pinned CollabMD commit `d5fab4784df72bdfb5199e42ac838052767e72ec`.
- [ ] `npm run check` passes.
- [ ] `npm run test:e2e:prebuilt` passes.
- [ ] `git diff --check` passes.
- [ ] Docker build and local HTTP smoke pass.
- [ ] Public HTTPS and WebSocket smoke pass after deployment authorization.
- [ ] Live ChatGPT read/apply/propose/revoke denial smoke passes.
- [ ] README preserves MIT attribution and states the threat boundary accurately.
- [ ] Video is public, English, under three minutes, and shows actual WebMCP execution.

## Execution Notes

- Recommended execution mode: `superpowers:subagent-driven-development`, one fresh implementation subagent per Task with specification and code-quality review between Tasks.
- Tasks 2 and 4 can be researched in parallel, but Task 4 implementation should start only after Task 2 fixes actor/Role shapes.
- Task 3 must finish before Task 5 and Task 6.
- Task 4 must finish before Task 5, Task 6, and Task 7.
- Do not begin Task 9 external deployment or publication actions without a fresh user authorization at that action boundary.

## Spec Coverage Matrix

| Spec sections | Implementation tasks |
|---|---|
| Product boundary and verified CollabMD base | Tasks 1, 7, 9 |
| Participant, Owner, Capability, Role manifest, Runtime Grant | Task 2 |
| Authorization flow and page-session control | Tasks 2, 3, 5 |
| Human/AI editing, all user actions, Undo/Redo | Tasks 5, 6 |
| Proposal, Conflict, multiple/unlocated groups, Activity | Task 4 |
| Participant Bar, Review/Activity/Roles rail, Manage access | Task 7 |
| Participant-scoped tab lock and connection transitions | Tasks 3, 6 |
| Persistence, external reconciliation, error and claim boundaries | Tasks 4, 6, 9 |
| Unit, integration, browser, E2E, and live verification | Tasks 2–9 |
| Demo, extensibility boundary, and Definition of Done | Tasks 8, 9 |
