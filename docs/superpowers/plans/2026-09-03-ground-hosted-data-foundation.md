# Ground Hosted Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node 24 and Supabase foundation that gives every Ground document durable, isolated content, participants, Roles, recovery, ordered Yjs updates, limits, and retention.

**Architecture:** Supabase Auth supplies invisible anonymous identities. Public tables expose only RLS-protected reads and private Realtime authorization; every mutation is a service-only Postgres function called later by the Vercel API with a verified actor ID and expected `role_version`. The existing local filesystem/WebSocket runtime remains intact.

**Tech Stack:** Node.js 24, npm, Supabase CLI 2.116.0, `@supabase/supabase-js` 2.114.0, PostgreSQL 17, Supabase Auth/RLS/Realtime/Cron, Yjs 13.6.32, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-03-ground-hosted-mvp-design.md`

## Global Constraints

- Preserve the user's existing uncommitted `src/client/app/index.html`, `docs/assets/ground-thumbnail.png`, and `src/client/app/ground-icon.svg` work; never reset or overwrite it.
- `collabmd.governance.json` is the only Role-to-Capability map. SQL stores `role_id` and `role_version`; it does not duplicate Capability arrays.
- Access state is exactly `pending`, `active`, or `revoked`; only Active has a non-null Role.
- Exactly one Active `owner` exists per document.
- Public browser roles receive no direct insert, update, delete, or mutation-function execute grant.
- Use Supabase publishable keys in browsers and secret keys only on trusted servers; do not add legacy key names to new public documentation.
- Realtime carries sequence/access notices and presence only, never Yjs update payloads.
- Ground is single-region and targets tens of concurrent users for this MVP.
- No login UI, group hierarchy, email invitations, offline queue, separate audit database, or generic persistence framework.
- Every behavioral task follows RED -> GREEN -> REFACTOR and ends with a focused commit.

## File Structure

- `supabase/config.toml`: reproducible local Supabase services and anonymous Auth.
- `supabase/seed.sql`: intentionally empty deterministic local seed.
- `supabase/migrations/20260903010000_ground_core.sql`: document/participant tables, helpers, RLS, create/join reads.
- `supabase/migrations/20260903020000_ground_updates.sql`: ordered update commits and private Realtime notices.
- `supabase/migrations/20260903030000_ground_governance.sql`: Role assignment, revocation, and Owner recovery.
- `supabase/migrations/20260903040000_ground_maintenance.sql`: rate windows, compaction, retention, and Cron.
- `scripts/run-ground-supabase-tests.mjs`: reads local CLI connection output and runs only Supabase tests.
- `src/domain/ground-hosted-contract.js`: pure identifiers, Access-state, operation, source, and limit contracts.
- `tests/supabase/ground-supabase-fixture.js`: real anonymous/admin client helpers; no database mocks.
- `tests/supabase/ground-core.test.js`: creation, join, RLS, and document isolation.
- `tests/supabase/ground-updates.test.js`: ordered updates, Realtime, reconnect, and revocation race.
- `tests/supabase/ground-governance.test.js`: manifest Role assignment and Owner recovery.
- `tests/supabase/ground-maintenance.test.js`: limits, compaction, rate windows, and deletion.
- `tests/node/ground-hosted-contract.test.js`: pure contract validation.
- `tests/node/guardrails/ground-node-runtime.test.js`: Node 24 metadata consistency.

---

### Task 1: Prove and align Node 24

**Files:**
- Create: `tests/node/guardrails/ground-node-runtime.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.tool-versions`
- Modify: `Dockerfile`
- Modify: `.github/workflows/docker-publish.yml`
- Modify: `.github/workflows/homebrew-tap-release.yml`
- Modify: `.github/workflows/npm-publish.yml`

**Interfaces:**
- Consumes: Current repository commands and Vercel's supported Node 24 runtime.
- Produces: One repository-wide Node 24 floor used by later plans and deployment.

- [ ] **Step 1: Run the current suite under the installed Node 24 before changing metadata**

Run:

```bash
node --version
npm run check
npm run build
npm run test:e2e:governance:prebuilt
```

Expected: Node reports `v24.x`; all commands pass. If a command fails, stop this task, diagnose the exact incompatibility, and do not change version claims.

- [ ] **Step 2: Write the failing runtime consistency guard**

```js
// tests/node/guardrails/ground-node-runtime.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('uses Node 24 across local, container, package, and workflow metadata', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.engines.node, '>=24');
  assert.equal((await readFile('.tool-versions', 'utf8')).trim(), 'nodejs 24.19.0');
  assert.doesNotMatch(await readFile('Dockerfile', 'utf8'), /node:26/u);
  for (const path of [
    '.github/workflows/docker-publish.yml',
    '.github/workflows/homebrew-tap-release.yml',
    '.github/workflows/npm-publish.yml',
  ]) {
    assert.doesNotMatch(await readFile(path, 'utf8'), /node-version:\s*26/u);
  }
});
```

- [ ] **Step 3: Verify the guard fails for the existing Node 26 metadata**

Run: `node --test tests/node/guardrails/ground-node-runtime.test.js`

Expected: FAIL at `packageJson.engines.node` or `.tool-versions`.

- [ ] **Step 4: Make the smallest metadata change**

Set:

```text
package.json engines.node = ">=24"
.tool-versions = "nodejs 24.19.0"
Dockerfile build/runtime images = node:24-alpine
all three workflow node-version values = 24
```

Run `npm install --package-lock-only --ignore-scripts` so the root lockfile metadata matches `package.json` without upgrading dependencies.

- [ ] **Step 5: Verify the guard and baseline again**

Run:

```bash
node --test tests/node/guardrails/ground-node-runtime.test.js
npm run check
npm run build
npm run test:e2e:governance:prebuilt
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .tool-versions Dockerfile .github/workflows tests/node/guardrails/ground-node-runtime.test.js
git commit -m "chore: align runtime with Node 24"
```

### Task 2: Add reproducible Supabase tooling

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `supabase/config.toml`
- Create: `supabase/seed.sql`
- Create: `scripts/run-ground-supabase-tests.mjs`
- Create: `tests/supabase/ground-supabase-fixture.js`
- Create: `tests/supabase/ground-harness.test.js`
- Test: `tests/node/guardrails/ground-supabase-tooling.test.js`

**Interfaces:**
- Consumes: `supabase status -o env` values `API_URL`, `PUBLISHABLE_KEY` or `ANON_KEY`, and `SECRET_KEY` or `SERVICE_ROLE_KEY`.
- Produces: `npm run supabase:start`, `supabase:reset`, `supabase:stop`, and `test:supabase`; fixture exports `createAnonymousClient()`, `createAdminClient()`, `uniqueDocumentId()`, `createDocumentAsAdmin(input)`, `createPendingScenario()`, `createActiveEditorScenario()`, `assignRoleAsAdmin(input)`, `commitRawUpdate(scenario, update)`, and focused read helpers used below.

- [ ] **Step 1: Write a failing tooling guard**

```js
// tests/node/guardrails/ground-supabase-tooling.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('pins the Ground Supabase SDK, CLI, and test commands', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.dependencies['@supabase/supabase-js'], '2.114.0');
  assert.equal(packageJson.devDependencies.supabase, '2.116.0');
  assert.equal(packageJson.scripts['test:supabase'], 'node scripts/run-ground-supabase-tests.mjs');
  assert.match(await readFile('supabase/config.toml', 'utf8'), /enable_anonymous_sign_ins = true/u);
});
```

- [ ] **Step 2: Run the guard and observe missing tooling**

Run: `node --test tests/node/guardrails/ground-supabase-tooling.test.js`

Expected: FAIL because the dependency/config does not exist.

- [ ] **Step 3: Install only the two required packages**

Run:

```bash
npm install --save-exact @supabase/supabase-js@2.114.0
npm install --save-dev --save-exact supabase@2.116.0
```

Add scripts:

```json
{
  "supabase:start": "supabase start",
  "supabase:reset": "supabase db reset",
  "supabase:stop": "supabase stop",
  "test:supabase": "node scripts/run-ground-supabase-tests.mjs"
}
```

- [ ] **Step 4: Initialize and narrow local Supabase configuration**

Run `npx supabase init`, keep generated defaults, then set:

```toml
project_id = "ground-webmcp"

[auth]
enabled = true
enable_signup = true
enable_anonymous_sign_ins = true

[realtime]
enabled = true
```

Keep `supabase/seed.sql` empty except for a comment. Add `supabase/.temp/` and `supabase/.branches/` to `.gitignore`; do not ignore migrations or tests.

- [ ] **Step 5: Implement deterministic local environment parsing**

```js
// scripts/run-ground-supabase-tests.mjs (core contract)
export const parseSupabaseEnv = (text) => Object.fromEntries(
  text.trim().split('\n').map((line) => {
    const [name, ...parts] = line.split('=');
    return [name, parts.join('=').replace(/^"|"$/gu, '')];
  }),
);

// Spawn `supabase status -o env`, then run Node tests with:
// SUPABASE_URL = API_URL
// SUPABASE_PUBLISHABLE_KEY = PUBLISHABLE_KEY ?? ANON_KEY
// SUPABASE_SECRET_KEY = SECRET_KEY ?? SERVICE_ROLE_KEY
```

The runner exits with an actionable message when the local stack is not running. It runs `supabase db reset`, reads and sorts actual `*.test.js` paths from `tests/supabase`, then spawns `node --test --test-force-exit`, `process.argv.slice(2)`, and those paths in that order so `--test-name-pattern` works without relying on shell glob expansion.

- [ ] **Step 6: Implement the real-client fixture**

```js
// tests/supabase/ground-supabase-fixture.js (public interface)
export const createAnonymousClient = async () => ({ client, session, userId });
export const createAdminClient = () => createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
export const uniqueDocumentId = () => randomBytes(16).toString('base64url');
export const encodeUpdate = (value) => Buffer.from(value).toString('base64');
export const decodeUpdate = (value) => new Uint8Array(Buffer.from(value, 'base64'));
```

Add `ground-harness.test.js` with one real anonymous sign-in assertion:

```js
test('creates an anonymous local Supabase session', async () => {
  const { session, userId } = await createAnonymousClient();
  assert.ok(session.access_token);
  assert.equal(session.user.id, userId);
});
```

- [ ] **Step 7: Start the stack and verify the harness**

Run:

```bash
npm run supabase:start
node --test tests/node/guardrails/ground-supabase-tooling.test.js
npm run test:supabase
```

Expected: guard PASS; the anonymous-session harness test PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore supabase scripts/run-ground-supabase-tests.mjs tests/supabase tests/node/guardrails/ground-supabase-tooling.test.js
git commit -m "test: add local Supabase harness"
```

### Task 3: Create documents, participants, and isolated reads

**Files:**
- Create: `src/domain/ground-hosted-contract.js`
- Create: `tests/node/ground-hosted-contract.test.js`
- Create: `supabase/migrations/20260903010000_ground_core.sql`
- Create: `tests/supabase/ground-core.test.js`

**Interfaces:**
- Produces: `GROUND_ACCESS_STATES`, `GROUND_OPERATION_KINDS`, `GROUND_ACTIVITY_SOURCES`, `isGroundDocumentId(value)`, `createGroundDocumentId(crypto)`, `normalizeGroundDisplayName(value)`.
- Produces SQL: `ground_create_document(p_document_id text, p_owner_id uuid, p_display_name text, p_initial_snapshot bytea, p_recovery_token_hash bytea, p_now timestamptz)`, `ground_join_document(p_document_id text, p_user_id uuid, p_display_name text, p_now timestamptz)`, and RLS-protected reads of documents, own membership, and Owner membership lists.

- [ ] **Step 1: Write failing pure contract tests**

```js
test('creates a 22-character URL-safe document id', () => {
  assert.match(createGroundDocumentId(), /^[A-Za-z0-9_-]{22}$/u);
});

test('normalizes a non-empty display name up to 24 characters', () => {
  assert.equal(normalizeGroundDisplayName('  Writer Agent  '), 'Writer Agent');
  assert.throws(() => normalizeGroundDisplayName(''));
  assert.throws(() => normalizeGroundDisplayName('x'.repeat(25)));
  assert.throws(() => normalizeGroundDisplayName('bad\u0000name'));
});
```

- [ ] **Step 2: Run RED, then implement the pure contract**

Run: `node --test tests/node/ground-hosted-contract.test.js`

Minimal exports:

```js
export const GROUND_ACCESS_STATES = Object.freeze(['pending', 'active', 'revoked']);
export const isGroundDocumentId = (value) => /^[A-Za-z0-9_-]{22}$/u.test(value);
const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
export const createGroundDocumentId = (cryptoImpl = globalThis.crypto) => {
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return toBase64Url(bytes);
};
export const normalizeGroundDisplayName = (value) => {
  const name = String(value ?? '').trim();
  if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new TypeError('Display name must contain 1 to 24 visible characters.');
  }
  return name;
};
```

Run the focused Node test again; expected PASS.

- [ ] **Step 3: Write failing real-database tests**

Cover in `ground-core.test.js`:

```js
test('concurrent creation leaves exactly one Owner', async () => {
  const first = await createAnonymousClient();
  const second = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  const attempts = await Promise.all([
    createDocumentAsAdmin({ actorId: first.userId, documentId }),
    createDocumentAsAdmin({ actorId: second.userId, documentId }),
  ].map((promise) => promise.then(() => 'created', () => 'rejected')));
  assert.deepEqual(attempts.toSorted(), ['created', 'rejected']);
  assert.deepEqual(await readParticipantsAsAdmin(documentId), [{
    access_state: 'active', role_id: 'owner', role_version: 1,
  }]);
});
```

The same file adds three explicit cases: a later visitor's RPC result and own row are `pending/null/1` while document select returns zero rows; an Active user selecting a second document receives zero rows; and rejoining a Revoked row returns `revoked/null` without changing `role_version`.

- [ ] **Step 4: Run RED against an empty database**

Run: `npm run test:supabase -- --test-name-pattern="creation|join|another document"`

Expected: FAIL because `ground_documents` and RPC functions do not exist.

- [ ] **Step 5: Add the core schema and security-definer helpers**

The migration creates:

```sql
create table public.ground_documents (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  snapshot bytea not null,
  snapshot_sequence bigint not null default 0,
  head_sequence bigint not null default 0,
  last_mutation_at timestamptz not null,
  recovery_token_hash bytea not null,
  created_at timestamptz not null default now()
);

create table public.ground_participants (
  document_id text not null references public.ground_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 24),
  access_state text not null check (access_state in ('pending', 'active', 'revoked')),
  role_id text,
  role_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_id, user_id),
  check ((access_state = 'active') = (role_id is not null))
);

create unique index ground_one_owner_per_document
  on public.ground_participants(document_id)
  where access_state = 'active' and role_id = 'owner';
```

Create `private.ground_participant(document_id, user_id)` as a stable security-definer lookup with `set search_path = ''`. Revoke it from public and grant only the minimum execution needed by authenticated RLS policies.

Create service-only `ground_create_document` and `ground_join_document`. Creation inserts document and Active Owner atomically. Join upserts only a new Pending row; an existing Active or Revoked row keeps its state and may update only its validated display name.

- [ ] **Step 6: Add and verify RLS**

Enable RLS on both tables. Grant authenticated users only:

```text
ground_documents SELECT: own participant is Active
ground_participants SELECT: own row OR caller is the document's Active Owner
all INSERT/UPDATE/DELETE: no browser grant
service-only functions: no anon/authenticated EXECUTE grant
```

Run: `npm run test:supabase -- --test-name-pattern="creation|join|another document"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/ground-hosted-contract.js tests/node/ground-hosted-contract.test.js supabase/migrations/20260903010000_ground_core.sql tests/supabase/ground-core.test.js
git commit -m "feat: add isolated Ground documents"
```

### Task 4: Append ordered Yjs updates and send private notices

**Files:**
- Create: `supabase/migrations/20260903020000_ground_updates.sql`
- Create: `tests/supabase/ground-updates.test.js`
- Modify: `src/domain/ground-hosted-contract.js`
- Modify: `tests/node/ground-hosted-contract.test.js`

**Interfaces:**
- Produces SQL: `ground_commit_update(document_id, actor_id, expected_role_version, operation_kind, source, update, now)` returning the committed sequence.
- Produces channels: `ground-document:<docId>` event `update` with `{ sequence }`, and `ground-access:<userId>` event `access` with no document content.

- [ ] **Step 1: Write failing operation-contract tests**

Define and test exact operation/source values:

```js
assert.deepEqual(GROUND_OPERATION_KINDS, [
  'document_edit', 'proposal_create', 'proposal_resolve',
  'access_change', 'owner_recovery',
]);
assert.deepEqual(GROUND_ACTIVITY_SOURCES, [
  'document_editor', 'webmcp_apply', 'webmcp_proposal',
  'owner_decision', 'access_management', 'system_reconciliation',
]);
```

- [ ] **Step 2: Write failing database tests**

Cover:

```js
test('commits monotonically ordered updates for the same document', async () => {
  const scenario = await createActiveEditorScenario();
  const first = await commitText(scenario, 'A');
  const second = await commitText(scenario, 'B');
  assert.equal(second.sequence, first.sequence + 1);
  assert.equal((await readUpdateRows(scenario.documentId)).length, 2);
});
```

Add four more cases with exact outcomes: committing with the previous `role_version` rejects with `GROUND_STALE_STATE` and inserts no row; the `update` Broadcast payload has only `sequence`; Pending and unrelated clients reach `CHANNEL_ERROR`; and a fresh Y.Doc applying rows ordered by sequence equals `AB`.

Wait for `SUBSCRIBED` before committing; this is required by the verified spike race.

- [ ] **Step 3: Run RED**

Run: `npm run test:supabase -- --test-name-pattern="ordered|sequence notice|reconnect|role_version"`

Expected: FAIL because updates/functions/policies do not exist.

- [ ] **Step 4: Create the update log and atomic commit**

```sql
create table public.ground_yjs_updates (
  document_id text not null references public.ground_documents(id) on delete cascade,
  sequence bigint not null,
  update_payload bytea not null,
  actor_id uuid not null references auth.users(id),
  operation_kind text not null,
  source text not null,
  created_at timestamptz not null,
  primary key (document_id, sequence)
);
```

`ground_commit_update` must lock the document and actor participant rows, compare Active state plus `expected_role_version`, increment `head_sequence`, insert one update, advance `last_mutation_at`, and return the sequence in one transaction. It performs no Role-to-Capability mapping; the trusted application service owns that manifest check.

Replace the core `ground_join_document` with a signature that also accepts `p_activity_update bytea`. When it creates a new Pending row, allocate one update sequence for the server-built participant-joined Activity in the same transaction. Rejoining an existing Active or Revoked row does not append a second join Activity.

- [ ] **Step 5: Add private Realtime notification and presence policies**

Use `realtime.send(jsonb_build_object('sequence', NEW.sequence), 'update', 'ground-document:' || NEW.document_id, true)` from an AFTER INSERT trigger. Add `realtime.messages` SELECT/INSERT policies so:

```text
Active member + ground-document:<docId> + broadcast/presence => read
Active member + ground-document:<docId> + presence => insert
auth.uid() + ground-access:<same-user-id> + broadcast => read
all other topic/extension combinations => denied
```

Disable public Realtime channels in hosted project setup; clients always set `{ config: { private: true } }`.

- [ ] **Step 6: Run focused and repeated tests**

Run:

```bash
node --test tests/node/ground-hosted-contract.test.js
npm run test:supabase -- --test-name-pattern="ordered|sequence notice|reconnect|role_version"
for run in 1 2 3 4 5 6 7 8 9 10; do npm run test:supabase -- --test-name-pattern="ordered|reconnect" || exit 1; done
```

Expected: every run PASS; no subscription timeout.

- [ ] **Step 7: Commit**

```bash
git add src/domain/ground-hosted-contract.js tests/node/ground-hosted-contract.test.js supabase/migrations/20260903020000_ground_updates.sql tests/supabase/ground-updates.test.js
git commit -m "feat: persist ordered Ground updates"
```

### Task 5: Persist Role transitions and Owner recovery

**Files:**
- Create: `supabase/migrations/20260903030000_ground_governance.sql`
- Create: `tests/supabase/ground-governance.test.js`

**Interfaces:**
- Produces SQL: `ground_assign_role(p_document_id, p_owner_id, p_expected_owner_version, p_target_user_id, p_role_id, p_activity_update, p_now)`, `ground_revoke_participant(p_document_id, p_owner_id, p_expected_owner_version, p_target_user_id, p_activity_update, p_now)`, and `ground_recover_owner(p_document_id, p_actor_id, p_display_name, p_token_hash, p_next_token_hash, p_activity_update, p_now)`.
- Each transition accepts one already-built Yjs Activity update and commits participant state plus that update atomically.

- [ ] **Step 1: Write failing Role and recovery tests**

```js
test('Owner assigns a manifest Role and increments target role_version', async () => {
  const { documentId, owner, pending } = await createPendingScenario();
  const result = await assignRoleAsAdmin({
    actorId: owner.userId,
    documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: pending.userId,
  });
  assert.equal(result.participant.access_state, 'active');
  assert.equal(result.participant.role_id, 'editor');
  assert.equal(result.participant.role_version, 2);
});
```

Add exact denial/atomicity cases: stale Owner version inserts neither participant nor update change; targeting the Owner returns `GROUND_OWNER_IMMUTABLE`; recovery leaves one Active Owner and the prior Owner Revoked; the old token returns `GROUND_UNAVAILABLE`; and a deliberately invalid Activity payload rolls back the Role row.

Use 32 random bytes for recovery tokens and SHA-256 for stored hashes. Do not compare or log raw tokens.

- [ ] **Step 2: Run RED**

Run: `npm run test:supabase -- --test-name-pattern="Owner|recovery|Role and Activity"`

Expected: FAIL because governance functions do not exist.

- [ ] **Step 3: Implement atomic Role operations**

The SQL functions are service-only and must:

```text
lock caller participant -> require Active owner + expected version
lock target participant -> reject target owner
assign: Active + supplied role_id
revoke: Revoked + null role_id
increment target role_version
append supplied access_management Yjs update at next sequence
advance document last_mutation_at
return updated participant + sequence
```

Role IDs are non-empty strings; the later application service validates membership in the loaded manifest before calling SQL.

- [ ] **Step 4: Implement one-use recovery**

`ground_recover_owner` locks the document, compares the SHA-256 token hash, rejects a mismatch, revokes a different old Owner, upserts the verified current actor as Active Owner, increments affected versions, stores only the next hash, appends one `owner_recovery` Yjs update, and returns the sequence. The function never returns a token.

- [ ] **Step 5: Broadcast personal access changes**

An AFTER UPDATE trigger calls `realtime.send` on `ground-access:<userId>` with only:

```json
{"documentId":"<id>","accessState":"revoked","roleId":null,"roleVersion":3}
```

No document text, recovery material, or other participants are included.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run test:supabase -- --test-name-pattern="Owner|recovery|Role and Activity"
npm run test:supabase
```

Expected: PASS.

```bash
git add supabase/migrations/20260903030000_ground_governance.sql tests/supabase/ground-governance.test.js
git commit -m "feat: persist Ground access recovery"
```

### Task 6: Add safe snapshots and bounded updates

**Files:**
- Modify: `src/domain/ground-hosted-contract.js`
- Modify: `tests/node/ground-hosted-contract.test.js`
- Create: `supabase/migrations/20260903040000_ground_maintenance.sql`
- Create: `tests/supabase/ground-maintenance.test.js`
- Create: `scripts/measure-ground-hosted-limits.mjs`

**Interfaces:**
- Produces: `GROUND_LIMIT_CANDIDATES`, `measureGroundLimits(results)`, and committed limits consumed by the hosted runtime.
- Produces SQL: `ground_compact_document(p_document_id text, p_candidate_sequence bigint, p_snapshot bytea)`.

- [ ] **Step 1: Write a failing deterministic limit-selection test**

```js
test('selects the largest candidate meeting every release target', () => {
  const result = measureGroundLimits([
    { bytes: 64_000, p95HydrateMs: 300, passed: true },
    { bytes: 200_000, p95HydrateMs: 900, passed: true },
    { bytes: 500_000, p95HydrateMs: 2400, passed: false },
  ]);
  assert.equal(result.maxDocumentBytes, 200_000);
});
```

Use candidates `64_000`, `200_000`, `500_000`, and `1_000_000` bytes. A candidate passes only when ten create/hydrate/reconnect runs all succeed, p95 hydrate is at most 2,000 ms, and the largest HTTP body remains below 1,125,000 bytes (25% of Vercel's 4.5 MB limit).

- [ ] **Step 2: Implement the measurement contract and runner**

The runner prints JSON containing every raw duration, p95, request byte count, and the selected values. It selects:

```text
maxDocumentBytes = largest passing candidate
maxUpdateBytes = min(256_000, maxDocumentBytes)
compactionUpdateCount = first count in [50, 100, 200] whose replay p95 stays <= 2,000 ms
```

It exits non-zero when no candidate passes. Keep generated measurement output ignored; the final selected constants and summarized evidence are committed in Plan 3.

- [ ] **Step 3: Write failing compaction and oversize tests**

Cover:

```js
test('rejects an update above the injected byte limit without allocating a sequence', async () => {
  const scenario = await createActiveEditorScenario();
  const before = await readDocumentHead(scenario.documentId);
  await assert.rejects(
    commitRawUpdate(scenario, Buffer.alloc(TEST_MAX_UPDATE_BYTES + 1)),
    { code: 'GROUND_UPDATE_TOO_LARGE' },
  );
  assert.deepEqual(await readDocumentHead(scenario.documentId), before);
});
```

Add three compaction cases: rows through candidate 2 are deleted while row 3 remains; a candidate above `head_sequence` changes neither snapshot nor log; and a row committed while the compactor waits remains because deletion is bounded by the captured candidate.

- [ ] **Step 4: Implement atomic compaction**

`ground_compact_document` obtains `pg_advisory_xact_lock(hashtextextended(document_id, 0))`, rejects a candidate beyond `head_sequence`, updates snapshot plus `snapshot_sequence`, and deletes only rows with `sequence <= candidate_sequence` in one transaction. It never changes `last_mutation_at`.

Update-commit functions reject an encoded payload over the injected production limit before allocating a sequence.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --test tests/node/ground-hosted-contract.test.js
npm run test:supabase -- --test-name-pattern="limit|compact"
npm run test:supabase
```

Expected: PASS.

```bash
git add src/domain/ground-hosted-contract.js tests/node/ground-hosted-contract.test.js supabase/migrations/20260903040000_ground_maintenance.sql tests/supabase/ground-maintenance.test.js scripts/measure-ground-hosted-limits.mjs
git commit -m "feat: bound Ground document history"
```

### Task 7: Add invisible rate windows and thirty-day deletion

**Files:**
- Modify: `supabase/migrations/20260903040000_ground_maintenance.sql`
- Modify: `tests/supabase/ground-maintenance.test.js`

**Interfaces:**
- Produces SQL: `ground_take_rate_limit(p_scope text, p_key_hash bytea, p_limit integer, p_window_seconds integer, p_now timestamptz)` and `ground_delete_expired_documents(p_cutoff timestamptz)`.
- Produces Cron job: `ground-delete-inactive-documents`, once daily.

- [ ] **Step 1: Write failing maintenance tests**

```js
test('increments one fixed window atomically and denies only after its limit', async () => {
  const results = await Promise.all([1, 2, 3].map(() => takeRateLimit({
    keyHash: TEST_KEY_HASH,
    limit: 2,
    now: TEST_NOW,
    scope: 'mutation',
    windowSeconds: 60,
  })));
  assert.equal(results.filter(Boolean).length, 2);
  assert.equal(results.filter((value) => !value).length, 1);
});
```

Add five exact cases: different scope/hash combinations each start at count one; accepted edit advances `last_mutation_at`; select/presence/denial/Pending join preserve it; a timestamp older than 30 days removes the document and every child row; and a concurrent accepted mutation under the same document lock prevents cleanup deletion.

Use an injected clock; never wait 30 days in a test.

- [ ] **Step 2: Run RED**

Run: `npm run test:supabase -- --test-name-pattern="rate|retention|thirty"`

Expected: FAIL.

- [ ] **Step 3: Implement the private rate table and functions**

```sql
create table private.ground_rate_limits (
  scope text not null check (scope in ('create', 'join', 'mutation')),
  key_hash bytea not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (scope, key_hash, window_started_at)
);
```

`ground_take_rate_limit` uses INSERT ... ON CONFLICT ... DO UPDATE and returns `false` without a product mutation when the resulting count exceeds the supplied positive limit. It is service-only.

- [ ] **Step 4: Implement deletion and Cron**

`ground_delete_expired_documents(now() - interval '30 days')` locks candidate document rows, rechecks the timestamp, deletes them with cascades, and removes expired rate windows. Schedule the function once daily with Supabase Cron. Reads, Realtime, presence, Pending join, compaction, and denied requests never write `last_mutation_at`.

- [ ] **Step 5: Run the complete foundation gate**

Run:

```bash
npm run test:supabase
npm run check
npm run build
npm run test:e2e:governance:prebuilt
git diff --check
```

Expected: PASS. Inspect `git status --short`; generated Supabase containers, `.temp`, logs, and evidence must remain untracked.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260903040000_ground_maintenance.sql tests/supabase/ground-maintenance.test.js
git commit -m "feat: expire inactive Ground documents"
```
