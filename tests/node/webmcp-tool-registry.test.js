import assert from 'node:assert/strict';
import test from 'node:test';

import * as Y from 'yjs';

import { EditorSession } from '../../src/client/infrastructure/editor-session.js';
import { WebMcpToolRegistry } from '../../src/client/infrastructure/webmcp-tool-registry.js';

const ORIGINAL_TEXT = '# Notes\n\nHello world\n';

const capabilitiesForRole = (roleId) => ({
  editor: ['document.read', 'document.edit', 'document.suggest'],
  owner: ['document.read', 'document.edit', 'document.suggest'],
  reviewer: ['document.read', 'document.suggest'],
}[roleId] ?? []);

function createModelContext() {
  const tools = new Map();
  return {
    tools,
    async registerTool(tool, { signal }) {
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    },
  };
}

function createRegistryHarness({
  activeFilePath = 'README.md',
  authoritativeActor = null,
  executor = null,
  roleId = 'editor',
  capabilities = capabilitiesForRole(roleId),
  state = 'active',
} = {}) {
  const modelContext = createModelContext();
  const authorizationRequests = [];
  let content = ORIGINAL_TEXT;
  let getTextCalls = 0;
  let initialSyncComplete = true;
  const participantSessionId = 'reviewer-session';
  const governanceClient = {
    snapshot: {
      capabilities,
      displayName: 'Reviewer',
      documentPath: activeFilePath,
      kind: 'ai',
      participantSessionId,
      roleId,
      state,
      version: 1,
    },
    async authorize(capability, path) {
      authorizationRequests.push({ capability, path });
      const snapshot = this.snapshot;
      const actor = authoritativeActor ?? {
        displayName: snapshot.displayName,
        kind: snapshot.kind,
        participantSessionId: snapshot.participantSessionId,
        roleId: snapshot.roleId,
      };
      const authorizedCapabilities = authoritativeActor
        ? capabilitiesForRole(actor.roleId)
        : snapshot.capabilities;
      if (
        snapshot.documentPath !== path
        || snapshot.state !== 'active'
        || !authorizedCapabilities.includes(capability)
      ) {
        return {
          code: 'CAPABILITY_DENIED',
          message: `Missing ${capability}`,
          ok: false,
        };
      }
      return {
        actor,
        ok: true,
        session: {
          documentPath: path,
          participantSessionId: actor.participantSessionId,
          roleId: actor.roleId,
          state: 'active',
        },
      };
    },
  };
  const session = {
    applyGovernedTextEdits({ actor, edits }) {
      for (const { oldText } of edits) {
        assert.equal(content.includes(oldText), true);
      }
      for (const { newText, oldText } of edits) {
        content = content.replace(oldText, newText);
      }
      return { actor, conflictProposals: [], replacementCount: edits.length };
    },
    getText: () => {
      getTextCalls += 1;
      return content;
    },
    isInitialSyncComplete: () => initialSyncComplete,
    proposeTextEdit({ actor, newText, oldText, revision }) {
      return {
        baseRevision: revision,
        createdByDisplayName: actor.displayName,
        createdByKind: actor.kind,
        createdByParticipantSessionId: actor.participantSessionId,
        createdByRole: actor.roleId,
        expectedText: oldText,
        replacementText: newText,
      };
    },
  };
  const registry = new WebMcpToolRegistry({
    executor,
    getActiveFilePath: () => activeFilePath,
    getIsTabActive: () => true,
    getSession: () => session,
    governanceClient,
    modelContext,
  });

  return {
    authorizationRequests,
    documentText: () => content,
    execute: async (name, input, options) => modelContext.tools.get(name).execute(input, options),
    getTextCalls: () => getTextCalls,
    participantSessionId,
    refresh: () => registry.refresh(),
    registered: modelContext.tools,
    registeredNames: () => Array.from(modelContext.tools.keys()).sort(),
    resetTextReadCalls: () => { getTextCalls = 0; },
    setSessionSynchronized: (value) => { initialSyncComplete = value; },
    setRole: async (nextRole, nextState = 'active', nextCapabilities = capabilitiesForRole(nextRole)) => {
      governanceClient.snapshot = {
        ...governanceClient.snapshot,
        capabilities: nextCapabilities,
        roleId: nextRole,
        state: nextState,
        version: governanceClient.snapshot.version + 1,
      };
      await registry.refresh();
    },
  };
}

test('Reviewer sees read and propose but cannot execute a cached apply tool', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  await harness.refresh();
  const cachedApply = harness.registered.get('collabmd_apply_text_edits').execute;
  const snapshot = await harness.execute('collabmd_read_active_document', {});

  await harness.setRole('reviewer');
  assert.deepEqual(harness.registeredNames(), [
    'collabmd_propose_text_edit',
    'collabmd_read_active_document',
  ]);
  await assert.rejects(() => cachedApply({
    path: 'README.md',
    replacements: [{ newText: 'Hello agent', oldText: 'Hello world' }],
    revision: snapshot.revision,
  }), /document\.edit/u);
  assert.equal(harness.documentText(), ORIGINAL_TEXT);
});

test('recomposed Editor tools omit capabilities removed by the manifest', async () => {
  const harness = createRegistryHarness({
    capabilities: ['document.read', 'document.suggest'],
    roleId: 'editor',
  });

  await harness.refresh();

  assert.deepEqual(harness.registeredNames(), [
    'collabmd_propose_text_edit',
    'collabmd_read_active_document',
  ]);
});

test('custom roles expose tools granted by snapshot capabilities', async () => {
  const harness = createRegistryHarness({
    capabilities: ['document.read'],
    roleId: 'observer',
  });

  assert.equal(await harness.refresh(), true);
  assert.deepEqual(harness.registeredNames(), ['collabmd_read_active_document']);
});

test('caller actor and role fields never affect authorization or attribution', async () => {
  const harness = createRegistryHarness({ roleId: 'reviewer' });
  await harness.refresh();
  const snapshot = await harness.execute('collabmd_read_active_document', {});

  const result = await harness.execute('collabmd_propose_text_edit', {
    actorId: 'owner-session',
    newText: 'Hello reviewer',
    oldText: 'Hello world',
    path: 'README.md',
    revision: snapshot.revision,
    role: 'owner',
  });

  assert.equal(result.createdByParticipantSessionId, harness.participantSessionId);
  assert.equal(result.createdByRole, 'reviewer');
  assert.equal(harness.documentText(), ORIGINAL_TEXT);
});

test('server authorization actor overrides stale client Role attribution', async () => {
  const authoritativeActor = {
    displayName: 'Reviewer from server',
    kind: 'ai',
    participantSessionId: 'authoritative-reviewer-session',
    roleId: 'reviewer',
  };
  const harness = createRegistryHarness({ authoritativeActor, roleId: 'owner' });
  await harness.refresh();
  const snapshot = await harness.execute('collabmd_read_active_document', {});

  const result = await harness.execute('collabmd_propose_text_edit', {
    newText: 'Hello reviewer',
    oldText: 'Hello world',
    path: 'README.md',
    revision: snapshot.revision,
  });

  assert.equal(result.createdByDisplayName, 'Reviewer from server');
  assert.equal(result.createdByParticipantSessionId, 'authoritative-reviewer-session');
  assert.equal(result.createdByRole, 'reviewer');
});

test('apply accepts a stale revision when every exact target still matches', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  await harness.refresh();
  const staleSnapshot = await harness.execute('collabmd_read_active_document', {});

  const result = await harness.execute('collabmd_apply_text_edits', {
    path: 'README.md',
    replacements: [{ newText: 'Hello agent', oldText: 'Hello world' }],
    revision: staleSnapshot.revision,
  });

  assert.equal(result.replacementCount, 1);
  assert.equal(harness.documentText(), '# Notes\n\nHello agent\n');
});

test('pending, expired, and revoked snapshots expose no tools', async () => {
  for (const state of ['pending', 'expired', 'revoked']) {
    const harness = createRegistryHarness({ roleId: 'reviewer', state });
    assert.equal(await harness.refresh(), false);
    assert.deepEqual(harness.registeredNames(), []);
  }
});

test('a cached apply tool is denied after revocation without a text mutation', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  await harness.refresh();
  const cachedApply = harness.registered.get('collabmd_apply_text_edits').execute;
  const snapshot = await harness.execute('collabmd_read_active_document', {});

  await harness.setRole('editor', 'revoked');
  await assert.rejects(() => cachedApply({
    path: 'README.md',
    replacements: [{ newText: 'Hello agent', oldText: 'Hello world' }],
    revision: snapshot.revision,
  }), /document\.edit/u);
  assert.equal(harness.documentText(), ORIGINAL_TEXT);
});

test('frozen cached tools authorize before synchronized-document validation', async (t) => {
  const cases = [
    {
      capability: 'document.read',
      errorPattern: /CAPABILITY_DENIED: Missing document\.read/u,
      input: {},
      name: 'collabmd_read_active_document',
    },
    {
      capability: 'document.edit',
      errorPattern: /CAPABILITY_DENIED: Missing document\.edit/u,
      input: {
        path: 'README.md',
        replacements: [{ newText: 'Hello agent', oldText: 'Hello world' }],
        revision: 'stale-revision',
      },
      name: 'collabmd_apply_text_edits',
    },
    {
      capability: 'document.suggest',
      errorPattern: /CAPABILITY_DENIED: Missing document\.suggest/u,
      input: {
        newText: 'Hello reviewer',
        oldText: 'Hello world',
        path: 'README.md',
        revision: 'stale-revision',
      },
      name: 'collabmd_propose_text_edit',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const harness = createRegistryHarness({ roleId: 'editor' });
      await harness.refresh();
      const cachedExecute = harness.registered.get(testCase.name).execute;
      await harness.setRole('editor', 'revoked');
      harness.setSessionSynchronized(false);
      harness.resetTextReadCalls();

      await assert.rejects(
        () => cachedExecute(testCase.input),
        testCase.errorPattern,
      );
      assert.deepEqual(harness.authorizationRequests, [{
        capability: testCase.capability,
        path: 'README.md',
      }]);
      assert.equal(harness.getTextCalls(), 0);
      assert.equal(harness.documentText(), ORIGINAL_TEXT);
    });
  }
});

test('denied cached apply authorizes before reading or validating document-dependent input', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  await harness.refresh();
  const cachedApply = harness.registered.get('collabmd_apply_text_edits').execute;

  await harness.setRole('editor', 'revoked');
  harness.resetTextReadCalls();
  await assert.rejects(() => cachedApply({
    path: 'README.md',
    replacements: Array.from({ length: 21 }, () => ({ newText: 'same', oldText: 'same' })),
    revision: 'stale-revision',
  }), /document\.edit/u);
  assert.equal(harness.getTextCalls(), 0);
});

test('denied cached propose authorizes before reading or validating stale input', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  await harness.refresh();
  const cachedPropose = harness.registered.get('collabmd_propose_text_edit').execute;

  await harness.setRole('editor', 'revoked');
  harness.resetTextReadCalls();
  await assert.rejects(() => cachedPropose({
    newText: 'same',
    oldText: 'same',
    path: 'README.md',
    revision: 'stale-revision',
  }), /document\.suggest/u);
  assert.equal(harness.getTextCalls(), 0);
});

test('governed edits are atomic and create conflicts without changing text', () => {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  ytext.insert(0, 'alpha beta gamma');
  const session = Object.create(EditorSession.prototype);
  session.collaborationClient = {
    commentThreads: ydoc.getArray('comments'),
    governanceActivity: ydoc.getArray('governanceActivity'),
    initialSyncComplete: true,
    ydoc,
    ytext,
  };
  const actor = {
    displayName: 'Writer',
    kind: 'ai',
    participantSessionId: 'writer-session',
    roleId: 'editor',
  };
  const updates = [];
  ydoc.on('update', (update) => updates.push(update));

  const applied = session.applyGovernedTextEdits({
    actor,
    edits: [
      { newText: 'ALPHA', oldText: 'alpha', revision: 'revision-1' },
      { newText: 'GAMMA', oldText: 'gamma', revision: 'revision-1' },
    ],
  });
  assert.equal(applied.replacementCount, 2);
  assert.equal(ytext.toString(), 'ALPHA beta GAMMA');
  assert.deepEqual(session.collaborationClient.governanceActivity.get(0), {
    action: 'text_edits_applied',
    actor,
    createdAt: session.collaborationClient.governanceActivity.get(0).createdAt,
    id: session.collaborationClient.governanceActivity.get(0).id,
    outcome: 'applied',
    source: 'webmcp_apply',
    target: 'document',
  });
  assert.equal(updates.length, 1);

  const conflicted = session.applyGovernedTextEdits({
    actor,
    edits: [
      { newText: 'BETA', oldText: 'beta', revision: 'revision-2' },
      { newText: 'DELTA', oldText: 'delta', revision: 'revision-2' },
    ],
  });
  assert.equal(conflicted.replacementCount, 0);
  assert.equal(ytext.toString(), 'ALPHA beta GAMMA');
  assert.equal(conflicted.conflictProposals.length, 1);
  assert.equal(conflicted.conflictProposals[0].status, 'conflict');
  assert.deepEqual(session.collaborationClient.governanceActivity.toArray().slice(1).map((record) => ({
    action: record.action,
    actor: record.actor,
    outcome: record.outcome,
    target: record.target,
  })), [
    {
      action: 'proposal_created',
      actor,
      outcome: 'conflict',
      target: conflicted.conflictProposals[0].id,
    },
    {
      action: 'text_edits_conflicted',
      actor,
      outcome: 'conflict',
      target: 'document',
    },
  ]);
  assert.equal(updates.length, 2);

  const proposal = session.proposeTextEdit({
    actor: { ...actor, roleId: 'reviewer' },
    newText: 'BETA',
    oldText: 'beta',
    revision: 'revision-3',
  });
  assert.equal(proposal.status, 'open');
  assert.equal(proposal.createdByRole, 'reviewer');
  assert.equal(ytext.toString(), 'ALPHA beta GAMMA');
  assert.deepEqual(session.collaborationClient.governanceActivity.toArray().at(-1), {
    action: 'proposal_created',
    actor: { ...actor, roleId: 'reviewer' },
    createdAt: proposal.createdAt,
    id: session.collaborationClient.governanceActivity.toArray().at(-1).id,
    outcome: 'open',
    source: 'webmcp_proposal',
    target: proposal.id,
  });
  assert.equal(updates.length, 3);
});

function createExecutorFake({ applyPromise, denyApply = false } = {}) {
  const executor = {
    applyCalls: [],
    proposeCalls: [],
    readCalls: [],
    apply: async (input) => {
      executor.applyCalls.push(input);
      if (denyApply) {
        throw Object.assign(new Error('GROUND_FORBIDDEN'), { code: 'GROUND_FORBIDDEN' });
      }
      return applyPromise
        ? applyPromise
        : { replacementCount: input.replacements.length, sequence: 9 };
    },
    propose: async (input) => {
      executor.proposeCalls.push(input);
      return { expectedText: input.oldText, replacementText: input.newText, sequence: 10 };
    },
    read: async (input) => {
      executor.readCalls.push(input);
      return { content: ORIGINAL_TEXT, headSequence: 4, path: input.path };
    },
  };
  return executor;
}

const VALID_EDIT = Object.freeze({
  path: 'README.md',
  replacements: [{ newText: 'Hello Ground', oldText: 'Hello world' }],
  revision: 'server-owned',
});

test('hosted apply waits for the asynchronous executor result', async () => {
  const committed = Promise.withResolvers();
  const executor = createExecutorFake({ applyPromise: committed.promise });
  const harness = createRegistryHarness({ executor, roleId: 'editor' });
  await harness.refresh();

  const execution = harness.execute('collabmd_apply_text_edits', VALID_EDIT);
  let didResolve = false;
  void execution.then(() => {
    didResolve = true;
  });
  await Promise.resolve();

  assert.deepEqual(executor.applyCalls, [VALID_EDIT]);
  assert.equal(didResolve, false);

  committed.resolve({ replacementCount: 1, sequence: 9 });
  const result = await execution;
  assert.equal(result.replacementCount, 1);
  assert.equal(result.sequence, 9);
});

test('hosted read passes the active document id and never reads local text', async () => {
  const executor = createExecutorFake();
  const harness = createRegistryHarness({ executor, roleId: 'editor' });
  await harness.refresh();
  harness.resetTextReadCalls();

  const result = await harness.execute('collabmd_read_active_document', {});

  assert.deepEqual(executor.readCalls, [{ path: 'README.md' }]);
  assert.equal(result.content, ORIGINAL_TEXT);
  assert.equal(harness.getTextCalls(), 0);
});

test('hosted propose leaves local text unchanged until the server applies it', async () => {
  const executor = createExecutorFake();
  const harness = createRegistryHarness({ executor, roleId: 'reviewer' });
  await harness.refresh();

  const result = await harness.execute('collabmd_propose_text_edit', {
    newText: 'Hello Ground',
    oldText: 'Hello world',
    path: 'README.md',
    revision: 'server-owned',
  });

  assert.deepEqual(executor.proposeCalls, [{
    newText: 'Hello Ground',
    oldText: 'Hello world',
    path: 'README.md',
    revision: 'server-owned',
  }]);
  assert.equal(result.sequence, 10);
  assert.equal(harness.documentText(), ORIGINAL_TEXT);
});

test('a cached hosted apply surfaces the server denial after revocation', async () => {
  const executor = createExecutorFake({ denyApply: true });
  const harness = createRegistryHarness({ executor, roleId: 'editor' });
  await harness.refresh();

  await assert.rejects(
    harness.execute('collabmd_apply_text_edits', VALID_EDIT),
    (thrown) => thrown.code === 'GROUND_FORBIDDEN',
  );
  assert.equal(harness.documentText(), ORIGINAL_TEXT);
});

test('omitting the executor keeps the local session implementation', async () => {
  const harness = createRegistryHarness({ roleId: 'editor' });
  await harness.refresh();
  const read = await harness.execute('collabmd_read_active_document', {});

  const result = await harness.execute('collabmd_apply_text_edits', {
    path: 'README.md',
    replacements: [{ newText: 'Hello Ground', oldText: 'Hello world' }],
    revision: read.revision,
  });

  assert.equal(result.replacementCount, 1);
  assert.equal(harness.documentText().includes('Hello Ground'), true);
  assert.equal(harness.authorizationRequests.length > 0, true);
});

test('a hosted document id registers tools without a vault file extension', async () => {
  const executor = createExecutorFake();
  const harness = createRegistryHarness({
    activeFilePath: 'AbCdEf0123456789_-xyZA',
    executor,
    roleId: 'editor',
  });

  assert.equal(await harness.refresh(), true);
  assert.deepEqual(harness.registeredNames(), [
    'collabmd_apply_text_edits',
    'collabmd_propose_text_edit',
    'collabmd_read_active_document',
  ]);

  const read = await harness.execute('collabmd_read_active_document', {});
  assert.equal(read.path, 'AbCdEf0123456789_-xyZA');
});

test('a hosted document still requires an active synchronized session', async () => {
  const harness = createRegistryHarness({
    activeFilePath: 'AbCdEf0123456789_-xyZA',
    executor: createExecutorFake(),
    roleId: 'editor',
  });
  harness.setSessionSynchronized(false);

  assert.equal(await harness.refresh(), false);
  assert.deepEqual(harness.registeredNames(), []);
});

test('a vault path without an executor still requires a supported file kind', async () => {
  const harness = createRegistryHarness({ activeFilePath: 'notes.txt', roleId: 'editor' });

  assert.equal(await harness.refresh(), false);
  assert.deepEqual(harness.registeredNames(), []);
});
