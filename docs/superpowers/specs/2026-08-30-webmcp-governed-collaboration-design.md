# WebMCP Governed Collaboration MVP Design

**Date:** 2026-08-30  
**Status:** Approved design  
**Target:** OpenAI WebMCP Challenge  
**Base project:** [CollabMD](https://github.com/andes90/collabmd) (MIT)

## 1. Summary

Build a WebMCP-native governed collaboration layer on top of CollabMD. One human and multiple AI page sessions edit one live Markdown document. Within the supported CollabMD UI and WebMCP flows, each session receives a room-scoped Role that determines whether it can read, comment, propose, edit, resolve conflicts, or manage Grants.

The MVP is not a new collaborative editor. It reuses CollabMD's Markdown editor, Yjs synchronization, presence, comments, WebMCP tools, revision guard, and tab lock. The product contribution is visible, configurable governance for mixed human/AI collaboration.

The core demonstration is:

1. A human Owner assigns Editor to Writer AI and Reviewer to Reviewer AI.
2. The human and Writer edit the same document concurrently.
3. Reviewer can create a Proposal but cannot directly change the document.
4. Overlapping stale changes become visible Conflicts instead of silent overwrites.
5. The Owner resolves the Conflict and revokes Writer's Grant.
6. A stale tool invocation is denied at execution time.

## 2. Product Boundary

### Included

- One room and one governed active Markdown document.
- One Owner page session operated by the human in the demo. The server does not verify that the operator is human.
- Human or AI Editor and Reviewer page sessions.
- Role definitions loaded from a small manifest.
- Runtime Role assignment, expiry, and revocation.
- Role-aware WebMCP tool discovery plus execution-time authorization.
- Yjs live collaboration and convergence.
- Plain-text paste and the existing non-image Markdown text editing actions under the same `document.edit` policy.
- Shared Proposal lifecycle.
- Deterministic overlap Conflict detection.
- Multiple Conflicts grouped by document location and resolved individually.
- Participant, Review, Activity, Roles, and Manage access UI.
- A public HTTPS deployment, public repository, English documentation, and a sub-three-minute demo.

### Excluded

- Accounts, organizations, and identity providers.
- Owner transfer, recovery, or multiple Owners.
- Multi-document permission inheritance.
- Section-, paragraph-, field-, or number-specific Grants.
- Semantic Conflict classification.
- A general policy engine.
- A public SDK.
- Malicious raw Yjs client authorization.
- Immutable or tamper-proof audit logging.
- Verified AI provider, model, or account identity.
- Durable selective rollback.
- Image paste and attachment upload in governed mode.
- Continued editing while the collaboration connection is offline.
- File-tree, Git, drawing, and diagram mutation surfaces in the demo UI.

## 3. Verified CollabMD Base

The implementation must reuse the following original CollabMD capabilities rather than recreate them:

- Markdown editing and file model.
- Client and server Yjs document synchronization.
- Awareness, presence, and follow mode.
- Yjs-backed comment threads and comment persistence.
- `collabmd_read_active_document`.
- `collabmd_apply_text_edits` with exact-text and revision checks.
- Active synchronized document checks.
- Local tab activity lock.

Relevant upstream seams include:

- `src/client/infrastructure/editor-collaboration-client.js`
- `src/server/domain/collaboration/collaboration-room.js`
- `src/client/infrastructure/comment-thread-store.js`
- `src/client/infrastructure/webmcp-tool-registry.js`
- `src/client/infrastructure/tab-activity-lock.js`

CollabMD also has hosted `admin` and `collaborator` membership APIs. They are account-oriented and do not implement this MVP's page-session Editor/Reviewer model. They may inform implementation patterns but are not the product authorization layer.

The temporary clone at `/private/tmp/webmcp-role-spike.i2cY35/collabmd` is feasibility evidence only. It must not be copied as product code without reimplementation and review.

## 4. System Model

### 4.1 Participant

A Participant is one connected page session in one room.

- `participantSessionId`: server-issued, non-secret public identifier used for presence, activity labels, and tab-lock scope.
- Session credential: server-issued opaque credential used to retrieve or validate the runtime Grant. It is not accepted as a WebMCP tool input.
- `displayName`: user-visible label such as `Mina`, `Writer`, or `Reviewer`.
- `kind`: `human` or `ai`, used only for presentation.

`displayName` and `kind` are not authentication claims. Authorization depends only on the server-authoritative page session and its active Grant.

A Participant has one derived state:

- `pending`: connected to the room control channel but not assigned a Grant; document mutation tools and Yjs document access are inactive.
- `active`: has an unexpired, non-revoked Grant.
- `expired`: its most recent Grant expired.
- `revoked`: its most recent Grant was revoked.

### 4.2 Owner

The first page session that successfully creates a new room through the human-facing UI receives the immutable Owner Grant for that room lifetime. Room creation is an atomic server operation and is not exposed as a WebMCP tool. The UI presents this session as the Human Owner, but the server does not prove that the operator is human.

- The Owner Grant is not assignable through WebMCP.
- Owner actions are available only through supported UI commands.
- Owner recovery and transfer are outside the MVP.
- Server restart ends runtime Grants and requires a new room session.
- `defaultGrantMinutes` does not apply to Owner; the Owner Grant lasts for the room lifetime.

### 4.3 Capability

Capabilities are a fixed vocabulary implemented by application commands:

- `document.read`
- `document.comment`
- `document.suggest`
- `document.edit`
- `conflict.resolve`
- `grant.manage`

A new Role can be composed from existing Capabilities in configuration. Adding a new Capability requires code because a command must implement and enforce it.

`document.comment` covers CollabMD's existing comment create, reply, resolve, and reaction operations. The MVP does not add comment editing, deletion, moderation, or a separate comment-resolution Capability. Comment mutations are not part of the text UndoManager.

### 4.4 Role Manifest

The server loads `collabmd.governance.json`:

```json
{
  "roles": {
    "owner": [
      "document.read",
      "document.comment",
      "document.suggest",
      "document.edit",
      "conflict.resolve",
      "grant.manage"
    ],
    "editor": [
      "document.read",
      "document.comment",
      "document.suggest",
      "document.edit"
    ],
    "reviewer": [
      "document.read",
      "document.comment",
      "document.suggest"
    ]
  },
  "defaultGrantMinutes": 60
}
```

The server validates this manifest at startup. Unknown Roles, unknown Capabilities, invalid durations, and an Owner definition without `grant.manage` must fail startup with a clear error.

### 4.5 Runtime Grant

A runtime Grant contains:

- `participantSessionId`
- `roleId`
- `documentPath`
- `issuedAt`
- `expiresAt`
- optional `revokedAt`

Runtime Grants are server-authoritative and live only for the room session. They are not stored in the Yjs document or accepted from tool inputs.

Tasks such as “check the numbers in paragraph two” are instructions, not permission rules. Task text never changes a Grant.

## 5. Authorization Flow

Every supported human UI command and WebMCP command uses the same capability check:

```text
page session
  -> resolve active server Grant
  -> check room, document, expiry, and revocation
  -> check Role contains required Capability
  -> execute command or return a structured denial
```

The application hides tools and controls that a Role cannot use. Visibility is only a usability feature. Authorization is rechecked immediately before mutation so that cached tool discovery cannot bypass expiry or revocation.

Caller-provided `actorId`, `role`, `kind`, and display name are ignored for authorization.

### Editor Mutation Gate

Every local `docChanged` transaction is subject to one common editor mutation gate. A writable-looking control is never the authority.

- CodeMirror is reconfigured read-only when the current page session lacks `document.edit`.
- A transaction filter rejects local text changes without an active `document.edit` Grant, including programmatic dispatches.
- Undo and Redo also recheck `document.edit` immediately before calling the UndoManager.
- An internal governance transaction may change text with `conflict.resolve`; it uses a distinct trusted origin and is excluded from personal Undo history.
- Comment operations use `document.comment` and Proposal creation uses `document.suggest`.

### WebMCP Surface

- Owner and Editor: existing read/apply tools plus the Proposal tool.
- Reviewer: read and Proposal tools; no direct apply tool.
- Ungranted or revoked session: no document mutation tools.
- Grant management and Conflict resolution are Owner UI commands, not WebMCP tools.

The new imperative tool is `collabmd_propose_text_edit`. It accepts one exact-text replacement per call; multiple suggestions require multiple calls. Existing CollabMD read/apply names remain unchanged.

The top-level page owns tool registration. An iframe is not used for tool discovery. This follows the current [WebMCP draft](https://webmachinelearning.github.io/webmcp/), whose execute context does not provide a standard caller or agent identity.

## 6. Collaboration Data Flow

### User Action Taxonomy

All supported Markdown actions are grouped by mutation pipeline rather than authorized or tested button by button.

| Pipeline | Included actions | Required Capability |
|---|---|---|
| Native CodeMirror/Yjs | typing, IME, backspace/delete, cut, plain-text paste, autocomplete, bracket completion, indent, and Vim input | `document.edit` |
| Discrete UI dispatch | toolbar formatting, link/video/table/rule insertion, document format, and preview task toggle | `document.edit` |
| Personal history | Undo and Redo from keyboard, toolbar, or a cached command | `document.edit` |
| Structured AI edit | `collabmd_apply_text_edits` | `document.edit` |
| Governance decision | Proposal accept/reject and Conflict keep/apply | `conflict.resolve` |

Original CollabMD has no app-owned editor text drag/drop or search-and-replace mutation path. File-tree drag/drop and file/Git actions are outside the single-document governed demo.

Image paste and toolbar attachment upload are hidden in governed mode. Plain-text paste remains a normal native edit.

### Human Editor

The supported editor is writable only when the page session has `document.edit`. CodeMirror changes update the existing Yjs text and synchronize through CollabMD's collaboration room.

Every persisted document mutation from a supported origin revalidates only non-terminal `open` or `conflict` Proposals whose anchors overlap the changed range. Terminal Proposals are never reopened by later text edits.

The component that originates the mutation owns that revalidation exactly once:

- A human page revalidates after its native or discrete editor transaction.
- An AI page revalidates within its structured edit command.
- An Owner page revalidates within its governance transaction.
- The server revalidates within an external file reconciliation transaction and records the actor as `system`.
- Remote observers render the resulting document, Proposal, and Activity state but never append duplicate status or Activity changes.

All Proposal decisions still recompute the current anchor and target text at decision time. A missing earlier revalidation can therefore delay a visible Conflict but can never permit a stale replacement.

### Undo and Redo

Undo and Redo are ordinary `document.edit` actions.

- They recheck the active Grant at execution time.
- A successful Undo or Redo changes document content, revalidates overlapping non-terminal Proposals, and creates one direct-edit Activity event.
- A denied or no-op Undo or Redo changes neither document, Proposal, nor Activity state.
- Personal history never changes Proposal status, resolution metadata, or governance Activity.
- Returning content to an earlier value does not reopen an accepted or rejected Proposal.
- Reversing a governance outcome requires a new direct edit; it does not reuse or reopen the old Proposal.

### AI Editor

`collabmd_apply_text_edits` receives structured exact-text edits and a base revision. Immediately before commit, the command rechecks the Grant and every target text.

- If every target still matches, apply all edits in one Yjs transaction.
- If only unrelated document content changed, apply all edits safely.
- If any target changed or its anchor cannot be resolved, apply none of the edits and create one Conflict Proposal for each failed edit.

### Human or AI Reviewer

A Reviewer cannot directly mutate the main document through the supported UI or WebMCP flow. It creates a Proposal containing the intended replacement and original target text.

## 7. Proposal Model

Reuse CollabMD's comment-thread anchor, Yjs synchronization, and persistence. Extend a comment thread with:

- `kind: "proposal"`
- `status: "open" | "accepted" | "rejected" | "conflict"`
- `expectedText`
- `replacementText`
- `baseRevision`
- `createdByParticipantSessionId`
- `createdByDisplayName`
- `createdByKind`
- `createdByRole`
- `createdAt`
- optional `resolvedByParticipantSessionId`
- optional `resolvedAt`
- optional `resolution: "keep_current" | "apply_proposed"`

The product must not keep Proposals only in a browser callback or local array. They must be synchronized and visible to other Participants and survive browser refresh through the existing Yjs snapshot/comment persistence path.

Terminal states are idempotent. A second accept or reject request must fail without changing the document.

Terminal states are also monotonic. Later typing, paste, formatting, Undo, Redo, AI edits, reconnects, and refreshes never return an accepted or rejected Proposal to `open` or `conflict`.

## 8. Conflict Model

Yjs convergence is not called a Conflict. A product Conflict exists only when a structured edit or Proposal can no longer prove that its intended target is unchanged.

### Decision Algorithm

1. Resolve the Proposal's current document anchor.
2. Read the current target text.
3. If it equals `expectedText`, apply `replacementText`.
4. If it differs or the anchor is missing, set the Proposal to `conflict` and leave the document unchanged.

This algorithm is deterministic. It does not infer semantic contradiction.

### Multiple Conflicts

- Group Conflict markers by current document location.
- Show one inline marker with a count such as `2 conflicts`.
- Keep each Proposal independently selectable in the Review rail.
- Sort groups by document position and break ties by creation time.
- Put Conflicts whose anchors no longer resolve in an `Unlocated conflicts` group after all located groups, ordered by creation time. They have no inline marker.
- Resolving one Proposal revalidates every overlapping open or conflicting Proposal.
- Never auto-accept or auto-reject overlapping Proposals.
- Do not implement `Resolve all` in the MVP.

Owner actions are:

- `Keep current`: reject the selected Proposal without changing the document.
- `Apply proposed`: apply the selected replacement after an explicit warning and then revalidate overlapping Proposals.

An Unlocated Conflict cannot determine a safe insertion point. It offers `Keep current` only; `Apply proposed` is disabled.

Owner resolution is one logical and observable commit. The selected Proposal status and resolution metadata, optional text replacement, overlapping Proposal revalidation, and one Activity event are written in one Yjs transaction. The transaction uses a governance origin excluded from the personal text UndoManager. Any failure leaves all four unchanged.

## 9. Activity

Provide a shared collaboration activity stream for supported application flows:

- Participant joined.
- Grant issued, changed, expired, or revoked.
- Direct edit applied.
- External document reconciliation applied by `system`.
- Proposal created, accepted, rejected, or moved to Conflict.

Each item displays actor label, `human` or `ai`, Role at action time, action, outcome, target reference, and timestamp.

Activity is a collaboration history, not an immutable audit log. It uses `Y.Array("governanceActivity")` in the existing document. The action origin appends the event; remote observers never append a duplicate.

- Consecutive native typing, IME, delete, and cut transactions from one Participant form one edit burst, closed by one second of inactivity, editor blur, or a discrete command.
- Plain-text paste, toolbar formatting, document format, task toggle, Undo, Redo, and one AI apply call each create at most one direct-edit event.
- One AI apply call creates one event even when it atomically changes multiple targets.
- Each persisted Proposal status change creates one event.
- Owner accept/reject creates only the resulting Proposal event; it does not also create a duplicate `Conflict resolved` event.
- Denied and no-op actions create no success event.
- Actor kind and Role are snapshots captured at action time and never change when a later Grant changes.

Owner Grant commands append after the server acknowledges the change. The UI and documentation must not claim tamper resistance.

## 10. User Interface

The MVP shows one active document and removes multi-document navigation from the demo surface.

### Persistent Participant Bar

- Human/AI avatar.
- Display name.
- Current Role.
- Active, pending, expired, or revoked state.

### Document

- Existing CollabMD Markdown editor.
- Existing presence and cursors.
- Inline Proposal and Conflict markers.
- Reviewer sessions use read-only main-document mode.

### Right Rail

- `Review`: open Proposals and location-grouped Conflicts.
- `Activity`: collaboration events with Human, AI, and Access filters.
- `Roles`: read-only Role-by-Capability matrix loaded from the manifest.

### Manage Access

- Current Participants.
- Pending Participants.
- Role assignment.
- Grant expiry.
- Immediate revocation.
- Immutable Owner row.

`pending`, `expired`, and `revoked` Participants retain only the room-control view needed to show status and allow an Owner to assign a new Role. They have no Yjs document connection or document tools.

The approved mockups define information architecture, not final styling. Reuse CollabMD's visual language and accessible components where possible. Governance surfaces need explicit status colors, non-color labels, keyboard navigation, visible focus, and readable contrast.

## 11. Tab Activity Lock

Original CollabMD uses one fixed localStorage key and BroadcastChannel name, allowing one active tab per origin/storage partition.

The MVP scopes that lock by the server-issued non-secret `participantSessionId`:

- Distinct Participant sessions on the same origin can remain active.
- A duplicate tab for the same Participant session remains blocked.
- The secret session credential is not placed in the lock key, channel name, URL, or localStorage.
- The page stores its opaque session credential in tab-scoped `sessionStorage` so reload preserves the session while a duplicated tab remains subject to the same Participant lock.

## 12. Connection and Grant Transitions

Governed mode does not allow new document or comment mutations while the collaboration connection is offline.

- On disconnect, the editor and comment controls freeze immediately. The current local Y.Doc and UndoManager remain in memory only to preserve already-created but unsynchronized changes.
- Before reconnecting the Yjs provider, the page revalidates its server Grant.
- If the same active Editor Grant remains valid, reconnect the same Y.Doc so earlier unsynchronized edits can converge.
- If the Grant expired, was revoked, or gained/lost `document.edit`, destroy the old EditorSession, Y.Doc, and UndoManager before any new document connection. Show that stale local changes were discarded because access changed.
- Any online Grant transition that gains or loses `document.edit` also recreates the EditorSession and starts an empty personal Undo/Redo stack.
- Every Grant issue, Role change, expiry, and revoke immediately recalculates editor mode and WebMCP tool registration.
- A revoke or expiry disconnects the document provider and leaves the Participant in the room-control view only. It does not implicitly grant Reviewer access.
- An active Role change from Editor to Reviewer reconnects under the new active read/comment/suggest Grant with a fresh server document and empty text history.
- An active Role change from Reviewer to Editor reconnects under the new active edit Grant with a fresh server document and empty text history.

These guarantees begin after the server acknowledges the Grant change and the supported client receives it. Protection against a malicious raw Yjs client or an unobservable network race remains outside the MVP threat model.

## 13. Persistence

- Markdown content: existing CollabMD/Yjs persistence.
- Comments and Proposals: existing comment/Yjs persistence with the extended schema.
- Activity: room-scoped shared history; not an immutable audit store.
- Role manifest: repository configuration file.
- Owner and runtime Grants: server memory for the room lifetime.

Restart recovery for Owner and Grants is intentionally excluded.

## 14. Error Handling

All failures default to no document mutation.

- Missing, expired, or revoked Grant: structured permission denial.
- Wrong document or room: denial.
- Disconnected or inactive synchronized document: denial.
- Invalid edit range or malformed Proposal: validation error.
- Stale unrelated revision: revalidate target and apply if exact text still matches.
- Stale overlapping revision or missing anchor: create or retain Conflict; do not apply.
- Duplicate terminal Proposal action: idempotent denial.
- Unauthorized Grant or Conflict action: denial and visible UI feedback.
- Unlocated Conflict apply: denial; only `Keep current` is available.
- Offline user mutation: blocked while retaining only already-unsynchronized state until Grant revalidation.
- Access changed during disconnect: discard the stale local Y.Doc/history and reload the authoritative server document.

## 15. Security and Claim Boundary

The MVP provides session-scoped capability gating for supported CollabMD UI and WebMCP flows.

It does not provide adversarial CRDT authorization. In original CollabMD, main text and comments share a Yjs document/update channel and the collaboration server does not enforce per-shared-type Reviewer restrictions. A malicious custom Yjs client may bypass supported UI restrictions.

README and demo wording must use:

- `page-session capability gating`
- `supported UI/WebMCP flows`
- `deterministic overlap conflict`

They must not use:

- `verified AI identity`
- `enterprise-grade CRDT authorization`
- `tamper-proof audit log`
- `semantic conflict detection`
- `malicious Yjs clients are blocked`

## 16. Verification

### Retained CollabMD Baseline

Retain upstream coverage for local-only Undo/Redo, remote-edit preservation, exact replacements as one undoable edit, document formatting as one undoable edit, Yjs reconnect history, Markdown formatting helpers, image-paste parsing, comment synchronization, and active-document WebMCP guards. Do not duplicate these tests unless this MVP changes their shared implementation path.

### Unit

- Manifest validation.
- Role-by-Capability matrix.
- Expiry and revocation.
- Actor/Role spoof input ignored.
- Atomic room creation grants Owner only to the first successful creator session.
- Owner Grant ignores collaborator expiry, cannot be reassigned, and cannot be revoked through Manage access.
- Exact-target Conflict algorithm.
- Proposal state transitions and idempotency.
- Multiple overlapping Proposal revalidation.
- Terminal Proposal monotonicity across later edit actions.
- Activity event cardinality and action-time actor/Role snapshots.
- Unlocated Conflict exposes no apply transition.

### Integration

- Role-aware WebMCP registration and execution-time authorization.
- Human read-only mode for Reviewer.
- Proposal synchronization and refresh persistence.
- Exactly-once overlapping Proposal revalidation by the origin of a remote participant or server-system document mutation; observers append no duplicates.
- Grant issue, change, expiry, and revocation.
- A pending Participant has no Yjs document access or mutation tools until the Owner assigns a Role.
- Activity propagation.
- No mutation on denied or disconnected execution.
- Table-driven local edit contract using representative typing, plain-text paste, toolbar formatting, and preview task toggle actions.
- Undo/Redo reauthorization after downgrade, expiry, and revoke.
- Governance resolution excluded from personal Undo history while its text/status/revalidation/Activity commit remains atomic.
- Existing comment create/reply/resolve/reaction operations gated by `document.comment` and unaffected by text Undo/Redo.
- Disconnect freeze, same-Grant reconnect, changed-Grant local-state discard, and empty history after an edit-capability transition.

### Browser E2E

- Human Owner, Writer Editor, and Reviewer Reviewer active on the same origin.
- A second room-creation attempt cannot claim or replace Owner.
- The Owner row is immutable and no WebMCP tool can manage Grants.
- Duplicate tab for one Participant blocked without blocking other Participants.
- Human and Writer concurrent edits converge to identical document content.
- Reviewer creates a Proposal without mutating the main document.
- Same-location stale changes produce multiple Conflict entries.
- Owner resolves one and remaining overlapping Proposals revalidate.
- Revoked Writer cannot reuse a previously discovered apply tool.
- Reviewer or revoked sessions cannot mutate through typing, plain-text paste, toolbar actions, preview task toggle, Undo, or Redo.
- Proposal anchors move across non-overlapping edits and become Conflict or Unlocated after target edits/deletion/Undo/Redo.
- Accepted and rejected Proposals remain terminal through subsequent text actions.
- Refresh preserves document, Proposal, and Activity state without replay duplicates while starting an empty personal history after a recreated session.

### Test Economy

- Test the shared local transaction guard once with a small representative table, not every key and toolbar button.
- Test the shared command handler plus one browser path rather than every Role × keyboard × toolbar × WebMCP combination.
- Do not duplicate generic Yjs convergence, basic type/Undo/Redo, basic comment CRUD, or Excalidraw history tests.
- Use one Proposal lifecycle round-trip instead of serialization tests for every field.
- Keep image-paste parsing tests upstream, but add no governed image workflow because that feature is excluded.

### Live Smoke Test

- Public HTTPS URL loads as a top-level page.
- ChatGPT browser discovers the expected imperative WebMCP tools.
- Read, apply, propose, revoke, and denial paths work against the deployed app.

## 17. Demo Plan

Target a 2:45–2:50 English recording to remain below the three-minute limit.

| Time | Scene |
|---|---|
| 0:00–0:20 | Human Owner, Writer AI, and Reviewer AI join one document. |
| 0:20–0:40 | Owner grants Editor and Reviewer. |
| 0:40–1:10 | Human and Writer edit concurrently through UI and WebMCP. |
| 1:10–1:35 | Reviewer creates a Proposal instead of changing the document. |
| 1:35–2:05 | A second stale edit creates two same-location Conflicts. |
| 2:05–2:25 | Owner resolves one; the other revalidates. |
| 2:25–2:40 | Owner revokes Writer; a cached apply invocation is denied. |
| 2:40–2:50 | Activity, Roles, public repository, and live URL are shown. |

Use prepared document content and rehearsed prompts, but record real WebMCP calls, live Yjs synchronization, Conflict creation, and authorization denial.

The local ignored filming handoff is stored at `/Users/a1004/Documents/_projects_comp/dotss/.local/webmcp-demo-recording-handoff.md` until the product repository has its own ignored local notes.

## 18. Extensibility Boundary

Keep four small internal seams:

- Capability constants/types.
- Role manifest loader and validator.
- `can(pageSession, capability, document)` authorization function.
- Capability-tagged UI/WebMCP command registry.

Do not build a public package, adapter framework, policy DSL, or generic subject/resource engine. Extract an SDK only after a second real integration requires the same seams.

Stronger raw Yjs authorization is a separate future project. Its trigger is a requirement to protect against custom or malicious collaboration clients. That project would separate main-document writes from comment/Proposal commands or add server-authoritative update validation.

## 19. Definition of Done

The MVP is complete only when:

1. All Unit, Integration, and Browser E2E checks above pass.
2. The live ChatGPT WebMCP smoke test passes.
3. The public repository preserves CollabMD's MIT attribution and includes an open-source license.
4. README accurately describes the security and identity limitations.
5. The English demo remains under three minutes and shows actual WebMCP execution.
6. No excluded subsystem was added without explicit scope approval.
7. Every retained user text mutation path is protected by the common edit gate, while the representative governance intersection tests pass without duplicating upstream editor coverage.
