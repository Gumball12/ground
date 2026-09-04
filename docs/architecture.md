# Architecture Boundaries

CollabMD is organized as a modular layered monolith. The goal is to keep
feature code small and easy to move without changing public behavior.

## Local and hosted sources of truth

The same layers serve two products with different durable stores.

- **CollabMD (local)**: the filesystem is the source of truth. A long-lived Node
  process owns the collaboration room, and Roles live only in its memory.
- **Ground (hosted)**: one Supabase project is the source of truth. Postgres
  holds documents, participants, ordered Yjs updates and snapshots; Realtime
  carries sequence and access notices, low-frequency participant Presence, and
  throttled cursor/viewport Broadcasts on a separate awareness topic; Vercel
  Functions stay stateless between requests.

Filesystem and git adapters belong to the local path only. Supabase adapters
belong to the hosted path only. Both compose in thin entry modules
(`src/client/main.js` and `src/client/ground-main.js`) and share `src/domain/`,
the editor, and the governance manifest. See
`docs/adr/0004-ground-hosted-supabase-runtime.md`.

## Layers

- `presentation`: DOM/UI controllers and view-only behavior.
- `application`: workflows, orchestration, state transitions, and use cases.
- `domain`: pure rules, parsing, transformations, and shared value helpers.
- `infrastructure`: browser APIs, HTTP, WebSocket, filesystem, git, and remote services.

## Dependency Direction

Allowed imports should flow inward:

- `presentation` -> `domain` (application behavior is injected)
- `application` -> `domain`
- `infrastructure` -> `application`, `domain`
- `domain` -> `domain`

Current repo structure is still mid-refactor, so the boundary test enforces the
rules that are already durable today:

- `src/domain/**` must not import `src/client/**` or `src/server/**`.
- `src/client/presentation/**` must not import `src/client/application/**` or
  `src/client/infrastructure/**`.
- `src/client/infrastructure/**` must not import `src/client/application/**` or
  `src/client/presentation/**`.
- `src/client/application/**` should not import client `presentation` or
  `infrastructure`.
- `src/server/application/**` should not import server `infrastructure`, `auth`,
  `config`, or client code.
- `src/server/domain/**` must not import `src/server/infrastructure/**`.
- `src/server/auth/**` should not import `src/server/infrastructure/**`.

Bootstrap entrypoints may compose across layers, but should stay thin:

- `src/client/main.js`
- `src/client/bootstrap/**`

## Naming Rules

- Do not place transport or I/O adapters under `domain`.
- Direct remote transport such as `fetch`, WebSocket creation, or server
  endpoint orchestration belongs in `infrastructure` or in thin clients created
  there and injected into `application` / `presentation`.
- Server `application` modules express workflows over injected collaborators.
  They should not construct filesystem, git, HTTP, WebSocket, auth, or config
  adapters directly. If an application workflow needs an auth or config concept,
  move the concept inward or inject it as configuration instead of importing the
  adapter module. Server `application` modules may import pure rules and value
  helpers from `src/server/domain/**` and `src/domain/**`.
- DOM reads/writes are expected in `presentation`, and some `application`
  modules may coordinate DOM-oriented preview workflows, but those modules
  should still receive transport collaborators instead of reaching for network
  APIs directly.
- Keep shared pure helpers under `src/domain/`.
- Prefer feature-specific collaborators over expanding a single shell class.
