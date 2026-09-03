# Focused Governed Workspace Redesign

**Date:** 2026-09-01

**Status:** Approved

**Target:** OpenAI WebMCP Challenge MVP

**Base design:** `2026-08-30-webmcp-governed-collaboration-design.md`

## 1. Decision Summary

The governed collaboration demo becomes a focused single-document product
surface rather than the full CollabMD shell with governance added beside it.

The redesign makes these product decisions:

- Role assignments last until the Owner changes or revokes them, or the server
  restarts. The MVP has no time-based Grant expiry.
- The product exposes one Markdown editor, one Participant bar, and the Owner's
  `Review`, `Activity`, `Roles`, and `Manage access` surfaces.
- Comments, formatting controls, split/preview modes, chat, global search,
  multi-document navigation, and duplicate presence controls are removed from
  the product surface and runtime wiring.
- Role selection never submits immediately. The Owner explicitly chooses
  `Assign role` or `Update role`.
- Pending and revoked Participants receive a status-only room-control view,
  not an empty or stale document shell.
- Public UI uses `Role` and `Access` vocabulary. Existing internal Grant API
  and event names may remain when renaming them provides no user benefit.

The core product contribution remains unchanged: Role-aware WebMCP discovery,
execution-time authorization, human/AI collaboration, Proposals, deterministic
Conflicts, and visible Owner decisions.

## 2. Relationship to the Base Design

This document is an amendment to the 2026-08-30 approved design. It supersedes
conflicting requirements in these base-design areas:

- Product Boundary
- System Model Sections 4.1, 4.3, 4.4, and 4.5: Participant states,
  Capability vocabulary, Role Manifest, and Runtime Grant fields
- User Action Taxonomy for governed UI controls
- Activity presentation
- User Interface
- Connection and Role transitions
- Error handling
- Verification

Unchanged base-design decisions remain authoritative, including:

- one room and one active Markdown document;
- first-session immutable Owner;
- page-session rather than account identity;
- server-authoritative Role checks;
- Yjs live document convergence;
- Proposal and Conflict models;
- execution-time WebMCP authorization;
- no Owner recovery, transfer, or multiple Owners;
- no adversarial raw-Yjs authorization claim;
- no immutable audit-log claim.

The base design continues to describe the currently implemented system until
this redesign is implemented and verified. README changes happen with the
implementation, not with this design checkpoint.

## 3. Problem Statement

The current governed shell exposes controls that are irrelevant or unavailable
to the current Participant. It also relies on the HTML `hidden` property while
component CSS supplies a conflicting `display` value. As a result, controls can
remain visible and clickable even when application state marks them hidden.

Observed failures include:

- governed sidebar and global Search remain visible;
- a pending Participant can open `Manage access` even though the server later
  rejects the command;
- Role selection submits immediately and has no explicit save boundary;
- the minute field must be edited before Role selection to affect the request;
- pending and revoked pages retain document-shaped controls;
- revoked pages can retain stale preview content;
- access transitions can claim local changes were discarded when no dirty
  local state existed;
- the visual baseline accepts the cluttered shell instead of detecting it.

The redesign aligns visible affordances with the server-authoritative access
model and reduces the demo to the product's differentiated workflow.

## 4. Product Boundary

### Included

- One governed Markdown document.
- Owner, Editor, and Reviewer Roles.
- Human or AI-labelled page sessions.
- Pending, active, and revoked access states.
- Room-lifetime Role assignment, Role change, and immediate revocation.
- Role-aware WebMCP read, apply, and propose tools.
- Execution-time authorization after Role change or revocation.
- Yjs text synchronization for active Participants.
- Proposal creation, persistence, resolution, and deterministic Conflict
  grouping.
- Participant bar.
- Owner-only `Review`, `Activity`, `Roles`, and `Manage access` surfaces.
- Status-only pending and revoked views.
- Plain-text editing, paste, keyboard Undo, and keyboard Redo under the shared
  `document.edit` gate.
- Desktop-first Challenge demo with functional narrow-screen reflow.

### Excluded from the Focused Product

- Time-based Role expiry and the `expired` Participant state.
- `Grant minutes` or any other duration input.
- Comment creation, reply, reaction, resolution, or comment overview UI.
- Markdown formatting toolbar and document-format command UI.
- Split, editor-only, and preview-only mode controls.
- Rendered preview pane and preview task mutation UI.
- Chat.
- The existing generic Share button; an access-aware Share experience remains
  Post-MVP.
- Original presence avatar/follow controls; the Participant bar replaces them.
- Sidebar, file tree, Create, global Search, quick switcher, History, Git,
  backlinks, outline, wrap controls, attachments, images, and diagram surfaces.
- Mobile-specific product design beyond functional, accessible reflow.

Excluded CollabMD features have their user-facing markup, bootstrap imports,
runtime wiring, styles, and product E2E coverage removed. Feature-owned source
files are deleted when repository-wide reference inspection proves they have no
remaining runtime or test consumer.

Shared primitives are retained only when a focused feature still consumes
them. Examples include CodeMirror/Yjs text synchronization, awareness needed by
Participant presence and cursors, and the minimal Yjs map/array primitives
currently used by Proposals. A file is not retained merely for hypothetical
future compatibility.

The visible file tree is removed, but active editors retain the current vault
document paths as a non-visual index for CodeMirror wiki-link completion and
resolution. The first deletion wave reuses the existing pure `FileTreeState`
projection fed by `WorkspaceSyncClient`; it does not construct a
`FileExplorerController` or render file-tree markup. Focused bootstrap keeps
the current `getFileList` and `getVaultFileList` semantics by deriving them
from `FileTreeState.flatFiles`, with the existing image-filter behavior applied
only to the editor-facing list. Pending and Revoked sessions never receive an
editor, so this index has no visible consumer in those states. Replacing this
transitional vault index with group/document-scoped routing is Post-MVP work.

The first implementation pass must not rename or rebuild shared Proposal/Yjs
storage solely to erase historical Comment naming. Such cleanup happens only
when it reduces reachable focused code without introducing a new migration or
subsystem.

The first deletion wave also retains `comment-ui-shared.js` and the three
Comment row/markdown styles directly imported by the still-built Excalidraw
entry. They are not wired into the focused HTML. Remove them only with the
deferred diagram-entry cleanup, after repository references reach zero.

## 5. Access Model

### 5.1 States

A Participant has one of three governed access states:

- `pending`: registered in the room-control view, without document access;
- `active`: assigned an Owner, Editor, or Reviewer Role;
- `revoked`: explicitly denied document access until the Owner assigns a Role
  again.

The redesign removes `expired` from the governed session model.

Pending and revoked Participants have no assigned `roleId`. Revocation clears
the active `roleId`; Activity retains the Role-at-action snapshot needed for
historical attribution. Reassignment therefore starts from an unselected Role,
not an implicitly remembered previous Role.

### 5.2 Role Lifetime

A Role assignment remains active until one of these events occurs:

- the Owner assigns a different Role;
- the Owner revokes access;
- the in-memory governed room is reset by server restart.

Page disconnection alone does not create a time-based expiry. Returning with a
valid page-session credential still requires the server to resolve the current
Role and revocation state.

### 5.3 Owner

- The first successful room Participant becomes Owner.
- Owner remains active for the in-memory room lifetime.
- Owner cannot be reassigned or revoked.
- Owner recovery and transfer remain excluded.
- Local demo recovery remains an operator restart plus deterministic document
  reseed.

### 5.4 Default Role Manifest

The governed MVP uses this public capability shape:

```json
{
  "roles": {
    "owner": [
      "document.read",
      "document.suggest",
      "document.edit",
      "conflict.resolve",
      "grant.manage"
    ],
    "editor": [
      "document.read",
      "document.suggest",
      "document.edit"
    ],
    "reviewer": [
      "document.read",
      "document.suggest"
    ]
  }
}
```

`defaultGrantMinutes` and `document.comment` are removed from the default
governed manifest. `grant.manage` may retain its internal identifier to avoid an
unrelated API migration; the UI calls this capability `Manage access`.

No backward-compatibility promise is required for unpublished custom governance
manifests. Invalid or removed fields must fail startup with a safe, specific
configuration error rather than being silently ignored.

## 6. Focused Governed Shell

### 6.1 Application Entry and Fail-Closed Resolution

The focused workspace is the only product shell. There is no classic/governed
mode switch, URL query, CLI flag, feature flag, or hidden test-only product
mode.

The active document route does not expose document content until governance
session restoration or creation returns a valid snapshot whose `documentPath`
exactly matches that route.

While governance session resolution is pending, the page shows a neutral
loading shell. Failure to resolve governance renders a safe retryable error and
never mounts a writable editor. Role affects the ready-state surface, not
whether the focused product shell is active.

### 6.2 Shared Chrome

Every governed page contains only:

- document title;
- compact connection state;
- Participant bar;
- the current access-state surface.

The Participant bar is the only governed presence surface. It shows:

- display name;
- Human or AI label;
- current Role when active;
- Pending, Active, or Revoked state;
- `You` treatment for the current page session.

Only an active Owner sees `Manage access`.

### 6.3 Owner Workspace

The Owner sees:

- the writable Markdown editor;
- all current Participants in the Participant bar;
- `Manage access`;
- the right rail with `Review`, `Activity`, and `Roles`.

The right rail has no duplicate preview or comment surface.

### 6.4 Editor Workspace

An active Editor sees:

- the Participant bar;
- the writable Markdown editor.

The Editor does not see `Manage access` or the Owner governance rail. Direct
typing, plain-text paste, Undo, Redo, and authorized WebMCP edit/propose tools
remain available.

### 6.5 Reviewer Workspace

An active Reviewer sees:

- the Participant bar;
- the read-only Markdown editor.

The Reviewer does not see `Manage access` or the Owner governance rail. The
page registers read and Proposal WebMCP tools but never the direct apply tool.

### 6.6 Pending Workspace

A pending Participant sees:

- the document title;
- connection state;
- the Participant bar with their Pending state;
- a centered `Waiting for access` message.

The message explains that the Owner must assign a Role and that the page updates
automatically. No document text, editor shell, preview shell, governance empty
state, document control, or WebMCP document tool is present.

### 6.7 Revoked Workspace

A revoked Participant sees:

- the document title;
- connection state;
- the Participant bar with their Revoked state;
- a centered `Access revoked` message.

The message explains that the document was cleared and the Owner may assign a
Role again. Revocation removes editor and preview content, comments, document
controls, personal Undo history, synchronized document bindings, and registered
WebMCP document tools before rendering the status view.

## 7. Manage Access

`Manage access` is an Owner-only modal. Hiding the button is not the authority;
the client command and server endpoint must recheck the current Owner session.

Each Participant row shows:

- display name;
- Human or AI label;
- current Role;
- current access state;
- native Role select;
- an explicit primary Role action.

Row actions are:

- Owner: locked, with no mutable control;
- Pending or Revoked: `Assign role`;
- Active non-Owner: `Update role` and a separate `Revoke access` action.

`Assign role` and `Update role` are the only actions that persist a Role-select
value. `Revoke access` is a separate destructive command and does not conflict
with the one-primary-Role-action rule.

Changing a select value is local form state only. It never sends a request.
`Assign role` or `Update role` sends exactly one request using the displayed
Role. There is no minute field and no hidden duration default.

While a row request is pending:

- its mutable controls are disabled;
- its action communicates progress;
- other rows remain readable;
- duplicate submission is prevented.

On success, the row renders the authoritative server snapshot and an inline
success state. On failure, the select rolls back to the authoritative active
Role, or to the unselected placeholder for Pending and Revoked rows, and the row
renders a safe inline error. The modal remains open in both cases.

Revocation uses a distinct destructive action. A confirmation names the
Participant and warns that unsynchronized local work may be discarded. Success
renders the authoritative Revoked state without closing the modal.

## 8. Owner Governance Rail

### 8.1 Review

Each Proposal card shows:

- Proposal or Conflict state;
- author display name, Human or AI label, and Role at creation;
- exact current and proposed text;
- location group when available;
- `Keep current` and `Apply` actions when valid.

Multiple same-location Conflicts remain grouped and individually selectable.
`Apply` requires the existing explicit document-replacement warning.
Unlocated Conflict continues to expose only `Keep current`.

### 8.2 Activity

Activity is a latest-first list without filters in the MVP. The expected event
set is:

- Participant joined;
- Role assigned or changed;
- access revoked;
- direct edit applied;
- Proposal created, accepted, rejected, or moved to Conflict;
- external document reconciliation by `system`.

Each Activity item answers these questions:

- **Who:** display name, Human or AI label, page-session identifier, and Role at
  action time;
- **What:** action label and target reference;
- **When:** event timestamp;
- **How:** one explicit source label;
- **Outcome:** applied, proposed, accepted, rejected, conflicted, changed, or
  revoked as applicable.

The fixed source vocabulary is:

- `Document editor` for supported local document edits, independent of the
  Participant's self-declared Human or AI label;
- `WebMCP apply` for structured AI document mutation;
- `WebMCP proposal` for Proposal creation;
- `Owner decision` for Proposal or Conflict resolution;
- `Access management` for Role assignment, change, or revocation;
- `System reconciliation` for external filesystem reconciliation.

Activity has one authoritative writer per event family:

- snapshot observation appends only `Participant joined`;
- the explicit Owner access command appends `Role assigned`, `Role changed`,
  and `Access revoked` after the server acknowledges the change;
- direct editor activity appends direct-edit bursts;
- WebMCP command handling appends apply or proposal entries;
- Proposal resolution appends Owner decisions.

Snapshot reconciliation must not append access-management events, or the same
Role change can appear twice to every participant.

Proposal and Conflict entries show their exact expected and proposed text in
the Review surface. Activity may link to that Proposal but does not duplicate a
full document diff. Direct typing is recorded as an edit burst rather than one
event per keystroke and does not store full changed text.

Denied and no-op commands do not create collaboration Activity. The caller
receives the structured denial directly. Recording every denied attempt,
including durable security evidence, requires a separate server-owned audit
log and remains outside this MVP.

Public labels use `Role assigned`, `Role changed`, and `Access revoked` even if
internal event identifiers retain the `grant_*` namespace.

There is one writer per access event. The Owner command that receives the
successful server response appends Role assignment, Role change, or revocation
Activity with source `Access management`. Snapshot reconciliation appends only
previously unseen `Participant joined` events; it never mirrors Role changes or
revocation, so one successful command cannot create duplicate Activity.

Activity remains synchronized collaboration history, not a tamper-proof audit
log.

### 8.3 Roles

Roles remains a read-only Role-by-Capability matrix. It displays only the
capabilities in the active governed manifest. `Comment` and expiry are absent.

## 9. Access Transitions

### Pending to Active

After an authoritative Role assignment snapshot arrives, the page:

1. removes the status-only view;
2. establishes a fresh document synchronization session;
3. configures writable or read-only editor mode from the Role;
4. registers the exact Role-aware WebMCP tools;
5. renders the active workspace.

### Active Role Change

The page rechecks capabilities before preserving any live editor session.

- Editor to Reviewer clears personal edit history and reconfigures read-only.
- Reviewer to Editor creates a fresh writable history boundary.
- Same-Role reassignment is idempotent and does not create duplicate Activity.

### Active to Revoked

Revocation performs one visible transition:

1. unregister document WebMCP tools;
2. freeze local mutation;
3. disconnect the synchronized document session;
4. clear editor, preview, comment, and cached document content;
5. clear personal Undo/Redo history;
6. render the Revoked status-only view.

The UI reports discarded unsynchronized changes only when an actual dirty local
state was discarded. A clean revocation never shows a data-loss warning.

### Revoked to Active

Reassignment always creates a fresh synchronized document and empty personal
history. Stale document state is never restored from the revoked page.

### Disconnection

Continued offline editing remains excluded. A disconnected active page freezes
local mutation. Reconnection with the same Role may restore the authoritative
document. A Role change or revocation during disconnection discards stale local
state before any editor becomes interactive.

## 10. Authorization and Visibility

The server remains authoritative for document, room, Role, revocation state,
and capability checks. Removing expiry does not weaken execution-time checks.

The application must also align affordances with authorization:

- unavailable actions and excluded product surfaces are absent rather than
  writable-looking or CSS-hidden;
- runtime bootstrap does not import or initialize removed product features;
- the Manage access modal cannot open for a non-Owner even if a styling defect
  exposes its trigger;
- failed authorization never leaves an optimistic Role value displayed as if
  it succeeded.

Cached WebMCP tools remain harmless because every execution rechecks the current
server Role and revocation state.

## 11. Error Handling

- Non-Owner access command: safe inline denial; no optimistic UI remains.
- Invalid server manifest: fail server startup with a safe, specific
  configuration error; no client workspace is served.
- Valid server manifest but failed client Roles fetch: Owner access controls
  stay unavailable and show a retryable loading error.
- Role assignment failure: row rolls back and remains open.
- Revocation failure: active state remains visible and no document is cleared.
- Document synchronization failure: active workspace shows a disconnected
  status and stays non-editable.
- Pending or revoked state: use explicit access copy, never empty Proposal or
  Activity copy.
- Clean Role change or revoke: no discarded-changes warning.
- Dirty Role change or revoke: one precise warning after authoritative access
  state is applied.

Public errors must not expose credentials, filesystem paths, internal endpoint
details, or server stack traces.

## 12. Accessibility and Responsive Behavior

- Native selects retain their platform keyboard and pointer behavior.
- Role changes require a separately focusable action button.
- Modal focus enters at the heading or first mutable row and returns to
  `Manage access` on close.
- Loading, success, and error states use text in addition to color.
- Status views use headings and concise explanatory text.
- Removed product surfaces cannot appear in the accessibility tree or receive
  focus.
- Desktop at 1280px and 1440px is the primary Challenge demo target.
- At narrow widths, Participant cards wrap, the Owner rail moves below the
  editor, and Manage access rows stack without horizontal page overflow.

## 13. Configuration and Migration

The redesign changes only the unpublished governed configuration contract.

- Remove `defaultGrantMinutes` from the packaged manifest and validator.
- Remove `document.comment` from the governed capability vocabulary and default
  Roles.
- Remove `expiresAt` from governed Participant snapshots.
- Remove `expiresInMinutes` from Role assignment commands.
- Keep unrelated authentication-session, invitation, cache, and hosted-workspace
  expiry fields unchanged.

Runtime Role assignments are in memory, so no durable data migration is
required. Restarting the demo server clears the old runtime state.

## 14. Verification

### Unit

- Manifest accepts the focused Role set without a duration field.
- Removed duration fields and the removed Comment capability fail with a
  specific startup error.
- Role assignment has no expiry transition.
- Owner remains immutable.
- Pending, active, and revoked states derive correctly.
- Same-Role assignment is idempotent.
- Activity public labels map correctly from internal events.
- Activity source values map to the fixed public source vocabulary.
- One successful access command creates exactly one assignment, change, or
  revocation Activity record.

### Integration

- Only Owner can assign, change, or revoke a Role.
- Pending and revoked Participants have no document synchronization or WebMCP
  document tools.
- Editor receives read, apply, and propose tools.
- Reviewer receives read and propose tools only.
- Cached apply is denied after downgrade or revocation.
- Role change during disconnection discards stale local state.
- Clean transition emits no discarded-changes warning signal.
- Dirty transition emits exactly one discarded-changes signal.

### Browser

- Sidebar, global Search, chat, comments, formatting, view controls, preview,
  the generic Share action, old presence, and outline markup is absent from the
  focused application DOM.
- Removed controls have no bootstrap listener, runtime initialization, or
  accessibility-tree entry.
- File-tree UI is absent, but wiki-link completion and resolution still work
  from the retained authorized document index.
- Pending and revoked pages render status-only views.
- Revocation clears previously rendered document content.
- Manage access cannot open for Pending, Editor, Reviewer, or Revoked sessions.
- Native Role select does not submit on change.
- `Assign role` and `Update role` submit once and keep the modal open.
- Failed assignment rolls back the select and renders inline error text.
- Owner row is immutable.
- Reviewer editor is read-only; Editor editor is writable.
- Governance session resolution failure never reveals a writable editor.
- Activity renders one latest-first list and exposes no Human, AI, or Access
  filter controls.
- Activity items visibly include actor, action, timestamp, source, outcome, and
  target without exposing a full direct-edit diff.

### End to End

Use separate browser contexts for Owner, Writer AI, and Reviewer AI.

1. Owner creates the room.
2. Writer and Reviewer join as Pending and see status-only pages.
3. Owner opens Manage access, uses native Role selects, and clicks explicit row
   actions.
4. Writer becomes Editor and Reviewer becomes Reviewer.
5. Writer and Owner edits converge.
6. Reviewer proposes without directly mutating the document.
7. same-location stale proposals form a visible Conflict group.
8. Owner resolves one Proposal.
9. Owner revokes Writer.
10. Writer's cached apply tool is denied and the page shows no stale document.

The test must interact through the same visible controls as a person. Helpers
may locate controls but must not replace the user gesture with direct DOM value
assignment or close the modal immediately after selection.

### Visual Evidence

Review before accepting new baselines. Required evidence states are:

- focused Owner workspace;
- Manage access with Pending and Active rows;
- grouped Proposal/Conflict Review;
- Pending status-only page;
- Revoked status-only page.

Evidence screenshots and videos remain ignored generated artifacts. A snapshot
must not be updated merely because the implementation changed.

### Shared Primitive and Deletion Coverage

Retain focused coverage for CodeMirror editing, keyboard Undo/Redo, Yjs text
convergence, awareness/cursors, Proposal persistence, and other primitives still
reachable from the focused product.

Delete product E2E that exists only for removed Comments, formatting toolbar,
preview, chat, multi-document navigation, file-tree, Git, diagram, or generic
Share flows. Retain a lower-level test only when a reachable focused module
still consumes the tested primitive.

Add a guardrail that fails when removed DOM identifiers, bootstrap imports, or
feature entrypoints return. After each deletion wave, use repository-wide
reference inspection plus build, lint, and focused tests before deleting the
next feature-owned file group.

## 15. Acceptance Criteria

The redesign is complete only when all of these statements are true:

- No governed UI or configuration mentions Grant minutes or automatic expiry.
- The governed state model has Pending, Active, and Revoked only.
- The default governed Role matrix has no Comment capability.
- Owner alone can see and use Manage access.
- Role selection requires an explicit row action.
- Pending and Revoked pages expose no document content or document controls.
- Revoked pages clear already-rendered document content.
- Owner workspace contains one editor, one Participant bar, and one governance
  rail, with no sidebar, preview, generic Share, chat, comments, formatting, or
  duplicate presence surfaces.
- Activity is an unfiltered latest-first list with no filter UI.
- Activity visibly answers who, what, when, source, outcome, and target for
  every recorded collaboration event.
- Editor and Reviewer pages contain no Owner management surface.
- Authorization remains server-authoritative at every execution.
- Browser tests validate actual visibility and user interactions.
- Focused E2E and evidence flows pass every acceptance criterion in this
  section and render all required Visual Evidence states from Section 14.
- Removed product surfaces have no DOM markup, bootstrap wiring, or focused
  product E2E.
- Shared source remains only when at least one reachable focused consumer and
  focused test justify it.
- Removing the file-tree UI does not remove CodeMirror wiki-link completion or
  the existing pure wiki-link resolution behavior for active editors.

## 16. Explicitly Deferred

- Owner recovery or transfer.
- Persistent Role assignments across server restart.
- Time-based access policies.
- Comment capability and Comment product UI.
- A classic/full-CollabMD product mode.
- Proposal storage extraction from the existing Comment-compatible Yjs codec.
- Deep deletion of preview, diagram, export, file-tree, and related server
  infrastructure that remains referenced after the first focused runtime
  removal wave.
- Configurable governed-shell feature toggles.
- Mobile-specific redesign.
- Public SDK extraction.
- Account, organization, or verified AI identity.
- Adversarial per-shared-type Yjs authorization.

These features require demonstrated post-MVP demand before they re-enter scope.

## 17. Post-MVP Deployment and Sharing Memo

This section records follow-up product hypotheses only. It is not part of the
focused-workspace implementation plan, and none of its feasibility assumptions
are considered verified by this design.

### 17.1 Hosting and Durable Backend

Investigate a production architecture that may use:

- Vercel for the web application and public routing;
- Supabase for authenticated identities, group membership, durable document
  metadata, access records, and a server-owned Activity or audit store;
- a separately validated stateful collaboration path for WebSocket/Yjs room
  state and persistence.

The current CollabMD server owns filesystem-backed content, in-memory governance
sessions, and stateful WebSocket rooms. A Vercel-only deployment must not be
assumed viable until those runtime requirements are tested against the chosen
Vercel execution model. Supabase Realtime or another stateful service may
replace parts of that runtime, but doing so is a separate architecture project.

### 17.2 Group and Document Routes

Investigate stable URL-path routing in which a deployed document is addressed
by a group-scoped document identifier, for example:

```text
/groups/:groupId/docs/:docId
```

The final route shape remains undecided. Required properties are:

- `docId` is a stable opaque identifier, not a raw filesystem path;
- one group may own multiple documents;
- one document belongs to an explicit group scope;
- route resolution never substitutes for authorization;
- group membership and document access are checked server-side;
- browser refresh and shared links resolve the same document deterministically.

### 17.3 Share Experience

Investigate an Owner-facing `Share` button that copies a canonical document URL
and opens a compact access surface. The later design must choose among:

- invite-only collaborator access;
- authenticated read-only access;
- authenticated Editor or Reviewer invitation;
- public read-only links, if explicitly justified.

A URL alone must not silently grant edit or governance authority. Share-link
creation, revocation, expiry, group membership, and recipient identity require a
durable backend and a separate security review.

### 17.4 Follow-up Order

Handle this post-MVP work in this order:

1. verify hosting constraints for stateful Yjs/WebSocket collaboration;
2. select the durable identity, group, document, and Activity data model;
3. define canonical group/document routes and server authorization;
4. design Share and invitation flows;
5. implement and verify deployment, sharing, and recovery.

Do not add Vercel, Supabase, group routing, or Share-button abstractions to the
focused workspace until that follow-up design is approved.
