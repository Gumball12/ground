# Ground - One document, Different roles

Ground is a shared Markdown editor for people and agents. The owner decides who
can edit, who can only propose, and who gets no access. The server applies those
rules to every WebMCP action.

The project targets the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).
This README does not claim a public deployment, a live ChatGPT verification, a
Challenge submission, or a recorded demo. Each of those is recorded only after
it has actually been run.

## Two products, one repository

| | Ground (hosted) | CollabMD (local) |
|---|---|---|
| Durable source of truth | Supabase Postgres | the filesystem |
| Document | one per shareable link | any file in a vault folder |
| Identity | invisible anonymous Supabase session | a browser page session |
| Roles | outlive a restart | last for the in-memory room |
| Runtime | stateless Vercel Functions | one long-lived Node process |
| Start with | `npm run start:ground` | `npm start` |

Both products share the same editor, the same Yjs synchronization, the same
governance manifest, and the same WebMCP tools. They differ in where a document
lives and how long a Role survives.

## Roles and tools

| Access | Visible workspace | WebMCP document tools |
|---|---|---|
| Owner | Writable editor, Participant bar, Manage access, Review, Activity, Roles | Read, apply, propose |
| Editor | Writable editor and Participant bar | Read, apply, propose |
| Reviewer | Read-only editor and Participant bar | Read, propose |
| Pending | `Waiting for access` status page | None |
| Revoked | `Access revoked` status page | None |

The concrete tool matrix is:

| Role | Tools |
|---|---|
| Owner / Editor | `collabmd_read_active_document`, `collabmd_apply_text_edits`, `collabmd_propose_text_edit` |
| Reviewer | `collabmd_read_active_document`, `collabmd_propose_text_edit` |
| Pending / Revoked | No document tools |

Access management and Conflict resolution are Owner UI actions, not WebMCP
tools. A tool discovered before a Role change is still reauthorized by the
server when it executes, so a cached call is denied after a revoke.

## Role configuration

`collabmd.governance.json` is the only Role and Capability source. The server
loads it from the process working directory when present, otherwise from the
copy shipped in the npm package and Docker image.

```json
{
  "roles": {
    "owner": ["document.read", "document.suggest", "document.edit", "conflict.resolve", "grant.manage"],
    "editor": ["document.read", "document.suggest", "document.edit"],
    "reviewer": ["document.read", "document.suggest"]
  }
}
```

This is the complete capability vocabulary. The Owner Role must include
`grant.manage`. Removed capabilities and duration fields fail validation instead
of being silently accepted.

The manifest is read before requests are served, so changing Role composition
requires a restart locally and a redeploy on Vercel. Adding a new Capability
requires code, not configuration.

## Activity boundary

Owner-only `Activity` is a latest-first collaboration history. Each row shows
the actor and Role at action time, the action, a timestamp, the source, the
outcome, and the target.

The fixed source labels are `Document editor`, `WebMCP apply`,
`WebMCP proposal`, `Owner decision`, `Access management`, and
`System reconciliation`.

Activity does not store full direct-edit diffs, record every denied or no-op
command, or provide tamper resistance. It is synchronized collaboration history,
not a durable security audit log.

## Requirements

- Node.js 24 or newer, and npm.
- Docker, for the local Supabase stack used by Ground.
- ripgrep (`rg`). Global text search in the local product shells out to it, and
  the Docker image installs it. On macOS, `brew install ripgrep`.

## Run Ground locally

Ground needs the local Supabase stack for Postgres, Auth, Realtime, and Cron.

```bash
npm ci
npm run supabase:start
npm run start:ground
```

Open the printed origin, create a document, and share the `/:docId` link. The
creator becomes the Owner and receives a one-time recovery link. That link
carries its token in the URL fragment, so it never reaches the server; treat it
as a secret and store it outside the repository.

Stop the stack with `npm run supabase:stop`. Reset it with
`npm run supabase:reset`.

## Run CollabMD locally

The local product serves a folder of Markdown files and needs no Supabase.

```bash
npm ci
npm run build
mkdir -p data/vault
cp docs/demo/launch-plan.md data/vault/README.md
npm start -- data/vault --no-tunnel
```

Open `http://127.0.0.1:1234/#file=README.md`. Only the exact query
`?participantKind=ai` applies an AI presentation label. Labels and display names
are self-declared metadata, never verified identities, and never affect
authorization.

## Environment

`.env.example` lists every variable name with an empty value. The hosted runtime
requires `GROUND_PUBLIC_ORIGIN`, `GROUND_RATE_LIMIT_HMAC_KEY`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`. Set them in the
platform's credential store. `SUPABASE_SECRET_KEY` reaches only the server
functions and is never exposed to the browser.

`GROUND_E2E_BASE_URL` is test-only. Setting it points the Ground Playwright
suites at a deployed URL and starts no local server.

## Supabase migrations

Migrations under `supabase/migrations/` own the schema, row-level security,
service-only functions, and the scheduled cleanup job.

```bash
npm run supabase:start
npm run supabase:reset
npm run test:supabase
```

`npm run test:supabase` exercises the real database rather than a mock: Owner
uniqueness, cross-document denial, Role transitions, recovery and token
rotation, ordered updates, snapshot compaction, rate limiting, and the
thirty-day retention rules.

## Verify

```bash
npm run lint
npm run build
npm run check
npm run test:supabase
npm run test:e2e:governance:prebuilt
npm run test:e2e:ground
```

`npm run check` runs lint, guardrails, unit, integration, and browser tests.
`npm run test:e2e:ground` needs the local Supabase stack running.

`npm test` runs the full Playwright suite, which includes the Ground hosted
flows, so it also needs Supabase running.

## Evidence

Two curated runs record successful flows into ignored artifact paths.

```bash
npm run test:e2e:evidence
npm run test:e2e:ground:evidence
```

The governance run records five screenshots across six local flows. The Ground
run records seven screenshots and one uninterrupted video per participant
across seven hosted flows. Both refuse to pass if a required artifact is
missing, empty, or accompanied by a trace.

These are verification artifacts. They are not proof of a public deployment, a
live ChatGPT integration, a recorded demo, or a Challenge submission. The
automatic videos are raw evidence, not a narrated demo.

## Deploy to Vercel

Deployment runs from Git. Connect the repository once in Vercel, and every push
deploys: a push to `main` becomes Production, and a push to any other branch
becomes a Preview with its own URL.

The repository ships `vercel.json` with the document route, the runtime
configuration endpoint, and the browser security headers. Two Functions serve
the API and the public runtime configuration; everything else is the static
Vite build. No framework preset is needed.

Set these as **Production-scoped** environment variables in the Vercel project:

```text
GROUND_PUBLIC_ORIGIN            the exact production origin, for example https://ground.example
GROUND_RATE_LIMIT_HMAC_KEY      a freshly generated random secret
SUPABASE_URL                    the hosted Supabase project URL
SUPABASE_PUBLISHABLE_KEY        the Supabase publishable key
SUPABASE_SECRET_KEY             the Supabase secret key
```

Preview deployments must never receive production database credentials. A
Preview either gets its own Supabase project through Preview-scoped variables,
or gets none and reports itself unavailable instead of touching production.

`GROUND_PUBLIC_ORIGIN` covers the production domain. Ground additionally trusts
the three hosts Vercel supplies for the running deployment, `VERCEL_URL`,
`VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL`, so a Preview works
when opened through its branch alias. Nothing a caller sends is trusted.

### Verify before Production

Push the branch first, open the Preview URL, and check the document flow there.
Merge to `main` only after that passes. Vercel builds independently of GitHub
Actions, so a red `validate` job does not stop a Production deploy; read the
Actions result before merging.

To roll back, use Vercel's instant rollback to the previous Production
deployment rather than patching live state.

## Limits

Ground rate-limits document creation, joins, and mutations in fixed windows:
ten creations per hour counted for both the anonymous session and the request
network, thirty joins per hour, and forty mutations per ten seconds. A limited
request returns `429` and changes no document, sequence, or Activity.

An edit is rejected as one operation, storing no prefix and no partial
Activity, when it is larger than the configured update limit or when the
document it would produce is larger than the configured document limit. The
document size counts what a reader replays: the snapshot, the retained update
log, and the arriving update. Hydration folds a long log into one snapshot once
it reaches the compaction threshold, which returns that headroom.

A document with no accepted change for thirty days is deleted with all of its
rows. Folding a log is not a change and does not postpone that deadline.

## Security and claim boundary

- Anonymous sessions are not accounts, organizations, or identity-provider
  principals.
- The supported boundary covers the shipped UI and WebMCP flows. A deliberately
  custom raw Yjs client is outside the authorization claim.
- Client gating is user experience. The server reauthorizes every WebMCP
  execution.
- `participantKind` is self-declared presentation metadata, never verified
  authorization identity.
- Proposal Conflict detection compares exact text and anchors, not meaning.
- Ground stores no document content in Vercel; the runtime is stateless.

See the approved [Ground hosted design](docs/superpowers/specs/2026-09-03-ground-hosted-mvp-design.md)
and [ADR 0004](docs/adr/0004-ground-hosted-supabase-runtime.md) for the complete
system and verification boundary.

## Built on CollabMD

This repository is based on [CollabMD](https://github.com/andes90/collabmd),
copyright 2026 andes90, under the MIT License. The original [`LICENSE`](LICENSE)
is preserved and the `collabmd` command keeps its name and behavior.

Ground reuses CollabMD's CodeMirror editor, Yjs synchronization and convergence,
Participant awareness and cursors, exact-text revision guard, and WebMCP
integration. The added layer governs the supported browser and WebMCP flows; it
is not a new CRDT editor or a general authorization system.

## License

MIT. See [`LICENSE`](LICENSE). CollabMD attribution and its original license
notice are retained.
