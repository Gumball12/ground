# Ground Hosted MVP Design

**Date:** 2026-09-03

**Status:** Approved by the user on 2026-09-03; ready for implementation

**Product:** Ground - One document, Different roles

> Ground is a shared Markdown editor for people and agents. The owner decides
> who can edit, who can only propose, and who gets no access. The server applies
> those rules to every WebMCP action.

## 1. Outcome

Ship the existing focused governed collaboration experience as a publicly
reachable Challenge MVP. A visitor can create one durable document, share its
secret URL, assign document Roles, collaborate through the UI or WebMCP, reload
or reconnect without losing state, and demonstrate that server-side
authorization still applies after a Role change or revocation.

The experiment is not "can another collaborative editor be built?" CollabMD
already supplies the editor and Yjs collaboration foundation. Ground tests a
narrower product claim:

1. Can one document safely host people and AI agents with different Roles?
2. Can the same Role policy govern human UI actions and WebMCP actions?
3. Can Reviewer proposals, overlapping Conflicts, Owner decisions, and Activity
   make agent participation understandable without adding chat or comments?

The MVP succeeds when this claim is visible in the product, enforced at the
server boundary, verified against two isolated documents, and demonstrated on
the deployed URL from an actual ChatGPT WebMCP session.

## 2. Evidence and Current Boundary

### 2.1 Existing verified product

The current repository already implements and tests the focused local product:

- Owner, Editor, and Reviewer Roles;
- Pending, Active, and Revoked access states;
- Role-aware WebMCP read, apply, and propose operations;
- Yjs text collaboration;
- Proposal creation and resolution;
- deterministic grouping of multiple same-location Conflicts;
- source-labelled Activity;
- focused Owner, Editor, Reviewer, Pending, and Revoked interfaces;
- browser tests for local editing, paste, Undo, Redo, Role transitions, and
  removed product surfaces;
- six Playwright governance flows with five required PNG checkpoints and
  meaningful per-participant WebM videos.

That baseline uses a local Node server, filesystem-backed content, process-local
governance sessions, and stateful WebSocket rooms. It does not prove the hosted
architecture in this document.

### 2.2 Throwaway Supabase feasibility spike

A disposable local Supabase spike at
`/private/tmp/ground-supabase-spike.1fS3EM` verified these infrastructure
primitives against Supabase CLI 2.116.0, `@supabase/supabase-js` 2.99.0, and
Yjs 13.6.29:

- invisible anonymous sessions with stable `auth.uid()` values;
- 22-character document IDs;
- exactly one Owner under concurrent creation attempts;
- later visitors joining as Pending;
- Owner assignment of Editor and Reviewer;
- Pending update reads denied;
- Editor update append allowed and Reviewer append denied;
- private document isolation through RLS;
- revoked cached-session writes denied;
- Realtime notification;
- concurrent Owner and Editor Yjs updates converging;
- reconstruction from a persisted update log in a new client.

The three spike tests passed ten consecutive runs, for 30/30 passing executions.
The spike is evidence, not production code, and must not be copied blindly. It
does not verify hosted Supabase, Vercel, the real browser editor, large updates,
snapshots, Owner recovery, Proposal/Conflict/Activity persistence, expiry, or a
live ChatGPT session.

### 2.3 Confirmed platform constraints

- Vercel currently supports Node.js 24.x, 22.x, and 20.x; 24.x is the default.
- The repository metadata and release workflows currently require Node.js 26.
- The current local shell is Node.js 24.19.0, but a fresh full Node 24
  verification has not yet been completed.
- A Vercel Function request or response is limited to 4.5 MB.
- Supabase Free Realtime currently allows 200 concurrent connections, 100
  messages per second, and 256 KB Broadcast payloads.
- Ground sends only a small document sequence notice through Realtime. Realtime
  is not the document store and does not carry the Yjs update payload.

These are release constraints. The design does not claim hosted success until
the hosted acceptance tests in Section 14 pass.

## 3. Scope

### 3.1 Included

- A branded landing page at `/`.
- Anonymous creation of a seeded demo document.
- One durable document per canonical `/:docId` URL.
- A prominent `Share document` action that copies only the canonical URL.
- Name-only participant onboarding with no visible login.
- Exactly one durable Owner per document.
- Owner, Editor, Reviewer, Pending, and Revoked behavior.
- A separate Owner recovery link.
- Durable Markdown, Roles, Proposal, Conflict, and Activity state.
- Document-specific RLS and private Realtime channels.
- Reconnect, deployment-restart, and browser-reload recovery.
- Safe rejection of unauthorized or oversized edits.
- Thirty-day inactivity deletion.
- Vercel deployment backed by Supabase.
- Ground-focused unit, integration, browser, E2E, evidence, and deployed smoke
  verification.
- Public GitHub and Challenge submission preparation.

### 3.2 Excluded

- Email, OAuth, passwords, or a user account dashboard.
- A document list, search, folders, groups, organizations, or team workspaces.
- Human/AI identity selection or a Human/AI badge.
- Participant recovery links other than the Owner recovery link.
- Invitations to email addresses or individually scoped share links.
- Comments, chat, formatting controls, search, split view, preview mode, export,
  diagrams, images, and the generic CollabMD sidebar.
- Offline editing, offline queues, background retries, or later replay of
  rejected edits.
- Multiple document tabs inside one Ground page.
- An immutable or tamper-proof audit log.
- A separate SDK, package, generic persistence framework, or backend selector
  UI.
- Multi-region guarantees or scale beyond the Challenge MVP target of tens of
  concurrent users.

## 4. Relationship to CollabMD

Ground reuses CollabMD rather than replacing it.

| Responsibility | Existing CollabMD | Ground addition |
| --- | --- | --- |
| Markdown editing | CodeMirror/Yjs editor behavior | Focused single-document shell |
| Collaboration semantics | Yjs merge, Undo/Redo, proposal anchors | Durable hosted transport and recovery |
| Governance rules | Role manifest, capability checks, proposal/conflict rules | Persistent participants and execution-time hosted authorization |
| Local operation | Node, filesystem, WebSocket room | Remains supported and unchanged unless integration requires a focused adapter seam |
| Public operation | Existing hosted OIDC/SQLite work is a separate product path | Secret document URLs, Supabase anonymous auth, Vercel API |
| Evidence | Existing focused browser and Playwright coverage | Hosted RLS, routing, reconnect, recovery, and live WebMCP evidence |

The existing hosted ADRs describe single-tenant CollabMD workspaces with Google
identity, GitHub vault setup, and per-workspace SQLite. They remain valid for
that CollabMD offering but do not govern Ground. Ground is a document-scoped,
anonymous, multi-document Challenge deployment backed by Supabase.

The current "filesystem is the source of truth" invariant continues to apply to
the local CollabMD adapter. For the Ground hosted runtime, the persisted Yjs
snapshot and update log in Supabase Postgres are the source of truth. Product and
architecture documentation must qualify the invariant by runtime when the
hosted adapter ships.

One small application-facing collaboration store contract is justified because
there will be two real implementations. The current filesystem/WebSocket path
and the Supabase path implement that contract and are selected only in bootstrap
configuration. There is no dual write, state migration between modes, or user
facing backend switch.

## 5. Identity, Access, and Roles

### 5.1 Anonymous identity

The browser silently creates or restores a Supabase anonymous session. Its
authenticated `auth.uid()` is the authorization identity. Display name is
presentation metadata entered by the participant and is never an authorization
input. The existing UI limit remains authoritative: trim surrounding
whitespace, reject an empty value, reject control characters, and accept at most
24 characters.

The same browser profile reuses its anonymous session across reloads and tabs.
Clearing site data, signing out, or changing devices creates a new identity.
Non-Owner participants then join as Pending and require a new Role assignment.
Ground adds no recovery flow for them.

Ground does not ask whether a participant is human or AI. The product shows the
participant's display name, Role, and Access state. Agent behavior is
demonstrated by Activity sources such as `WebMCP apply` and `WebMCP proposal`.
Demo display names may be `Writer Agent` or `Reviewer Agent`, but they have no
special authorization meaning.

New Ground Activity actor records omit `participantKind`. Existing local or
historical records that contain the legacy field remain readable, but Ground
does not write it or render it. This keeps the shared data reader backward
compatible without preserving an unused Ground concept.

### 5.2 Role matrix

`collabmd.governance.json` remains the Role and Capability source of truth.

| Role or state | Read | Suggest | Edit | Resolve Conflict | Manage Access |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | Yes | No | No |
| Reviewer | Yes | Yes | No | No | No |
| Pending | No | No | No | No | No |
| Revoked | No | No | No | No | No |

Role definitions are loaded and validated from `collabmd.governance.json` when
the server runtime initializes. The shipped MVP contains Owner, Editor, and
Reviewer. Operators may add another Role by composing the existing Capability
vocabulary in that file and redeploying; adding a new Capability still requires
domain code and tests. The Manage Access UI reads the manifest from the server
and never carries a second hard-coded Role map.

Role assignments have no duration. They remain until the Owner changes or
revokes them, the Owner recovery flow replaces the Owner identity, or the
document is deleted.

There is exactly one Owner row per document. Normal Manage Access operations
cannot assign, demote, or revoke the Owner.

## 6. Routes and Product Flow

### 6.1 Route contract

- `/` is the branded create-first landing page.
- `/:docId` is the only canonical document URL.
- `docId` is the unpadded base64url encoding of 16 cryptographically random
  bytes, producing a URL-safe 22-character string.
- `/api`, `/assets`, `/health`, and `/ws` are reserved and cannot be document
  IDs.
- Hash-based file routing such as `/#file=README.md` remains local CollabMD
  behavior and is not used by Ground.

### 6.2 Creation

1. The visitor chooses `Create demo document`.
2. The browser obtains an anonymous Supabase session without showing login UI.
3. The server atomically creates the document, the initial Yjs state, the
   recovery-token hash, and the sole Owner participant for that `auth.uid()`.
4. The document is seeded with the approved Launch plan demonstration content.
5. The creation response returns the raw recovery token once; subsequent reads
   never return it.
6. The app navigates to `/:docId` and displays the Owner shell.
7. A one-time recovery prompt asks the Owner to copy and store the recovery
   link before continuing. Losing it does not block use from the current Owner
   browser.

If the extremely unlikely generated ID already exists, the creator generates a
new ID and retries up to three times. A creation failure never opens an empty or
partially owned document.

### 6.3 Sharing and joining

`Share document` is a blue primary action at the upper right of the document
shell. It copies `https://<host>/:docId` only. It never copies the recovery
fragment.

A new anonymous visitor to the link:

1. enters a display name;
2. is atomically inserted as Pending;
3. sees only the Pending status page and its own identity state;
4. gains content access only after the Owner explicitly assigns Editor or
   Reviewer;
5. transitions to the active document after an authoritative access refresh.

### 6.4 Owner recovery

The recovery URL uses `/:docId#recover=<random-token>`, where the token is the
unpadded base64url encoding of 32 cryptographically random bytes. The raw token
is never stored in the database; only its SHA-256 hash is stored. The client
removes the fragment from the visible address immediately after reading it and
sends the token only to the recovery operation.

A successful recovery is one atomic operation:

- verify the token hash and document;
- upsert the current anonymous `auth.uid()` as Owner;
- set a different previous Owner to Revoked;
- rotate the recovery token so the used link cannot be reused;
- append a recovery Activity record;
- update the document's last durable mutation time.

Using recovery from the existing Owner session keeps that participant as Owner
while still rotating the token. The recovered Owner receives a replacement
recovery link. The token is not kept permanently visible in the UI. Ground does
not add a separate recovery-link management screen for the MVP.

## 7. User Interface

The approved Ground visual language uses the supplied icon, thumbnail direction,
white and light-gray surfaces, blue primary actions, dark readable foreground
text, and the existing focused governance layout. The product icon is
`src/client/app/ground-icon.svg`; the submission thumbnail source is
`docs/assets/ground-thumbnail.png`.

The active document shell contains only:

- Ground identity and document status;
- one Markdown editor;
- the Participant bar;
- Owner-only Review, Activity, Roles, and Manage Access surfaces;
- the prominent `Share document` action.

Active participants see only currently connected active collaborators in the
Participant bar, supplied by private Realtime presence. Pending and Revoked
participants never appear there. The Owner's Manage Access view separately
reads the durable participant list, including Pending and Revoked rows.

Pending and Revoked states are status-only. They retain no document content,
editor, governance rail, personal Undo history, or removed control in the DOM or
accessibility tree.

Manage Access is Owner-only. A participant Role is a draft selection until the
Owner chooses the explicit row action. While a row mutation is pending, that row
is disabled and the dialog remains stable. Inputs cannot appear editable while
the surrounding action is unavailable.

Activity remains a latest-first, unfiltered collaboration history. Each visible
record answers who, what, when, source, outcome, and target. It is not described
as an audit log.

The current thumbnail contains Human/AI labels that conflict with this approved
identity model. The submission thumbnail must be regenerated or edited so its
copy and badges match the shipped UI.

## 8. Hosted Architecture

```text
Browser
  - Ground UI and Y.Doc
  - anonymous Supabase session
  - private Realtime subscriptions
  - registered WebMCP tools
        |
        | semantic UI/WebMCP commands and authenticated update requests
        v
Vercel
  - static Vite application
  - stateless document, governance, review, recovery, and WebMCP APIs
  - bearer-session verification and invisible rate-limit keys
  - no durable memory and no authoritative WebSocket room
        |
        | operation-specific Postgres functions using the verified actor ID
        v
Supabase
  - Auth: anonymous identity
  - Postgres: documents, participants, snapshots, ordered updates, rate windows
  - RLS: document and participant isolation
  - Realtime: sequence/access notices and ephemeral awareness
  - Cron: thirty-day cleanup
```

Vercel may serve WebSocket-capable runtimes, but Ground does not depend on a
particular Vercel instance retaining a Y.Doc or connection. Any request may run
on a new instance. Supabase Postgres owns every durable fact.

Realtime announces that a sequence exists; it is not trusted as replay storage.
A missed notice is repaired by querying the ordered update log.

## 9. Persistent Model

The production migration owns three public product tables, one private
rate-limit table, and the collaboration state stored inside Yjs:
`ground_documents`, `ground_participants`, `ground_yjs_updates`, and
`private.ground_rate_limits`.

### 9.1 Document

- `id`: validated 22-character `docId`, primary key;
- `snapshot`: encoded full Yjs state;
- `snapshot_sequence`: highest update included in the snapshot;
- `last_mutation_at`: retention clock;
- `created_at`;
- `recovery_token_hash` and rotation metadata.

### 9.2 Participant

- `document_id`;
- `user_id`, referencing the Supabase Auth user;
- `display_name`;
- `access_state`: `pending`, `active`, or `revoked`;
- `role_id`: a manifest Role ID when active and `null` otherwise;
- `role_version`: a monotonically increasing authorization revision;
- creation and Role-change timestamps.

The composite `(document_id, user_id)` is the primary key. A partial unique
index on `document_id` where `access_state = 'active'` and
`role_id = 'owner'` permits only one Owner per document. A check constraint
requires `role_id` exactly when `access_state = 'active'`; Pending and Revoked
rows carry no Role.

### 9.3 Ordered Yjs update

- document-scoped monotonically increasing sequence;
- encoded Yjs update payload stored as binary `bytea`;
- authenticated actor ID;
- declared operation kind and Activity source;
- creation time.

`(document_id, sequence)` is unique and indexed. The actor is derived from the
authenticated request and never accepted from the request body.

### 9.4 Private rate-limit window

- operation scope: create, join, or mutation;
- server-generated keyed hash;
- fixed window start and count;
- composite primary key over scope, key hash, and window.

The table has no browser grants. An atomic server operation increments and
checks the window before the product mutation. Expired windows are removed by
the same daily maintenance job as expired documents.

### 9.5 One Y.Doc collaboration state

Markdown, Proposal records, Conflict state, and Activity remain in the same
Y.Doc. This preserves the existing RelativePosition anchors and atomic
Proposal/Conflict decisions. Ground does not add separate proposal, conflict,
or activity tables for the MVP.

Role rows remain relational because authorization must be checked without
decoding arbitrary Yjs state. A Role mutation and its Yjs Activity update are
committed through one database operation so they cannot disagree after a
partial failure.

Visible Activity is collaboration history produced by the supported UI and
WebMCP flows, not tamper-resistant evidence against a malicious raw Yjs client.
The existing threat boundary remains explicit.

## 10. Authorization and Mutation Flow

### 10.1 Shared rule

Every supported command follows one rule:

```text
Supabase bearer session
  -> Vercel verifies the session and derives auth.uid()
  -> check the private rate-limit window
  -> resolve document participant for the verified user ID
  -> resolve current Access state and Role
  -> check operation-specific Capability
  -> execute and persist, or return a structured denial
```

Client visibility is UX only. The server or Postgres function repeats the check
at execution time. Caller-supplied actor ID, Role, kind, and display name are
ignored for authorization. Browser roles receive read grants required for
hydration and Realtime, but no direct execute or insert grant for product
mutations. Vercel calls narrowly scoped functions with server credentials and
the user ID derived from the verified bearer session; each function still
resolves that user's current participant row before changing state. The API
checks the current `role_id` against the validated manifest; the commit function
locks the participant row and requires the same `role_version`, preventing a
Role change between authorization and persistence.

### 10.2 Operation-specific boundaries

- content update requires `document.edit`;
- Proposal creation requires `document.suggest`;
- Conflict resolution requires `conflict.resolve`;
- Role assignment and revocation require `grant.manage`;
- document read requires `document.read`;
- Owner recovery follows the separate one-use token rule.

The API does not expose one generic "append anything" operation to WebMCP.
WebMCP read, apply, and propose route through their semantic operations. A tool
discovered before a Role change is denied if the current Role no longer permits
execution.

The supported security boundary covers the shipped UI and WebMCP APIs. Ground
does not claim semantic validation of arbitrary Yjs binary updates from a
malicious custom client.

### 10.3 Source attribution

The supported internal source vocabulary remains fixed:
`document_editor`, `webmcp_apply`, `webmcp_proposal`, `owner_decision`,
`access_management`, and `system_reconciliation`. The UI renders stable readable
labels such as `Document editor`, `WebMCP apply`, and `WebMCP proposal`. The
authenticated actor, Role at execution, server time, operation, outcome, and
target are recorded once per semantic action.

## 11. Synchronization and Data Safety

### 11.1 Initial hydration

The client must not fetch and then subscribe, because a committed update could
land in the gap. It performs this sequence:

1. subscribe to private document sequence and personal access channels;
2. wait for the subscribed acknowledgement;
3. buffer notices without applying them;
4. fetch the latest snapshot and every update after its sequence;
5. apply the snapshot and ordered updates to a fresh Y.Doc;
6. apply buffered notices by fetching their missing sequences;
7. perform a final gap query;
8. enable the editor only when the client is caught up and still authorized.

This ordering incorporates the concrete subscription race found in the local
Supabase spike.

### 11.2 Live updates and reconnect

An accepted mutation commits the ordered Yjs update before Realtime announces
its sequence. Receivers fetch and apply missing sequences in order. Duplicate
notices and duplicate fetch results are ignored by sequence. A reconnect repeats
the hydration protocol rather than trusting Broadcast replay.

Awareness, cursors, and presence are ephemeral Realtime data. They do not enter
the update log and do not extend retention.

The same participant may edit from multiple tabs. The tabs share the anonymous
identity, and Yjs merges their changes. Ground adds no special cross-tab lock or
secondary-tab mode. The Participant bar coalesces tabs by authenticated user ID
and shows the participant online while at least one tab is present.

### 11.3 Rejection and rollback

If the server rejects an optimistic local update because access changed, the
session expired, the document was deleted, the update is too large, or the
request cannot be confirmed:

- immediately freeze editing;
- discard only state that was never accepted by the server;
- create a fresh Y.Doc from the authoritative snapshot and updates;
- clear local Undo/Redo history for the rejected capability transition;
- render the authoritative Access state;
- show a concise message such as `Changes were not saved because access changed.`

Ground never leaves unaccepted text looking saved, never partially stores an
oversized paste, and never queues rejected changes for later replay.

### 11.4 Undo, Redo, paste, and other editor actions

Typing, IME, delete, cut, plain-text paste, Undo, Redo, and every other supported
content mutation use the same `document.edit` gate. Undo and Redo are content
edits; they do not undo Proposal approval, Proposal rejection, Conflict
resolution, Role changes, or Activity records.

The existing editor-level tests remain responsible for CodeMirror/Yjs action
semantics. Hosted E2E tests verify only the new persistence and authorization
boundary, avoiding duplicate framework tests.

## 12. Snapshots, Limits, and Retention

### 12.1 Atomic compaction

Snapshots shorten replay but never replace correctness. Compaction:

1. reads a snapshot and updates through a candidate sequence;
2. constructs the candidate full Yjs snapshot;
3. acquires a document-scoped database lock;
4. confirms the candidate sequence is still valid;
5. writes the new snapshot and snapshot sequence;
6. deletes only log rows included through that sequence;
7. commits all changes atomically.

A failure leaves the previous snapshot and log usable. Concurrent compaction for
one document serializes; different documents remain independent.

The production trigger threshold is not guessed in this design. The first
implementation task measures hosted load, reconnect, single-update, and replay
behavior against Vercel and Supabase. It then commits one concrete maximum
document size, one maximum accepted update size, and one compaction threshold
before feature implementation proceeds. Production deployment is blocked until
those values and their evidence are recorded in the repository.

### 12.2 Oversized edits

The API calculates encoded request and resulting document size before commit.
An edit, including a paste, that crosses either committed limit is rejected as
one operation. No prefix, chunk, Proposal, or Activity success record is stored.
The client follows the authoritative rollback path in Section 11.3.

### 12.3 Rate limiting

Ground rate-limits document creation, joins, and mutations in
`private.ground_rate_limits`. A keyed HMAC-SHA-256 of anonymous `auth.uid()` is
the normal key; creation also checks a keyed hash of the normalized request
network identifier so repeatedly creating anonymous users cannot bypass the
boundary. Only Vercel computes these keys, and raw network identifiers are not
stored.

The hosted capacity task commits concrete fixed-window thresholds before launch,
based on the selected Supabase plan and a measured evidence run. A limited
request returns `429` and does not mutate document state. Ground does not show a
CAPTCHA during normal use. CAPTCHA is a post-MVP response only if measured abuse
shows that invisible limits are insufficient.

### 12.4 Thirty-day deletion

`last_mutation_at` advances only after an accepted durable change:

- document content edit, including Undo or Redo;
- Role assignment, change, revocation, or Owner recovery;
- Proposal creation, approval, rejection, or Conflict resolution.

Reads, page opens, awareness, presence, denied actions, and Pending joins do not
extend the deadline. Supabase Cron runs a database cleanup function daily. It
locks each eligible document, confirms the timestamp is still older than 30
days, and cascade-deletes the document and all associated participants,
snapshots, updates, proposals, conflicts, activity, and recovery material.

After deletion, both the canonical and recovery URLs show the same generic
`Document unavailable` state. Deletion has no grace period and cannot be undone.

## 13. Security and Privacy

- Every public table enables RLS before grants are added.
- Policies explicitly require an authenticated `auth.uid()` and document-scoped
  membership.
- Security-definer helpers use a fixed empty `search_path`, least-privilege
  grants, and operation-specific validation.
- Pending and Revoked participants may read only the minimum fields needed to
  render their own Access state. They cannot read document updates, snapshots,
  other participants, proposals, conflicts, or activity.
- Only the Owner can list all participants and mutate Roles.
- Private Realtime document topics use document membership policies. A separate
  personal access topic can notify a participant of downgrade or revocation
  without exposing document content.
- The browser receives only the Supabase project URL and publishable key. The
  Supabase server credential used by Vercel is environment-scoped and is never
  bundled, logged, or accepted from the browser. Public browser roles cannot
  invoke the server mutation functions directly.
- Application logs do not intentionally emit document content, raw recovery
  tokens, anonymous JWTs, or raw network identifiers. The canonical `docId`
  necessarily appears in the browser history and may appear in Vercel's managed
  request metadata because it is the request path; access to those platform logs
  is restricted to project operators.
- Responses set `Referrer-Policy: no-referrer`; document pages set
  `robots: noindex, nofollow`; product pages load no third-party assets that
  could receive the secret path.
- Content Security Policy allows application assets from self and network
  connections only to the configured Supabase origin and the same-origin API.
- Mutating same-origin APIs require JSON, validate the request Origin, and accept
  the Supabase bearer session rather than ambient authorization cookies.
- Missing, unauthorized, expired, and deleted document requests use the same
  public `Document unavailable` treatment so the UI does not expose why a
  secret URL failed.
- Input boundaries validate `docId`, display-name length and characters,
  operation kind, Role, Yjs payload encoding, update size, and expected document
  sequence.
- Public errors contain stable codes and safe copy, not SQL, filesystem paths,
  stack traces, credentials, or policy details.

## 14. Deployment

### 14.1 Environment model

- Local CollabMD keeps its filesystem/WebSocket runtime and tests.
- Ground development uses the local Supabase stack.
- Ground production uses one Vercel project and one hosted Supabase project in a
  single selected region.
- Vercel Preview deployments do not receive production Supabase credentials.
  Without an explicitly configured non-production Supabase project, Preview
  renders a safe unavailable/configuration page rather than touching production
  data.
- Secrets live in environment-scoped platform configuration and never in git.

### 14.2 Node compatibility gate

Before changing runtime metadata, run the full non-E2E suite and focused Ground
E2E suite under Node 24. If they pass, align `package.json`, `.tool-versions`, CI,
and Vercel to Node 24. If they fail, diagnose the exact Node 26 dependency before
editing runtime claims. Do not publish a split runtime package or abandon
Vercel without a new design decision.

### 14.3 Release order

1. Apply and verify Supabase migrations.
2. Verify RLS through authenticated Owner, Editor, Reviewer, Pending, Revoked,
   and unrelated-document clients.
3. Configure Production-only Vercel environment variables.
4. Build and deploy the application from the public GitHub repository to
   Production.
5. Run hosted Playwright smoke tests against that immutable deployment URL and
   roll back the Production alias if they fail.
6. Run the live ChatGPT WebMCP acceptance flow.

A failed migration, RLS test, Node gate, hosted E2E, or WebMCP flow blocks the
submission-ready claim.

## 15. Verification Strategy

Implementation follows TDD at the changed boundary: write the focused failing
test, implement the smallest behavior, refactor only when duplication has become
real, and run broader checks before completion.

### 15.1 Keep existing coverage

Retain the current unit, integration, browser, visual, and Playwright coverage
for local CollabMD and focused governance behavior. Do not rewrite passing
CodeMirror, Yjs, Undo/Redo, paste, Role UI, or Conflict tests merely because the
transport changes.

### 15.2 Add Supabase integration coverage

Use the real local Supabase stack, not mocked RLS, for:

- exactly-one-Owner concurrent creation;
- cross-document read and write denial;
- own-row versus Owner participant visibility;
- manifest-defined Role-specific read, edit, suggest, resolve, and manage
  operations;
- safe rejection when `role_version` changes between authorization and commit;
- cached-session denial after revoke;
- recovery transfer, token rotation, and old-Owner denial;
- monotonic sequence insertion and reconnect reconstruction;
- atomic Role-plus-Activity mutation;
- snapshot compaction and safe log pruning;
- oversized update all-or-nothing rejection;
- retention clock rules and cascade cleanup.

### 15.3 Add focused browser coverage

- `/` and `/:docId` routing;
- display-name-only onboarding;
- recovery fragment removal;
- subscribe-buffer-hydrate-gap-check ordering;
- editor disabled before readiness;
- optimistic rejection freeze and authoritative rehydrate;
- same-browser multi-tab identity behavior;
- Pending and Revoked content removal;
- Manage Access pending interactions;
- keyboard focus, semantic labels, light/dark contrast, and 360 px reflow;
- absence of comments, chat, formatting, search, split/preview, and Human/AI
  controls from DOM, bootstrap, focus order, and accessibility tree.

### 15.4 Add Ground Playwright flows

Extend the existing Evidence mechanism rather than adding another recorder:

1. create, save recovery link, reload, and recover in a new browser context;
2. Share, join as Pending, and assign Editor and Reviewer;
3. concurrent human and WebMCP direct edits converge;
4. Reviewer proposals create multiple Conflicts and the Owner resolves them;
5. Activity shows actor, action, time, source, outcome, and target;
6. revoke during a cached or optimistic edit, then verify denial and rollback;
7. reconnect from persisted snapshot/update state.

The ordinary regression configuration retains artifacts only on failure. The
curated Evidence run attaches explicit success screenshots and meaningful
per-participant WebM video, validates their existence, and writes only to ignored
artifact paths. Raw E2E videos are evidence, not the final narrated Challenge
video.

### 15.5 Deployed acceptance

Against hosted Supabase and the actual Vercel URL:

- create two documents from different anonymous sessions;
- prove neither session can query or mutate the other document;
- complete the full Role and collaboration flow;
- reload after a deployment and reconstruct identical Markdown, Proposal,
  Conflict, Activity, and Role state;
- verify oversized, revoked, and expired behavior;
- run actual ChatGPT WebMCP read, apply, and propose actions under different
  Roles and confirm their Activity sources.

## 16. Submission-Ready Definition of Done

Ground is complete only when all statements below are evidenced:

- Node 24 lint, build, guardrail, unit, integration, browser, and focused E2E
  checks pass from a clean install.
- Local and hosted Supabase migration/RLS tests pass.
- The public Vercel production URL implements `/` and `/:docId` with no
  filesystem or in-memory durability dependency.
- Two unrelated documents are isolated under real anonymous sessions.
- Refresh, reconnect, deployment, Owner recovery, Role change, and revocation
  preserve or safely clear exactly the intended state.
- Every WebMCP action is reauthorized at execution and visibly attributed by
  source.
- The focused UI contains no removed CollabMD surfaces or Human/AI selector.
- The supplied icon, thumbnail, page metadata, README, and product copy all use
  `Ground - One document, Different roles` consistently.
- The thumbnail is updated to remove Human/AI labels that are absent from the
  product.
- README and `.env.example` document local startup, local Supabase setup,
  migration, Vercel deployment, environment separation, and evidence commands.
- `AGENTS.md`, `CONTEXT.md`, architecture documentation, and relevant ADRs state
  the local-versus-Ground source-of-truth boundary without contradiction.
- The public GitHub repository preserves the CollabMD MIT license and upstream
  attribution while describing Ground as the Challenge project.
- Evidence output paths are given to the user.
- The ignored demo-recording handoff is updated for the later joint recording
  session.
- A final narrated demo video, live URL, repository URL, thumbnail, elevator
  pitch, and submission fields are ready.
- The final report separates automated verification from manual live ChatGPT and
  submission checks; no unexecuted check is reported as passing.

## 17. Rejected Approaches

### Vercel-only in-memory WebSocket rooms

Rejected because durable correctness would depend on a particular disposable
runtime instance and reconnect path. Ground keeps Vercel stateless.

### A separate long-lived collaboration server

Technically viable but adds another deployment and operational boundary before
the Challenge validates the product claim. Reconsider only if the measured
Supabase update-log design fails its release gates.

### `y-supabase` unchanged

The provider is useful prior art but its current public-channel/full-state-row
shape does not implement Ground's Role enforcement, private document isolation,
operation attribution, recovery, or ordered durable log. Ground uses the
underlying Yjs and Supabase primitives directly.

### Full login and group hierarchy

Rejected because login is not the demonstration. Secret document URLs,
anonymous identities, Pending-by-default access, and Owner assignment show the
governance claim with less UI and data model.

### Separate Proposal, Conflict, and Activity tables

Rejected for this MVP because it would duplicate the current Y.Doc model and
make relative anchors and atomic decisions harder. Consider a separate durable
audit store only if Ground later promises tamper resistance or analytics.

### Automatic chunking and offline replay

Rejected because partial persistence, reauthorization between chunks, and
replay after revocation create failure states that do not serve the Challenge
demo. Oversized or unconfirmed mutations fail closed and rehydrate.

## 18. Sources

- Vercel Node.js versions:
  https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Vercel Function limits:
  https://vercel.com/docs/functions/limitations
- Vercel environment scopes:
  https://vercel.com/docs/environment-variables
- Supabase anonymous sign-ins:
  https://supabase.com/docs/guides/auth/auth-anonymous
- Supabase Row Level Security:
  https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Realtime authorization:
  https://supabase.com/docs/guides/realtime/authorization
- Supabase Realtime limits:
  https://supabase.com/docs/guides/realtime/limits
- Supabase Cron:
  https://supabase.com/docs/guides/cron
