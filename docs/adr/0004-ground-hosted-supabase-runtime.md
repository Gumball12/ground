# Supabase owns Ground's durable state and Vercel stays stateless

Ground stores every durable document fact in one hosted Supabase project:
Postgres for documents, participants, ordered Yjs updates and snapshots;
anonymous Auth for the invisible session that identifies a participant;
Realtime for private per-document sequence notices and per-participant access
notices, participant Presence, and ephemeral cursor/viewport Broadcasts; and
Cron for the scheduled retention sweep. Vercel runs the Vite build and two
stateless Functions and keeps no document state, no room registry, and no
session memory between requests.

This is the decision that lets a Role outlive a restart. CollabMD's local
product keeps Roles in the memory of one long-lived Node process, so a restart
clears them; that is acceptable for a folder on someone's machine and
unacceptable for a link someone shares.

**Ordered updates, not a Yjs server.** A commit appends one row to an ordered
update log and returns its sequence before Realtime announces it. A client
subscribes, hydrates, then confirms it has no gap. A reconnect repeats that
hydration rather than trusting Broadcast replay, because Broadcast is not
retained. Compaction folds a prefix of the log into a snapshot. Ground therefore
needs no stateful websocket server, which is what makes a stateless function
runtime viable.

**Presence is not cursor transport.** The private `ground-document:<docId>`
topic uses Presence only for low-frequency participant identity and online
state. Cursor and viewport Awareness is coalesced and sent on the separate
private `ground-awareness:<docId>` Broadcast topic. Awareness remains ephemeral,
never advances the document sequence, and never participates in authorization.

**Authorization lives in the database and the server.** Row-level security
scopes every table to the participant's own document, and the mutating functions
are service-only, so a browser key cannot reach them. The Functions reauthorize
every WebMCP execution against `collabmd.governance.json` before committing,
which is why a tool cached before a revoke is still refused.

**Considered Options**

- A stateful Node server with a websocket room, as the local product uses. It is
  simpler and already written, but it pins the product to one instance, loses
  every Role on restart, and needs a host that keeps a process alive.
- Vercel with an external realtime vendor and a separate database. It splits
  authorization between two systems and gives the browser a second credential to
  hold, for no capability Supabase does not already provide.
- Storing the document as a file in a git repository, as CollabMD does. Git has
  no per-row authorization and no transactional revocation, and a shared link
  would expose repository access.

**Consequences**

- The supported deployment is a single hosted Supabase project. Ground makes no
  cross-replica room claims.
- The recovery token is the only way back to Ownership. Its hash is stored, the
  raw value is returned once, and it travels in a URL fragment so it never
  reaches a server log.
- Document rows are deleted thirty days after the last accepted change.
- Vercel Functions must receive an explicit update byte limit; without one they
  fail closed rather than accept an unbounded write.

ADRs 0001, 0002, and 0003 are not superseded. They describe CollabMD's local and
single-tenant hosted workspace, which this repository still ships and tests.
This record covers Ground only, and the two products keep separate sources of
truth by design.
