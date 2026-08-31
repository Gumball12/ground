# Governed Collaboration for WebMCP

Governed Collaboration adds visible, configurable permissions to one live Markdown document shared by a human and multiple browser-agent page sessions.

The project targets the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/). It is locally implemented and packaged; this README does not claim a public deployment, public fork URL, or recorded demo.

## Why it exists

Realtime editors already merge concurrent text. Mixed human/agent work also needs an answer to a different question: who may read, propose, edit, resolve, or change access right now?

This MVP adds:

- page-session capability gating for Owner, Editor, and Reviewer Roles;
- runtime Grants with assignment, expiry, Role changes, and revocation;
- Role-aware WebMCP tool discovery with authorization checked again at execution time;
- synchronized Proposals, grouped Conflicts, and human resolution;
- a visible Participant bar, Review rail, Activity history, Roles matrix, and Manage access dialog;
- deterministic overlap conflict handling when an exact target or anchor is no longer current.

It deliberately governs supported UI/WebMCP flows instead of replacing the collaborative editor or claiming a general authorization system.

## Built on CollabMD

This repository is based on [CollabMD](https://github.com/andes90/collabmd), copyright 2026 andes90, under the MIT License. The original [`LICENSE`](LICENSE) is preserved.

The MVP reuses CollabMD's:

- Markdown editor and filesystem-backed vault;
- Yjs document synchronization, convergence, presence, and cursors;
- synchronized comments and persistence;
- exact-text revision guard;
- active-document WebMCP tools;
- local duplicate-tab lock.

The added product layer is page-session governance for mixed human/agent collaboration. It is not a new CRDT editor.

## Three-session walkthrough

Use one `README.md` document in three independent page sessions. Separate browser profiles or contexts avoid copying the same tab-scoped session.

1. Open the document in the first page session. Atomic room creation makes that session the immutable Owner for the room lifetime.
2. Open two more page sessions with `?participantKind=ai` and label them `Writer` and `Reviewer`. They begin pending, without document access.
3. In **Manage access**, assign `Editor` to Writer and `Reviewer` to Reviewer, with a Grant duration.
4. Writer discovers read, apply, and propose WebMCP tools and can directly edit the document.
5. Reviewer discovers read and propose tools. A Proposal is synchronized for the Owner to review without directly changing the document.
6. Make two stale structured changes at the same target. They appear as a grouped Conflict while remaining individually selectable in **Review**.
7. The Owner chooses **Keep current** or **Apply** for one Proposal. Overlapping open Proposals are revalidated.
8. Revoke Writer in **Manage access**. After Writer receives the updated snapshot, even a previously discovered apply tool is denied.
9. Inspect **Activity** for collaboration history and **Roles** for the Role-by-Capability matrix.

Only the exact query `?participantKind=ai` creates an `ai`-labelled page session; omission or any other value uses `human`. For example, an agent page may open `http://127.0.0.1:1234/?participantKind=ai#file=README.md`. This value and names such as `Writer` and `Reviewer` are self-declared presentation metadata, not authenticated person, provider, model, or account claims. They never affect authorization.

## Role configuration

The server loads `collabmd.governance.json` from the process working directory when present, otherwise it uses the default manifest included in the npm package and Docker image:

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

Roles may be recomposed from the fixed capability vocabulary. Adding a new capability still requires an application command that implements and enforces it. The Owner Role must include `grant.manage`; invalid Roles, capabilities, or durations fail startup.

The WebMCP surface derived from this manifest is:

| Role | Tools |
|---|---|
| Owner / Editor | `collabmd_read_active_document`, `collabmd_apply_text_edits`, `collabmd_propose_text_edit` |
| Reviewer | `collabmd_read_active_document`, `collabmd_propose_text_edit` |
| Pending / expired / revoked | No document tools |

Grant management and Conflict resolution remain Owner UI actions, not WebMCP tools.

## Run locally with Node 26

Requirements:

- Node.js 26 or newer;
- npm;
- ripgrep (`rg`), which powers global text search and is included in the Docker image; on macOS, install it with `brew install ripgrep`.

```bash
npm ci
npm run build
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
npm run start:prod -- data/vault --no-tunnel
```

Open `http://127.0.0.1:1234/#file=README.md`.

The release checks are:

```bash
npm run build
npm run check
npm run test:e2e:prebuilt
git diff --check
```

`npm run check` runs lint, guardrails, unit tests, integration tests, and browser tests. `npm run test:e2e:prebuilt` runs the Playwright suite against the existing build.

## Deterministic demo seed and reset

Seed the ignored local vault from the tracked launch brief:

```bash
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
```

The document keeps `$100K`, `$110K`, and `$120K` visually distinct so exact-text edit and Proposal prompts can be rehearsed without changing the scenario.

Runtime Grants and the Owner session are intentionally held in server memory. The operator-only reset is a process restart plus a fresh seed copy:

```bash
docker compose -f docker-compose.demo.yml restart collabmd
cp docs/demo/launch-plan.md data/vault/README.md
```

There is no public reset endpoint or reset button.

## Local Docker packaging

The existing multi-stage [`Dockerfile`](Dockerfile) builds the app. The demo Compose file adds only the app and Caddy; it does not add hosted mode, OIDC, diagram services, replicas, or a deployment framework.

Validate the Compose configuration with the reserved `.example` hostname, then smoke-test the app container directly:

```bash
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
WEBMCP_HOSTNAME=governed-collaboration.example docker compose -f docker-compose.demo.yml config
docker build -t collabmd-governed:local .
docker run --rm -d \
  --name collabmd-governed-local \
  -p 127.0.0.1:1234:1234 \
  --mount type=bind,src="$PWD/data/vault",dst=/data \
  -e HOST=0.0.0.0 \
  -e PORT=1234 \
  -e COLLABMD_VAULT_DIR=/data \
  -e COLLABMD_GIT_ENABLED=false \
  -e AUTH_STRATEGY=none \
  collabmd-governed:local
curl -fsS http://127.0.0.1:1234/
docker stop collabmd-governed-local
```

The image includes the default governance manifest. Bind a custom manifest to `/app/collabmd.governance.json` only when overriding the default Roles or Grant duration.

[`docker-compose.demo.yml`](docker-compose.demo.yml) and [`deploy/Caddyfile`](deploy/Caddyfile) are deployment packaging only. `WEBMCP_HOSTNAME=governed-collaboration.example` is for local configuration validation, not a live host. A real hostname, DNS, HTTPS deployment, public repository, live browser smoke test, and recording require separate authorization and verification.

## Security and claim boundary

Authorization is server-authoritative for the current room, document, expiry, revocation state, and fixed capabilities. Controls and tool discovery improve usability; every supported mutation is checked again immediately before execution.

The boundary is intentionally narrow:

- page sessions are not accounts, organizations, or identity-provider principals;
- display names and `human`/`ai` labels are not authenticated identities;
- the shared Yjs update channel does not reject a deliberately custom client, so a client outside supported UI/WebMCP flows may bypass the application restrictions;
- Activity is synchronized collaboration history, not an immutable evidence store;
- deterministic overlap conflict compares exact text and anchors, not meaning;
- Owner recovery, transfer, multiple Owners, and restart recovery are excluded;
- multi-document inheritance and section-, field-, or number-specific Grants are excluded;
- governed image paste, attachment upload, offline editing, file-tree/Git/diagram mutation, and a public SDK are excluded.

See the approved [design specification](docs/superpowers/specs/2026-08-30-webmcp-governed-collaboration-design.md) for the complete system and verification boundary.

## License

MIT. See [`LICENSE`](LICENSE). CollabMD attribution and its original license notice are retained.
