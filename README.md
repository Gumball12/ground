# Governed Collaboration for WebMCP

Governed Collaboration is a focused workspace for one live Markdown document
shared by human- and AI-labelled browser page sessions. It adds visible Roles,
server-authoritative access checks, Proposals, deterministic Conflicts, and
collaboration Activity to CollabMD's synchronized editor.

The project targets the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).
It is implemented and packaged for local verification. This README does not
claim a public deployment, a live ChatGPT verification, a Challenge submission,
or a recorded demo.

## Focused product contract

The focused governed workspace is the only product mode. It contains one
Markdown editor, one Participant bar, and, for the Owner only, `Review`,
`Activity`, `Roles`, and `Manage access` surfaces.

- The first successful page session becomes the immutable Owner for the
  in-memory room lifetime.
- The Owner can explicitly `Assign role`, `Update role`, or `Revoke access` for
  other Participants.
- Owner, Editor, and Reviewer Roles remain active until the Owner changes or
  revokes them, or the server restarts.
- Pending and Revoked Participants receive status-only pages. They have no
  document content, editor, removed-feature UI, personal Undo/Redo history, or
  WebMCP document tools.
- An active Editor receives a writable editor. An active Reviewer receives a
  read-only editor. Neither sees Owner management or governance surfaces.
- The server authorizes every supported WebMCP execution; visible controls and
  tool discovery are usability gates, not the authority.

The product has no access duration or expiry, `Comment` capability, preview,
Chat, file tree, multi-document navigation, classic/full CollabMD mode, or
hidden switch that restores those features. Shared lower-level primitives may
remain where the focused editor still consumes them, but they are not product
surfaces.

## Built on CollabMD

This repository is based on [CollabMD](https://github.com/andes90/collabmd),
copyright 2026 andes90, under the MIT License. The original [`LICENSE`](LICENSE)
is preserved.

The focused MVP reuses CollabMD's filesystem-backed Markdown content,
CodeMirror editor, Yjs text synchronization and convergence, Participant
awareness and cursors, exact-text revision guard, and active-document WebMCP
integration. The added product layer governs supported browser UI and WebMCP
flows; it is not a new CRDT editor or a general authorization system.

## Access states and tools

| Access | Visible workspace | WebMCP document tools |
|---|---|---|
| Owner | Writable editor, Participant bar, Manage access, Review, Activity, Roles | Read, apply, propose |
| Editor | Writable editor and Participant bar | Read, apply, propose |
| Reviewer | Read-only editor and Participant bar | Read, propose |
| Pending | `Waiting for access` status page and Participant bar | None |
| Revoked | `Access revoked` status page and Participant bar | None |

The concrete tool matrix is:

| Role | Tools |
|---|---|
| Owner / Editor | `collabmd_read_active_document`, `collabmd_apply_text_edits`, `collabmd_propose_text_edit` |
| Reviewer | `collabmd_read_active_document`, `collabmd_propose_text_edit` |
| Pending / Revoked | No document tools |

Access management and Conflict resolution are Owner UI actions, not WebMCP
tools. Cached tool calls are still reauthorized by the server when executed.

## Role configuration

The server loads `collabmd.governance.json` from the process working directory
when present; otherwise it uses the default manifest included in the npm
package and Docker image.

```json
{
  "roles": {
    "owner": ["document.read", "document.suggest", "document.edit", "conflict.resolve", "grant.manage"],
    "editor": ["document.read", "document.suggest", "document.edit"],
    "reviewer": ["document.read", "document.suggest"]
  }
}
```

This is the complete focused capability vocabulary. The Owner Role must include
`grant.manage`. Removed capabilities and duration fields fail configuration
validation instead of being silently accepted.

## Activity boundary

Owner-only `Activity` is a latest-first collaboration history. Each item shows
the actor and Role at action time, action, timestamp, source, outcome, and
target.

The fixed source labels are:

- `Document editor`
- `WebMCP apply`
- `WebMCP proposal`
- `Owner decision`
- `Access management`
- `System reconciliation`

Activity does not store full direct-edit diffs, record every denied or no-op
command, or provide tamper resistance. It is synchronized collaboration
history, not a durable security audit log.

## Run locally with Node 26

Requirements:

- Node.js 26 or newer;
- npm;
- ripgrep (`rg`), used by global text search infrastructure retained below the
  focused product surface and included in the Docker image. On macOS, install
  it with `brew install ripgrep`.

```bash
npm ci
npm run build
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
npm run start:prod -- data/vault --no-tunnel
```

Open `http://127.0.0.1:1234/#file=README.md`.

The current source verification commands are:

```bash
npm run lint
npm run build
npm run check
npm run test:e2e:prebuilt
```

`npm run check` runs lint, guardrails, unit tests, integration tests, and browser
tests. `npm run test:e2e:prebuilt` runs the full Playwright suite against the
existing build.

## Deterministic walkthrough and reset

Use separate browser profiles or browser contexts so each page has an
independent Participant session. Copying a tab does not create a distinct
session.

1. Seed `data/vault/README.md` from `docs/demo/launch-plan.md` and start the
   server.
2. Open the document in the first browser context. That page becomes Owner.
3. Open Writer and Reviewer in separate contexts with
   `?participantKind=ai#file=README.md`. Both begin Pending.
4. In `Manage access`, choose Editor for Writer and click `Assign role`; choose
   Reviewer for Reviewer and click `Assign role`.
5. Edit as Writer, create a Proposal as Reviewer, and create same-location stale
   Proposals to show a grouped Conflict.
6. As Owner, use `Keep current` or `Apply`, then inspect the actor, action, time,
   source, outcome, and target in `Activity`.
7. Click `Revoke access` for Writer. The Writer page becomes status-only and a
   previously discovered apply tool is denied when executed.

Only the exact query `?participantKind=ai` applies an AI presentation label;
omission or any other value uses Human. Labels and display names are
self-declared metadata, not verified identities, providers, models, or accounts,
and never affect authorization.

To reset deterministically, stop the running server, replace the document, and
start a new process:

```bash
cp docs/demo/launch-plan.md data/vault/README.md
npm run start:prod -- data/vault --no-tunnel
```

The new server process clears the in-memory Owner and Role assignments. There
is no public reset endpoint or reset button.

## Local package and container verification

Inspect the npm package contents without publishing:

```bash
npm pack --dry-run
```

Validate the local Compose configuration and smoke-test the image's packaged
default governance manifest without a custom manifest bind:

```bash
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

`npm run test:e2e:evidence` produces ignored local Playwright Evidence for the
six focused flows. It is a verification artifact, not proof of a public
deployment, live ChatGPT integration, recorded demo, or Challenge submission.

## Security and claim boundary

- Page sessions are not accounts, organizations, or identity-provider
  principals.
- The supported boundary covers the shipped UI and WebMCP flows. A deliberately
  custom raw Yjs client is outside the authorization claim.
- The filesystem remains the source of truth for document content; governance
  session state is in memory and supports one server instance.
- Owner recovery, transfer, multiple Owners, and persistence across restart are
  excluded.
- Proposal Conflict detection compares exact text and anchors, not meaning.

See the approved [focused workspace design](docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md)
for the complete system and verification boundary.

## Post-MVP investigations

Vercel hosting, Supabase-backed identity or durable records, group/document
routes, and an access-aware Share experience are future investigations only.
They are not implemented, deployed, or verified by this MVP.

## License

MIT. See [`LICENSE`](LICENSE). CollabMD attribution and its original license
notice are retained.
