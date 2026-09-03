# Final MVP Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining shipped-UI access invalidation gap, make Role loading explicitly retryable, and give every governance tabpanel an accessible name before merging the focused MVP.

**Architecture:** Reuse the existing WebSocket disconnect and governance refresh path. A real Role transition invalidates only the matching governed document connection; the client freezes immediately, refreshes the authoritative HTTP snapshot, and then clears or recreates the editor. Keep polling as a backstop, keep raw/adversarial Yjs clients out of scope, and reuse the existing actionable Toast rather than adding a new error surface.

**Tech Stack:** Node.js 26, ES modules, Yjs/y-websocket, `ws`, Vitest Browser Mode, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-01-focused-governed-workspace-design.md`

## Global Constraints

- Use Node.js 26 and `npm`; add no dependency.
- Use TDD strictly: run each new behavioral test RED for the expected reason before production changes, then GREEN, then refactor.
- The governance credential must never appear in a page URL, WebSocket URL, lock key, channel name, or localStorage.
- Only the non-secret server-issued `participantSessionId` and integer governance `version` may identify a governed WebSocket for invalidation.
- The server remains authoritative for Role state. WebSocket metadata is invalidation routing metadata, never authorization identity.
- Do not add per-Yjs-update authorization or claim protection from malicious raw Yjs clients.
- Keep the one-second governance poll as missed-event and Pending-to-Active recovery.
- A same-Role assignment remains idempotent and emits no duplicate Activity or invalidation.
- Extend the existing revoke Playwright flow; do not add a seventh governance Evidence test.
- Preserve the Evidence contract: six flows, five named PNG files, meaningful WebM videos, and zero traces.
- Do not update visual snapshots unless inspection proves an intended pixel change.
- Do not implement the deferred deep-link, dead-CSS, release, deployment, account, or persistent-backend work.

---

### Task 1: Invalidate Changed Governed Document Connections

**Files:**
- Modify: `src/server/domain/governance-session-registry.js`
- Modify: `src/server/infrastructure/websocket/attach-collaboration-gateway.js`
- Modify: `src/server/create-app-server.js`
- Modify: `src/client/infrastructure/editor-collaboration-client.js`
- Modify: `src/client/infrastructure/editor-session.js`
- Modify: `src/client/application/app-shell/ui-feature-tab-activity.js`
- Modify: `tests/node/governance-session-registry.test.js`
- Modify: `tests/node/integration/websocket-collaboration.test.js`
- Modify: `tests/browser/ui-feature.browser.test.js`
- Modify: `tests/e2e/governance.spec.js`

**Interfaces:**
- Produces: `GovernanceSessionRegistry.onAccessChanged(listener): () => void`.
- Produces: `GovernanceSessionRegistry.isConnectionCurrent({ documentPath, participantSessionId, version }): boolean`.
- Emits only real state transitions as `{ documentPath, participantSessionId, version }`.
- Governed document WebSockets send query keys `governanceParticipantSessionId` and `governanceVersion`; neither is a credential.
- The gateway closes invalidated/stale governed sockets with code `4403` and reason `Governance access changed`.
- Existing raw/legacy WebSockets with neither governance query key remain unchanged.

- [ ] **Step 1: Write the failing Registry tests**

Add focused tests that create an Owner and Writer with literal data, subscribe with `onAccessChanged`, and assert:

```js
assert.deepEqual(events, [{
  documentPath: 'README.md',
  participantSessionId: writer.participantSessionId,
  version: 3,
}]);
```

The tests must separately prove:

- a real assignment/change/revoke publishes the new room version once;
- replaying the active same Role publishes nothing;
- `isConnectionCurrent` is true only for the matching active participant and exact current version;
- unknown, revoked, malformed-version, wrong-document, and stale-version inputs return false;
- a throwing listener does not roll back the authoritative Role transition.

- [ ] **Step 2: Run the Registry tests and verify RED**

Run:

```bash
node --test tests/node/governance-session-registry.test.js
```

Expected: assertion failures because access-change events and connection freshness do not exist. A syntax/setup error is not an acceptable RED.

- [ ] **Step 3: Implement the minimal Registry behavior**

Follow the existing `HostedWorkspaceService.onAccessChanged` listener pattern: validate listeners, return an unsubscribe function, isolate listener exceptions, and emit only after the room mutation and `version` increment. Do not add an EventEmitter dependency or persist events.

- [ ] **Step 4: Run the Registry tests and verify GREEN**

Run the Step 2 command and require zero failures.

- [ ] **Step 5: Write the failing real WebSocket integration test**

In the existing integration file, use the real test server, governance HTTP endpoints, `WebsocketProvider`, and `ws` polyfill. Establish current Owner and Writer document connections using literal governance query metadata, then assert:

- changing or revoking Writer closes Writer with `4403`;
- Owner stays connected;
- a new Writer connection carrying the pre-transition version receives `4403` before it can synchronize;
- a WebSocket with neither governance query key retains the existing collaboration behavior.

- [ ] **Step 6: Run the WebSocket test and verify RED**

Run:

```bash
node --test tests/node/integration/websocket-collaboration.test.js
```

Expected: the target socket remains connected because the gateway is not subscribed to governance changes.

- [ ] **Step 7: Implement targeted gateway invalidation**

Pass the Registry into `attachCollaborationGateway`. At connection time:

1. Parse the two optional governance query keys.
2. If neither exists, preserve the legacy/raw path.
3. If either exists, require both to be well-formed and current before initializing `ClientSocketSession`; otherwise close with `4403`.
4. Store only the non-secret participant ID and room name with the socket session.
5. On an access-change event, close only sockets matching both document path and participant ID.
6. Unsubscribe when the gateway closes.

Do not inspect Yjs updates and do not close the whole room.

- [ ] **Step 8: Run Registry and WebSocket tests and verify GREEN**

Run:

```bash
node --test tests/node/governance-session-registry.test.js tests/node/integration/websocket-collaboration.test.js
```

- [ ] **Step 9: Write the failing client/E2E regression**

Update the existing revoke E2E instead of adding a test:

1. Keep Writer governance polling stretched from 1 second to 60 seconds.
2. Focus Writer's real CodeMirror content before revocation.
3. Delay Writer's disconnect-triggered `GET /api/governance/session` response.
4. Use Playwright locator click on the visible `Revoke access` button and accept the native confirmation; remove direct DOM `button.click()` and `window.confirm` replacement.
5. After the DELETE succeeds, require the Writer connection to become disconnected and `.cm-content` to become non-editable while the refresh is still delayed.
6. Send real keyboard input and assert both Writer and Owner document text remain unchanged.
7. Release the refresh and require Revoked status, editor removal, content clearing, and cached WebMCP apply denial without page reload.

Add a browser test that a previously inactive tab calls `handleHashChange({ forceGovernance: true })` when reactivated.

- [ ] **Step 10: Run the focused browser/E2E tests and verify RED**

Run:

```bash
npx vitest run --config vitest.config.mjs --browser=chromium tests/browser/ui-feature.browser.test.js
npm run build && npx playwright test tests/e2e/governance.spec.js --grep "Owner revocation reauthorizes cached Writer apply before Revoked cleanup"
```

Expected: the browser activation assertion lacks the force flag and the Writer remains writable while polling is delayed.

- [ ] **Step 11: Pass governance metadata through the supported client**

Capture the current governed snapshot when constructing `EditorCollaborationClient` and supply:

```js
params: {
  governanceParticipantSessionId: snapshot.participantSessionId,
  governanceVersion: String(snapshot.version),
}
```

Only include `params` for a valid governed snapshot. On inactive-tab reactivation, force governance restoration before `WorkspaceCoordinator.openFile` can reuse a cached snapshot. Reuse `EditorSession.freezeForDisconnect()` and `WorkspaceCoordinator.revalidateGovernanceAfterDisconnect()` unchanged unless a failing test proves a missing seam.

- [ ] **Step 12: Run the focused tests and verify GREEN**

Run all commands from Steps 8 and 10. Inspect the revoke video once to confirm the visible button, freeze, and status transition are understandable.

- [ ] **Step 13: Commit Task 1**

```bash
git add src/server/domain/governance-session-registry.js \
  src/server/infrastructure/websocket/attach-collaboration-gateway.js \
  src/server/create-app-server.js \
  src/client/infrastructure/editor-collaboration-client.js \
  src/client/infrastructure/editor-session.js \
  src/client/application/app-shell/ui-feature-tab-activity.js \
  tests/node/governance-session-registry.test.js \
  tests/node/integration/websocket-collaboration.test.js \
  tests/browser/ui-feature.browser.test.js \
  tests/e2e/governance.spec.js
git commit -m "fix: invalidate changed governance sessions"
```

---

### Task 2: Make Role Loading Explicitly Retryable

**Files:**
- Modify: `src/client/application/app-shell/governance-feature.js`
- Modify: `tests/browser/ui-feature.browser.test.js`

**Interfaces:**
- Reuses `ToastController.show(message, { actionLabel, closeOnAction, dismissible, duration, onAction, tone })`.
- Exact public copy: `Access controls could not be loaded.`
- Exact action label: `Retry`.

- [ ] **Step 1: Replace the existing automatic-retry test with an explicit-retry RED test**

The test must assert:

- the first failed Roles request leaves the request count at one;
- a plain `renderGovernanceUi()` does not issue another request;
- the toast is persistent (`duration: 0`), dismissible, error-toned, and has a `Retry` action;
- invoking `onAction` issues exactly one retry and restores the Role map;
- invoking an action captured for an older governance session issues no request in the new session.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run:

```bash
npx vitest run --config vitest.config.mjs --browser=chromium tests/browser/ui-feature.browser.test.js
```

Expected: current code uses a transient string-only toast and retries on a later render.

- [ ] **Step 3: Implement the actionable persistent error**

On failure, keep the attempted session key so unrelated renders do not retry. Show the exact fixed copy with:

```js
{
  actionLabel: 'Retry',
  dismissible: true,
  duration: 0,
  onAction: () => {
    if (this._governanceRolesSessionKey !== rolesSessionKey) {
      return;
    }
    this._governanceRolesAttemptedKey = '';
    void this.loadGovernanceRoles(rolesSessionKey);
  },
  tone: 'error',
}
```

The action clears only the current Roles-attempt key and invokes the existing `loadGovernanceRoles`. Keep `Manage access` and the Owner rail fail-closed through the existing empty Role map. Do not add markup, CSS, timers, or a new state machine.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command and require zero failures.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/client/application/app-shell/governance-feature.js tests/browser/ui-feature.browser.test.js
git commit -m "fix: make role loading retryable"
```

---

### Task 3: Name Governance Tabpanels

**Files:**
- Modify: `src/client/app/index.html`
- Modify: `tests/e2e/ui-visual.spec.js`

**Interfaces:**
- Tab IDs: `governanceReviewTab`, `governanceActivityTab`, `governanceRolesTab`.
- Each matching panel uses `aria-labelledby` with the corresponding tab ID.

- [ ] **Step 1: Write the failing accessible-name assertions**

In the existing focused Owner visual flow, assert the actual application panels have these accessible names:

```js
await expect(ownerPage.locator('#governanceReviewPanel')).toHaveAccessibleName('Review');
await expect(ownerPage.locator('#governanceActivityPanel')).toHaveAccessibleName('Activity');
await expect(ownerPage.locator('#governanceRolesPanel')).toHaveAccessibleName('Roles');
```

- [ ] **Step 2: Run the focused visual test and verify RED**

Run:

```bash
npm run build && npx playwright test tests/e2e/ui-visual.spec.js --grep "matches the focused workspace Owner"
```

Expected: each panel lacks an accessible name.

- [ ] **Step 3: Add static ARIA relationships**

Add the three fixed tab IDs and three `aria-labelledby` attributes in `index.html`. Do not generate IDs in JavaScript and do not change layout or CSS.

- [ ] **Step 4: Run the focused visual test and verify GREEN**

Run the Step 2 command. No screenshot update is expected; if pixels differ, inspect the failure and stop instead of updating blindly.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/client/app/index.html tests/e2e/ui-visual.spec.js
git commit -m "fix: label governance tab panels"
```

---

## Final Verification and Handoff

- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `npm run test:e2e:evidence`.
- [ ] Inspect all five Evidence PNG files and confirm the sixteen WebM files are non-empty and playable.
- [ ] Run `git diff --check main..HEAD` and confirm the feature worktree is otherwise clean.
- [ ] Request a whole-branch code review against `main`; do not merge with an open Critical/Important finding.
- [ ] Reconstruct the full feature history into meaningful English commits while preserving all changes, as separately authorized by the user.
- [ ] Move the two colliding untracked main-checkout design files to a recoverable temporary backup, re-check their content against the branch, and merge locally to `main`.
- [ ] Run `npm test` on merged `main`.
- [ ] Do not push and do not remove the feature worktree or ignored Evidence artifacts.
