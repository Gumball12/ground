# Ground Hosted Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the focused Ground UI and existing editor to the Supabase foundation through a stateless API, canonical `/:docId` routes, durable collaboration, Owner recovery, and server-authorized WebMCP actions.

**Architecture:** A single Web-standard `/api/ground` function dispatches a closed set of semantic operations to a `GroundDocumentService`; its injected Supabase store owns I/O. The browser gets an invisible anonymous session, subscribes before hydrating, and injects a Supabase collaboration client into the existing `EditorSession`. A new Ground shell reuses existing editor, governance presentation, and WebMCP primitives without running the filesystem workspace or tab lock.

**Tech Stack:** JavaScript ES modules, Web `Request`/`Response`, Vercel Functions, Supabase JS/Auth/Realtime, Yjs, CodeMirror 6, Vite, Vitest Browser, Node test runner, Playwright

**Spec:** `docs/superpowers/specs/2026-09-03-ground-hosted-mvp-design.md`

## Global Constraints

- Complete `2026-09-03-ground-hosted-data-foundation.md` first.
- Preserve and integrate the user's uncommitted `index.html`, Ground icon, and thumbnail work; inspect its diff before every overlapping edit.
- Use `collabmd.governance.json` at runtime; never copy its Role map into client or SQL.
- UI and WebMCP mutations use the same service and commit boundary; cached WebMCP tools must be denied after Role change.
- Proposal, Conflict, and Activity remain in the same Y.Doc and outside document Undo/Redo.
- Ground records omit `participantKind`; historical local records containing it remain readable.
- No comments, chat, formatting controls, search, preview/split, image work, file tree, tab takeover, login, group list, or offline editing.
- Pending and Revoked states contain no document state, editor, governance history, or removed control after render.
- Never report a local Yjs mutation as saved before the server confirms its sequence.
- Use existing CSS tokens; raw colors remain in `src/client/styles/foundation/themes.css`.
- Keep local CollabMD startup and tests passing.

## File Structure

### Server

- `src/server/config/ground-hosted-env.js`: validates server/public Ground environment.
- `src/server/application/ground-yjs-state.js`: hydrate, snapshot, and semantic Yjs mutations without I/O.
- `src/server/application/ground-document-service.js`: manifest authorization and document workflows.
- `src/server/infrastructure/supabase/ground-supabase-store.js`: Supabase reads and service-only RPC calls.
- `src/server/infrastructure/supabase/ground-auth-verifier.js`: bearer token to verified Supabase user.
- `src/server/infrastructure/http/create-ground-fetch-handler.js`: closed operation dispatch and safe HTTP responses.
- `src/server/create-ground-runtime.js`: thin composition and manifest/demo loading.
- `api/ground.js`: Vercel function entry.
- `api/app-config.js`: public JavaScript runtime configuration entry.
- `scripts/serve-ground-local.mjs`: local static/API adapter for built E2E and manual use.

### Client

- `src/client/domain/ground-route.js`: `/` and 22-character document-route parsing.
- `src/client/infrastructure/ground-auth-client.js`: anonymous Supabase session lifecycle.
- `src/client/infrastructure/ground-api-client.js`: authenticated semantic operation client.
- `src/client/infrastructure/supabase-collaboration-client.js`: subscribe-buffer-hydrate-gap-check, update queue, presence, reconnect.
- `src/client/infrastructure/ground-governance-client.js`: snapshots, Roles, access notices, and Owner commands.
- `src/client/application/ground-workspace-controller.js`: route/access/editor state transitions.
- `src/client/presentation/ground-entry-controller.js`: landing, join, share, recovery, and unavailable UI.
- `src/client/bootstrap/ground-app-shell.js`: thin composition using existing editor/governance controllers.
- `src/client/ground-main.js`: Ground entry point.
- `src/client/styles/features/ground-entry.css`: Ground-only entry/share/recovery layout.

### Tests

- `tests/node/ground-hosted-env.test.js`
- `tests/node/ground-yjs-state.test.js`
- `tests/node/ground-document-service.test.js`
- `tests/node/ground-fetch-handler.test.js`
- `tests/node/ground-route.test.js`
- `tests/browser/ground-auth-client.browser.test.js`
- `tests/browser/supabase-collaboration-client.browser.test.js`
- `tests/browser/ground-workspace-controller.browser.test.js`
- `tests/browser/ground-entry-controller.browser.test.js`
- `tests/e2e/ground-hosted.spec.js`
- `tests/e2e/helpers/ground-app-fixture.js`

---

### Task 1: Build the stateless Ground runtime boundary

**Files:**
- Create: `src/server/config/ground-hosted-env.js`
- Create: `src/server/infrastructure/supabase/ground-auth-verifier.js`
- Create: `src/server/infrastructure/http/create-ground-fetch-handler.js`
- Create: `src/server/create-ground-runtime.js`
- Create: `api/ground.js`
- Create: `api/app-config.js`
- Test: `tests/node/ground-hosted-env.test.js`
- Test: `tests/node/ground-fetch-handler.test.js`

**Interfaces:**
- `loadGroundHostedEnv(env)` -> frozen `{ publicOrigin, rateLimitHmacKey, supabasePublishableKey, supabaseSecretKey, supabaseUrl }` or throws.
- `GroundAuthVerifier.verify(bearerToken)` -> `{ userId, accessToken }` or `GROUND_UNAUTHENTICATED`.
- `createGroundFetchHandler({ authVerifier, publicConfig, service })` -> `{ fetch(request): Promise<Response> }`.
- `createGroundRuntime({ env, fetchImpl })` -> `{ fetch, publicConfig }`.

- [ ] **Step 1: Write failing environment tests**

```js
test('loads the five Ground server values without exposing the secret', () => {
  const config = loadGroundHostedEnv(validEnv);
  assert.equal(config.supabaseUrl, 'https://project.supabase.co');
  assert.equal(config.supabaseSecretKey, 'sb_secret_test');
  assert.deepEqual(config.publicConfig, {
    groundHosted: true,
    supabasePublishableKey: 'sb_publishable_test',
    supabaseUrl: 'https://project.supabase.co',
  });
});

test('rejects every missing required Ground environment value', () => {
  for (const key of [
    'GROUND_PUBLIC_ORIGIN', 'GROUND_RATE_LIMIT_HMAC_KEY', 'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY',
  ]) {
    assert.throws(() => loadGroundHostedEnv({ ...validEnv, [key]: '' }), /required/u);
  }
});
```

Use exact environment names:

```text
GROUND_PUBLIC_ORIGIN
GROUND_RATE_LIMIT_HMAC_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

- [ ] **Step 2: Run RED and implement environment validation**

Run: `node --test tests/node/ground-hosted-env.test.js`

Expected: FAIL, then PASS after the minimal validator. Accept only HTTPS for hosted `SUPABASE_URL` and public origin; allow `http://127.0.0.1` and `http://localhost` only when `NODE_ENV !== 'production'`.

- [ ] **Step 3: Write failing Fetch handler contract tests**

```js
test('returns public config without a bearer session', async () => {
  const handler = createGroundFetchHandler({
    authVerifier: { verify: async () => assert.fail('must not authenticate config') },
    publicConfig,
    service: {},
  });
  const response = await handler.fetch(new Request(
    'https://ground.test/api/ground?operation=config',
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), publicConfig);
});
```

Add four table-driven cases: non-JSON/wrong-Origin/missing-Bearer mutation responses are 400/403/401; an unknown operation is 400 without calling the service; missing/expired/inaccessible service errors all serialize as `GROUND_UNAVAILABLE`; and an Error containing SQL, secret, stack, and recovery-hash markers returns none of those markers.

The single endpoint accepts this closed operation union:

```js
const OPERATIONS = Object.freeze([
  'create_document', 'join_document', 'get_session', 'hydrate_document',
  'append_update', 'list_roles', 'list_participants', 'assign_role',
  'revoke_participant', 'recover_owner', 'resolve_proposal',
  'webmcp_read', 'webmcp_apply', 'webmcp_propose',
]);
```

- [ ] **Step 4: Implement safe request dispatch**

`GET /api/ground?operation=config` returns only `publicConfig`. Every other operation is POST JSON, requires exact allowed Origin plus `Authorization: Bearer <session>`, verifies the user with `auth.getUser(token)`, and calls the same-named service method with `{ actorId: userId, ...validatedInput }`.

Use stable safe errors:

```text
400 GROUND_INVALID_REQUEST
401 GROUND_UNAUTHENTICATED
403 GROUND_FORBIDDEN
404 GROUND_UNAVAILABLE (same for missing/expired/inaccessible)
409 GROUND_STALE_STATE
413 GROUND_UPDATE_TOO_LARGE
429 GROUND_RATE_LIMITED
503 GROUND_TEMPORARILY_UNAVAILABLE
```

Every response includes `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

- [ ] **Step 5: Compose Vercel entries without durable process state**

```js
// api/ground.js
import { createGroundRuntime } from '../src/server/create-ground-runtime.js';

let runtimePromise;
export default {
  async fetch(request) {
    runtimePromise ??= createGroundRuntime({ env: process.env });
    return (await runtimePromise).fetch(request);
  },
};
```

`api/app-config.js` calls the same runtime and returns:

```js
const body = `window.__COLLABMD_CONFIG__ = ${JSON.stringify(runtime.publicConfig)};\n`;
```

No secret property is present in the string or tests.

- [ ] **Step 6: Verify and commit**

Run:

```bash
node --test tests/node/ground-hosted-env.test.js tests/node/ground-fetch-handler.test.js
npm run lint
```

Expected: PASS.

```bash
git add src/server/config/ground-hosted-env.js src/server/infrastructure/supabase/ground-auth-verifier.js src/server/infrastructure/http/create-ground-fetch-handler.js src/server/create-ground-runtime.js api tests/node/ground-hosted-env.test.js tests/node/ground-fetch-handler.test.js
git commit -m "feat: add Ground hosted API boundary"
```

### Task 2: Implement manifest-authorized document workflows

**Files:**
- Create: `src/server/application/ground-yjs-state.js`
- Create: `src/server/application/ground-document-service.js`
- Create: `src/server/infrastructure/supabase/ground-supabase-store.js`
- Modify: `src/server/create-ground-runtime.js`
- Modify: `src/domain/governance-activity.js`
- Modify: `src/domain/governance-proposals.js`
- Test: `tests/node/ground-yjs-state.test.js`
- Test: `tests/node/ground-document-service.test.js`
- Modify: `tests/node/governance-activity.test.js`

**Interfaces:**
- `hydrateGroundYDoc({ snapshot, updates })` -> `{ activity, comments, ydoc, ytext }`.
- `encodeGroundSnapshot(context)` and `captureGroundUpdate(context, mutate)` -> `Uint8Array`.
- `GroundDocumentService` implements every operation in Task 1.
- `GroundSupabaseStore` implements `create`, `join`, `getSession`, `loadState`, `commitUpdate`, `assignRole`, `revoke`, `recover`, and `listParticipants`.

- [ ] **Step 1: Make `participantKind` optional with backward compatibility**

Add RED tests proving a new Activity actor without `kind` is valid and a legacy actor with `kind` round-trips. Change actor normalization to include `kind` only when it is a non-empty string. Do not render or synthesize `participantKind` in Ground.

Run: `node --test tests/node/governance-activity.test.js tests/node/governance-proposals.test.js`

Expected: RED before the change, then PASS with existing local tests unchanged.

- [ ] **Step 2: Write failing Yjs-state tests**

```js
test('hydrates snapshot plus ordered updates into identical Markdown and governance state', () => {
  const original = createGroundYDoc('# Launch Plan\n');
  const snapshot = Y.encodeStateAsUpdate(original.ydoc);
  const vector = Y.encodeStateVector(original.ydoc);
  original.ytext.insert(original.ytext.length, '\nBudget: $100K.');
  const update = Y.encodeStateAsUpdate(original.ydoc, vector);
  const restored = hydrateGroundYDoc({ snapshot, updates: [{ sequence: 1, update }] });
  assert.equal(restored.ytext.toString(), original.ytext.toString());
  assert.deepEqual(restored.activity.toJSON(), original.activity.toJSON());
});
```

Add three concrete cases: initial snapshot text equals `docs/demo/launch-plan.md` and contains one Owner join Activity; WebMCP `$100K` to `$110K` returns one update containing matching Activity; two `$100K` proposals group as one Conflict and `apply_proposed` updates text/status/Activity in one captured update.

Load initial content from `docs/demo/launch-plan.md`; do not copy it into JavaScript.

- [ ] **Step 3: Implement pure Yjs helpers by reusing existing domain functions**

```js
export const hydrateGroundYDoc = ({ snapshot, updates = [] }) => {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, snapshot);
  updates.toSorted((a, b) => a.sequence - b.sequence)
    .forEach(({ update }) => Y.applyUpdate(ydoc, update));
  return {
    activity: ydoc.getArray('governanceActivity'),
    comments: ydoc.getArray('comments'),
    ydoc,
    ytext: ydoc.getText('codemirror'),
  };
};
```

Capture mutations from a pre-mutation state vector so each service response can return exactly the committed delta.

- [ ] **Step 4: Write failing service tests with one in-memory fake store**

Cover exact workflows:

```js
test('join creates Pending without returning document state', async () => {
  const store = createGroundStoreFake();
  const service = createGroundService({ store });
  const result = await service.joinDocument({
    actorId: 'user-reviewer', displayName: 'Reviewer Agent', docId: DOCUMENT_ID,
  });
  assert.equal(result.session.state, 'pending');
  assert.equal(result.session.roleId, undefined);
  assert.equal('snapshot' in result, false);
  assert.equal('updates' in result, false);
});
```

Add five exact cases: three generated-ID collisions cause `GROUND_TEMPORARILY_UNAVAILABLE` and no fourth call; a manifest matrix allows Editor apply and Reviewer propose but denies Reviewer apply; stale `role_version` maps to `GROUND_STALE_STATE`; injected store failures prove access transitions and their Activity update roll back together; and all three WebMCP operations assert actor ID/Role plus exact fixed source.

The fake implements only the store interface above; do not mock Supabase internals.

- [ ] **Step 5: Implement service authorization and snapshots**

Use existing `hasCapability(manifest, roleId, capability)`. Derive actor as:

```js
const actor = {
  displayName: participant.displayName,
  participantSessionId: participant.userId,
  roleId: participant.roleId,
};
```

`sessionFor(participant)` returns `{ capabilities, displayName, documentPath: docId, participantSessionId: userId, roleId, state, version: roleVersion }`. Pending and Revoked responses omit capabilities and document data.

Generate document IDs from 16 random bytes, recovery tokens from 32 random bytes, and store only SHA-256 token hashes. Rate keys use HMAC-SHA-256 and never enter responses.

- [ ] **Step 6: Implement the Supabase store adapter**

Instantiate one server client with the secret key and disabled session persistence. Map each store method to the exact service-only RPC from Plan 1; convert `bytea` base64 at the adapter boundary and never in application code. Normalize PostgREST errors into the stable Ground errors, retaining original details only as an internal `cause` that the HTTP handler never serializes.

- [ ] **Step 7: Verify service and real database integration**

Run:

```bash
node --test tests/node/governance-activity.test.js tests/node/governance-proposals.test.js tests/node/ground-yjs-state.test.js tests/node/ground-document-service.test.js
npm run test:supabase
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/domain/governance-activity.js src/domain/governance-proposals.js src/server/application src/server/infrastructure/supabase src/server/create-ground-runtime.js tests/node tests/supabase
git commit -m "feat: authorize Ground document workflows"
```

### Task 3: Add canonical routes and invisible anonymous identity

**Files:**
- Create: `src/client/domain/ground-route.js`
- Create: `src/client/infrastructure/ground-auth-client.js`
- Create: `src/client/infrastructure/ground-api-client.js`
- Create: `src/client/infrastructure/ground-governance-client.js`
- Modify: `src/client/domain/runtime-paths.js`
- Test: `tests/node/ground-route.test.js`
- Test: `tests/browser/ground-auth-client.browser.test.js`
- Test: `tests/browser/ground-governance-client.browser.test.js`

**Interfaces:**
- `parseGroundRoute(pathname)` -> `{ type: 'landing' }`, `{ type: 'document', docId }`, or `{ type: 'unavailable' }`.
- `GroundAuthClient.initialize()` -> `{ accessToken, supabase, userId }`.
- `GroundApiClient.request(operation, input)` -> parsed response or stable Ground error.
- `GroundGovernanceClient.start({ docId, displayName })`, `refresh()`, `subscribe(listener)`, `assignRole`, `revoke`, `recover`, `resolveProposal`, `destroy()`.

- [ ] **Step 1: Write and run failing route tests**

```js
assert.deepEqual(parseGroundRoute('/'), { type: 'landing' });
assert.deepEqual(parseGroundRoute('/AbCdEf0123456789_-xyZA'), { docId: 'AbCdEf0123456789_-xyZA', type: 'document' });
assert.deepEqual(parseGroundRoute('/api'), { type: 'unavailable' });
assert.deepEqual(parseGroundRoute('/too-short'), { type: 'unavailable' });
```

Also test `/assets`, `/health`, `/ws`, trailing segments, percent-encoding, and trailing-slash canonicalization.

Run: `node --test tests/node/ground-route.test.js`; expected RED, then PASS after the pure parser.

- [ ] **Step 2: Write failing anonymous Auth tests**

Using a fake Supabase client, prove:

```js
test('restores an existing anonymous session without creating another', async () => {
  const supabase = createSupabaseAuthFake({ session: EXISTING_SESSION });
  const result = await new GroundAuthClient({ supabase }).initialize();
  assert.equal(result.userId, EXISTING_SESSION.user.id);
  assert.equal(supabase.signInAnonymouslyCalls, 0);
  assert.deepEqual(supabase.realtimeAuthCalls, [EXISTING_SESSION.access_token]);
});
```

Add three cases: missing session calls anonymous sign-in exactly once; returned token is passed to `realtime.setAuth`; and any get/sign-in/setAuth error rejects without setting `identity`.

- [ ] **Step 3: Implement Auth and API clients**

`GroundAuthClient` creates `@supabase/supabase-js` with `persistSession: true`, `autoRefreshToken: true`, and `detectSessionInUrl: false`. It calls `getSession()`, falls back to `signInAnonymously()`, and then calls `supabase.realtime.setAuth(accessToken)`.

`GroundApiClient` requests a fresh session before every call, sets Bearer plus JSON headers, and maps stable server error codes. It never stores the bearer token separately.

- [ ] **Step 4: Write and implement the governance client tests**

Prove Pending, Active, and Revoked snapshots; monotonic `roleVersion`; stale response suppression; personal access notice refresh; dynamic roles from `list_roles`; and no `kind` field. Reuse the existing `GovernanceClient` listener conventions so `GovernanceUiController` receives the same snapshot shape.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/node/ground-route.test.js
npm run test:browser -- tests/browser/ground-auth-client.browser.test.js tests/browser/ground-governance-client.browser.test.js
npm run lint
```

Expected: PASS.

```bash
git add src/client/domain/ground-route.js src/client/domain/runtime-paths.js src/client/infrastructure/ground-auth-client.js src/client/infrastructure/ground-api-client.js src/client/infrastructure/ground-governance-client.js tests/node/ground-route.test.js tests/browser/ground-auth-client.browser.test.js tests/browser/ground-governance-client.browser.test.js
git commit -m "feat: add Ground document sessions"
```

### Task 4: Implement durable Supabase Yjs collaboration

**Files:**
- Create: `src/client/infrastructure/supabase-collaboration-client.js`
- Test: `tests/browser/supabase-collaboration-client.browser.test.js`

**Interfaces:**
- Matches the existing `EditorCollaborationClient` surface used by `EditorSession`.
- Adds `waitForPendingUpdates()` and reports `{ reason, status }` on rejected or disconnected persistence.

- [ ] **Step 1: Write a fake channel/API harness and RED tests**

Cover:

```js
test('subscribes before hydrate and buffers update notices during the fetch', async () => {
  const harness = createCollaborationHarness();
  const client = harness.createClient();
  const initializing = client.initialize(DOCUMENT_ID);
  await harness.channel.emitSubscribed();
  harness.channel.emitUpdate({ sequence: 8 });
  harness.resolveHydrate({ headSequence: 7, snapshot: EMPTY_SNAPSHOT, updates: [] });
  await initializing;
  assert.deepEqual(harness.calls, ['subscribe', 'hydrate', 'fetch:8', 'gap-after:8']);
  assert.equal(client.initialSyncComplete, true);
});
```

Add seven exact cases: snapshot+rows+buffer+gap produce expected text before ready; two synchronous updates become one `Y.mergeUpdates` request and queued requests never overlap; repeated sequence applies once; unsynchronized state stays true until acknowledgement; 403/404/409/413/network-unknown each freeze and call `onAuthoritativeReload`; reconnect repeats the four-stage call order; and two Presence entries with one user ID render one participant online.

- [ ] **Step 2: Run RED**

Run: `npm run test:browser -- tests/browser/supabase-collaboration-client.browser.test.js`

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement exact initialization order**

```js
async initialize(docId) {
  this.createYDoc();
  await this.subscribeAndWait();
  this.buffering = true;
  await this.hydrateFromApi();
  await this.applyBufferedSequences();
  await this.fetchAndApplyGap();
  this.buffering = false;
  this.initialSyncComplete = true;
  this.onInitialSync?.();
  return this.bindings();
}
```

Use one private `ground-document:<docId>` channel for `update` Broadcast and Presence, plus the governance client's private personal access channel.

- [ ] **Step 4: Implement the local update queue**

Observe Y.Doc updates. Ignore hydration/remote origins. Accumulate same-microtask local updates with `Y.mergeUpdates`, classify proposal-create origin as `proposal_create` and all editable CodeMirror/Undo/Redo origins as `document_edit`, then submit one queue item at a time with the current `roleVersion`.

On success, remember the returned sequence and clear unsynchronized state when the queue drains. On any `403`, `404`, `409`, `413`, or unconfirmed network result, stop the queue, mark frozen, and notify the workspace controller to destroy and authoritatively rebuild the session.

- [ ] **Step 5: Implement presence with existing Awareness semantics**

Use `y-protocols/awareness` for local cursor/viewport shape, encode Presence payloads through Supabase Presence, and expose the existing `collectUsers`, `getUserCursor`, `getUserViewport`, `setLocalViewport`, and `setUserName` methods. Coalesce the Participant bar by authenticated user ID while retaining per-tab cursor state internally.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:browser -- tests/browser/supabase-collaboration-client.browser.test.js
npm run lint
```

Expected: PASS, including the subscribe-before-hydrate ordering assertion.

```bash
git add src/client/infrastructure/supabase-collaboration-client.js tests/browser/supabase-collaboration-client.browser.test.js
git commit -m "feat: sync Ground through Supabase"
```

### Task 5: Inject the hosted collaboration client into the editor

**Files:**
- Modify: `src/client/infrastructure/editor-session.js`
- Modify: `src/client/infrastructure/editor-collaboration-client.js`
- Modify: `src/client/application/workspace-coordinator.js`
- Test: `tests/node/editor-session.test.js`
- Test: `tests/browser/editor-view-adapter.browser.test.js`

**Interfaces:**
- `EditorSession` accepts `createCollaborationClient(options)`; default remains `new EditorCollaborationClient(options)`.
- `EditorSession.waitForPendingUpdates()` delegates when implemented and otherwise resolves immediately.
- Existing local constructor calls need no change.

- [ ] **Step 1: Write failing injection and persistence tests**

```js
test('uses an injected collaboration client', async () => {
  const hostedClient = createHostedCollaborationFake();
  const session = new EditorSession({
    ...editorOptions,
    createCollaborationClient: () => hostedClient,
  });
  await session.initialize(DOCUMENT_ID);
  assert.equal(session.collaborationClient, hostedClient);
  assert.equal(hostedClient.initializeCalls, 1);
});
```

Add three cases: `waitForPendingUpdates` returns the fake's deferred promise; destroy/recreate after revocation yields empty editor DOM and Undo stack; representative Undo, Redo, and paste queue `document_edit` and leave Proposal/Conflict/Activity decisions unchanged.

- [ ] **Step 2: Run RED**

Run: `node --test tests/node/editor-session.test.js`

Expected: FAIL for the missing injection point.

- [ ] **Step 3: Add the one justified factory seam**

```js
const defaultCreateCollaborationClient = (options) => new EditorCollaborationClient(options);

export class EditorSession {
  constructor({ createCollaborationClient = defaultCreateCollaborationClient, ...options }) {
    this.collaborationClient = createCollaborationClient(collaborationOptions);
  }

  waitForPendingUpdates() {
    return this.collaborationClient.waitForPendingUpdates?.() ?? Promise.resolve();
  }
}
```

Do not add an abstract base class, registry, or backend selector.

- [ ] **Step 4: Preserve local behavior and verify**

Run:

```bash
node --test tests/node/editor-session.test.js tests/node/editor-view-adapter.test.js
npm run test:browser -- tests/browser/editor-view-adapter.browser.test.js
npm run test:e2e:governance:prebuilt
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/infrastructure/editor-session.js src/client/infrastructure/editor-collaboration-client.js src/client/application/workspace-coordinator.js tests/node/editor-session.test.js tests/browser/editor-view-adapter.browser.test.js
git commit -m "refactor: inject editor collaboration transport"
```

### Task 6: Build the Ground landing and document shell

**Files:**
- Create: `src/client/application/ground-workspace-controller.js`
- Create: `src/client/presentation/ground-entry-controller.js`
- Create: `src/client/bootstrap/ground-app-shell.js`
- Create: `src/client/ground-main.js`
- Modify: `src/client/app/main-entry.js`
- Modify: `src/client/app/index.html`
- Modify: `src/client/application/app-shell-elements.js`
- Test: `tests/browser/ground-workspace-controller.browser.test.js`
- Test: `tests/browser/ground-entry-controller.browser.test.js`
- Modify: `tests/node/client-build.test.js`

**Interfaces:**
- `GroundWorkspaceController.start(route)` orchestrates landing, recovery, join, Access refresh, editor creation, and teardown.
- `GroundEntryController` exposes `showLanding`, `requestDisplayName`, `showRecoveryLink`, `showUnavailable`, `copyShareLink`, and `showDocument`.
- `GroundAppShell.initialize()` composes existing `GovernanceUiController`, `EditorSession`, `ThemeController`, `ToastController`, and the Ground clients.

- [ ] **Step 1: Write RED state-transition tests**

```js
test('a new visitor submits only a display name and remains Pending', async () => {
  const harness = createGroundWorkspaceHarness({ joinState: 'pending' });
  await harness.controller.start({ docId: DOCUMENT_ID, type: 'document' });
  harness.entry.resolveDisplayName('Reviewer Agent');
  await harness.idle();
  assert.deepEqual(harness.api.joinCalls, [{ displayName: 'Reviewer Agent', docId: DOCUMENT_ID }]);
  assert.equal(harness.entry.currentView, 'pending');
  assert.equal(harness.editorCreateCalls, 0);
});
```

Add five exact cases: create navigates with `history.pushState` to one canonical segment; Active waits for collaboration readiness before editor display; Revoked/unavailable destroys session, Y.Doc, DOM, and Undo history; rejected optimistic state creates a fresh session from server data; and recovery calls `history.replaceState` before API request then shows the replacement link once.

- [ ] **Step 2: Add the approved semantic HTML**

Merge, do not overwrite, the user's current `index.html` diff. Add hidden-by-default:

```html
<section id="groundLanding" aria-labelledby="groundLandingTitle" hidden>
  <h1 id="groundLandingTitle">One document. Different roles.</h1>
  <button id="createGroundDocument" type="button">Create demo document</button>
</section>
<button id="shareGroundDocument" type="button" hidden>Share document</button>
<dialog id="groundRecoveryDialog" aria-labelledby="groundRecoveryTitle">
  <h2 id="groundRecoveryTitle">Save your Owner recovery link</h2>
  <input id="groundRecoveryLink" readonly aria-label="Owner recovery link">
  <button id="copyGroundRecoveryLink" type="button">Copy recovery link</button>
  <button id="closeGroundRecovery" type="button">Done</button>
</dialog>
```

Do not add Human/AI, comments, chat, format, search, preview, split, or document-list controls. Ground bootstrap removes the local tab-lock dialog from the Ground DOM; local CollabMD retains its current path.

- [ ] **Step 3: Implement presentation and application controllers**

The entry controller owns DOM/focus/clipboard only. The workspace controller owns async state and takes injected callbacks. Copy canonical `${location.origin}/${docId}`; never include query or fragment. If Clipboard API fails, focus and select a read-only link field in the recovery dialog.

- [ ] **Step 4: Compose the hosted shell**

`main-entry.js` reads the already-loaded `window.__COLLABMD_CONFIG__.groundHosted`:

```js
if (window.__COLLABMD_CONFIG__?.groundHosted) {
  await import('../ground-main.js');
} else {
  await import('../main.js');
}
```

Ground shell does not create `WorkspaceSyncClient`, `FileTreeState`, `TabActivityLock`, or `WebsocketProvider`. It uses `docId` as `documentPath` in the compatibility snapshot supplied to existing governance presentation.

- [ ] **Step 5: Verify browser and build contracts**

Run:

```bash
npm run test:browser -- tests/browser/ground-workspace-controller.browser.test.js tests/browser/ground-entry-controller.browser.test.js
node --test tests/node/client-build.test.js
npm run build
npm run test:guardrails
```

Expected: PASS; built index includes icon, app-config, Ground entry, and no missing asset.

- [ ] **Step 6: Commit**

```bash
git add src/client/application/ground-workspace-controller.js src/client/presentation/ground-entry-controller.js src/client/bootstrap/ground-app-shell.js src/client/ground-main.js src/client/app/main-entry.js src/client/app/index.html src/client/application/app-shell-elements.js tests/browser/ground-workspace-controller.browser.test.js tests/browser/ground-entry-controller.browser.test.js tests/node/client-build.test.js
git commit -m "feat: add Ground document entry flow"
```

### Task 7: Route WebMCP and Owner decisions through the server

**Files:**
- Modify: `src/client/infrastructure/webmcp-tool-registry.js`
- Modify: `src/client/application/app-shell/governance-feature.js`
- Modify: `src/client/bootstrap/ground-app-shell.js`
- Modify: `src/server/application/ground-document-service.js`
- Test: `tests/node/webmcp-tool-registry.test.js`
- Test: `tests/node/ground-document-service.test.js`
- Test: `tests/browser/ground-workspace-controller.browser.test.js`

**Interfaces:**
- `WebMcpToolRegistry` accepts optional `executor` with asynchronous `read(input)`, `apply(input)`, and `propose(input)`; current local execution remains default.
- Ground executor maps directly to `webmcp_read`, `webmcp_apply`, and `webmcp_propose` API operations.
- Ground Owner actions call `assign_role`, `revoke_participant`, and `resolve_proposal`; they never append duplicate local Activity.

- [ ] **Step 1: Write RED WebMCP executor tests**

```js
test('hosted apply waits for the asynchronous executor result', async () => {
  const committed = Promise.withResolvers();
  const executor = createExecutorFake({ applyPromise: committed.promise });
  const registry = createRegistry({ executor });
  await registry.refresh();
  const execution = executeRegisteredTool('collabmd_apply_text_edits', VALID_EDIT);
  let didResolve = false;
  void execution.then(() => { didResolve = true; });
  await Promise.resolve();
  assert.deepEqual(executor.applyCalls, [VALID_EDIT]);
  assert.equal(didResolve, false);
  committed.resolve({ replacementCount: 1, sequence: 9 });
  const result = await execution;
  assert.equal(result.replacementCount, 1);
});
```

Add four cases: hosted read passes the active document ID; propose leaves local text unchanged until sequence application; a cached apply receives `GROUND_FORBIDDEN` after revoke; and omitting `executor` exercises the unchanged local session implementation.

- [ ] **Step 2: Add executor injection without duplicating schemas**

Keep the existing three tool names and input schemas. Inside each `execute`, use the injected executor when present; otherwise retain the current session implementation. Ground API itself performs the fresh Capability check, so no client-only authorization result can approve a hosted mutation. The Ground executor implementation calls the API and then waits for `SupabaseCollaborationClient.waitForSequence(result.sequence)` before resolving apply, propose, or Owner decision calls.

- [ ] **Step 3: Test and implement server semantic mutations**

For WebMCP apply/propose and Owner resolve, load authoritative Yjs state, verify the exact revision/target, use existing proposal/domain functions, capture one combined Yjs update, and call `commitUpdate` with the actor's still-current `roleVersion`. Sources are exactly `webmcp_apply`, `webmcp_proposal`, and `owner_decision`.

Role assignment/revocation builds the `access_management` Activity update on the server and passes it to the atomic governance RPC. The Ground shell waits for the resulting sequence notification; it does not call `appendGovernanceAccessActivity`.

- [ ] **Step 4: Verify all Role paths**

Run:

```bash
node --test tests/node/webmcp-tool-registry.test.js tests/node/ground-document-service.test.js
npm run test:browser -- tests/browser/ground-workspace-controller.browser.test.js
npm run test:supabase
npm run test:e2e:governance:prebuilt
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/infrastructure/webmcp-tool-registry.js src/client/application/app-shell/governance-feature.js src/client/bootstrap/ground-app-shell.js src/server/application/ground-document-service.js tests/node/webmcp-tool-registry.test.js tests/node/ground-document-service.test.js tests/browser/ground-workspace-controller.browser.test.js
git commit -m "feat: enforce hosted WebMCP roles"
```

### Task 8: Finish Ground visual behavior and focused guardrails

**Files:**
- Create: `src/client/styles/features/ground-entry.css`
- Modify: `src/client/styles/style.css`
- Modify: `src/client/styles/features/governance.css`
- Modify: `src/client/styles/foundation/themes.css`
- Modify: `src/client/presentation/governance-ui-controller.js`
- Modify: `src/client/app/index.html`
- Modify: `tests/browser/governance-ui-controller.browser.test.js`
- Modify: `tests/node/guardrails/focused-product-surface.test.js`
- Modify: `tests/e2e/ui-visual.spec.js`

**Interfaces:**
- Produces the approved landing, prominent Share action, readable light/dark Ground shell, and stable pending interaction behavior.

- [ ] **Step 1: Write RED UI/guardrail tests**

Assert:

```text
Ground header says Ground, not CollabMD
Share document is visible only on a document and copies canonical URL
join asks only for Name
Pending and Revoked have no editor/document/governance content
Manage Access fields disable per pending row and the dialog does not close
Activity contains actor/action/time/source/outcome/target and no Human/AI badge
comments/chat/format/search/split/preview/tab-lock controls are absent in Ground DOM
light and dark snapshots contain readable foreground text
360 px has no horizontal overflow
```

- [ ] **Step 2: Implement styles using existing tokens**

Import `ground-entry.css` from `style.css`. Add raw Ground blue/light/dark values only as theme tokens in `themes.css`; consume variables elsewhere. Preserve visible focus, reduced motion, semantic dialog labels, and the current roving governance tabs.

- [ ] **Step 3: Remove `participantKind` presentation and preserve legacy reads**

The UI ignores optional historical `actor.kind`; it renders only display name and Role at creation. Update tests that currently assert `Human` or `AI` only for the Ground surface, without deleting unrelated local compatibility parsing.

- [ ] **Step 4: Inspect visual output before accepting snapshots**

Run:

```bash
npm run build
npx playwright test tests/e2e/ui-visual.spec.js --update-snapshots
npx playwright test tests/e2e/ui-visual.spec.js
npm run test:guardrails
```

Open every changed PNG. Reject white-on-white text, clipped dialogs, hidden focus, or accidental legacy controls before keeping snapshots.

- [ ] **Step 5: Commit**

```bash
git add src/client/styles src/client/presentation/governance-ui-controller.js src/client/app/index.html tests/browser/governance-ui-controller.browser.test.js tests/node/guardrails/focused-product-surface.test.js tests/e2e/ui-visual.spec.js tests/e2e/ui-visual.spec.js-snapshots
git commit -m "feat: finish Ground focused interface"
```

### Task 9: Prove the complete local hosted flow

**Files:**
- Create: `scripts/serve-ground-local.mjs`
- Create: `tests/e2e/helpers/ground-app-fixture.js`
- Create: `tests/e2e/ground-hosted.spec.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `npm run start:ground`, `npm run test:e2e:ground`, and a Playwright `groundServer` fixture.

- [ ] **Step 1: Add a local Web-to-Node adapter and smoke test**

`serve-ground-local.mjs` obtains local Supabase values from `supabase status -o env`, composes the same Ground runtime as Vercel, serves `dist/client`, returns Ground `app-config.js`, and serves `index.html` only for `/` or a valid `/:docId`. It buffers request bodies only up to the configured maximum and sets the spec security headers.

Add scripts:

```json
{
  "start:ground": "npm run build && node scripts/serve-ground-local.mjs",
  "test:e2e:ground": "npm run build && playwright test tests/e2e/ground-hosted.spec.js"
}
```

- [ ] **Step 2: Write the first failing full flow**

```js
test('creates, shares, joins Pending, and assigns both Roles', async ({ browser, groundServer }) => {
  const owner = await openGroundContext(browser, groundServer.baseURL, 'Owner');
  const created = await createGroundDocument(owner.page);
  await expect(owner.page).toHaveURL(new RegExp(`/${created.docId}$`, 'u'));
  const shareUrl = await copyGroundShareUrl(owner.page);
  const editor = await joinGroundDocument(browser, shareUrl, 'Writer Agent');
  const reviewer = await joinGroundDocument(browser, shareUrl, 'Reviewer Agent');
  await expectGroundPending(editor.page);
  await expectGroundPending(reviewer.page);
  await assignGroundRole(owner.page, editor.userId, 'editor');
  await assignGroundRole(owner.page, reviewer.userId, 'reviewer');
  await expectGroundEditor(editor.page, { editable: true });
  await expectGroundEditor(reviewer.page, { editable: false });
});
```

Use separate browser contexts for Owner, Editor, and Reviewer. Assert the URL is `/:docId`, the Owner receives a recovery link without exposing it in Share, and Pending sees no Markdown.

- [ ] **Step 3: Add only the remaining hosted boundary flows**

Add six named tests with exact outcomes:

```text
human and WebMCP edits: every context reaches identical Markdown after reconnect
multiple proposals: two same-anchor proposals render one Conflict group; accepted/rejected status survives reload
Activity: each row contains non-empty actor/action/time/source/outcome/target; WebMCP sources are exact
revoke race: rejected text disappears, prior accepted text remains, editor DOM and Undo history are rebuilt
Owner recovery: new browser is sole Owner; old browser and used token show unavailable/revoked state
isolation and size: second session receives safe denial; oversized update creates no new sequence
```

Do not duplicate every CodeMirror keyboard action. Existing unit/browser tests own those semantics.

- [ ] **Step 4: Run the focused hosted suite repeatedly**

Run:

```bash
npm run supabase:start
npm run test:supabase
npm run test:e2e:ground
for run in 1 2 3; do npm run test:e2e:ground || exit 1; done
```

Expected: all flows pass three consecutive reruns with no retry-only success.

- [ ] **Step 5: Run the complete local regression gate**

Run:

```bash
npm run check
npm run test:e2e:governance:prebuilt
npm run test:e2e:ground
git diff --check
```

Expected: PASS; inspect all Playwright failures before any rerun.

- [ ] **Step 6: Commit**

```bash
git add scripts/serve-ground-local.mjs tests/e2e/helpers/ground-app-fixture.js tests/e2e/ground-hosted.spec.js package.json package-lock.json
git commit -m "test: cover Ground hosted collaboration"
```
