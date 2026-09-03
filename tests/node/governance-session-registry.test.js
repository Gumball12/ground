import assert from 'node:assert/strict';
import test from 'node:test';

import { GOVERNANCE_CAPABILITIES } from '../../src/domain/governance-contract.js';
import { GovernanceSessionRegistry } from '../../src/server/domain/governance-session-registry.js';

const approvedManifest = {
  roles: {
    owner: [...GOVERNANCE_CAPABILITIES],
    editor: ['document.read', 'document.suggest', 'document.edit'],
    reviewer: ['document.read', 'document.suggest'],
  },
};

const createRegistry = ({ manifest = approvedManifest, now = () => 1_000 } = {}) => {
  let credentialByte = 0;
  return new GovernanceSessionRegistry({
    manifest,
    now,
    randomBytes: () => Buffer.alloc(32, ++credentialByte),
  });
};

test('the first page session is immutable Owner and later sessions are pending', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  assert.equal(registry.getSnapshot(owner.credential).roleId, 'owner');
  assert.deepEqual(registry.getSnapshot(owner.credential).capabilities, GOVERNANCE_CAPABILITIES);
  assert.equal(registry.getSnapshot(writer.credential).state, 'pending');
  assert.deepEqual(registry.getSnapshot(writer.credential).capabilities, []);
  assert.throws(() => registry.assignRole(owner.credential, {
    participantSessionId: owner.participantSessionId,
    roleId: 'editor',
  }), /Owner/);
  assert.throws(() => registry.revoke(owner.credential, owner.participantSessionId), /Owner/);
});

test('snapshots preserve participant join times', () => {
  const clock = { now: 1_000 };
  const registry = createRegistry({ now: () => clock.now });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  clock.now = 2_000;
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  assert.deepEqual(registry.getSnapshot(owner.credential).participants.map((participant) => participant.joinedAt), [1_000, 2_000]);
  assert.equal(registry.getSnapshot(writer.credential).joinedAt, 2_000);
});

test('role assignment remains active until Owner revocation and same Role assignment is idempotent', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  const assigned = registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });
  assert.deepEqual(assigned.transition, {
    action: 'grant_assigned',
    actor: {
      displayName: 'Mina',
      kind: 'human',
      participantSessionId: owner.participantSessionId,
      roleId: 'owner',
    },
    createdAt: 1_000,
    id: `access-${writer.participantSessionId}-3`,
    outcome: 'changed',
    source: 'access_management',
    target: writer.participantSessionId,
  });
  const active = registry.getSnapshot(writer.credential);
  assert.equal(active.state, 'active');
  assert.equal(active.roleId, 'editor');
  assert.equal(Object.hasOwn(active, 'expiresAt'), false);
  assert.deepEqual(active.capabilities, ['document.read', 'document.suggest', 'document.edit']);

  const before = registry.getSnapshot(owner.credential).version;
  const replayedAssignment = registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });
  assert.equal(registry.getSnapshot(owner.credential).version, before);
  assert.deepEqual(replayedAssignment.transition, assigned.transition);

  const revokedResponse = registry.revoke(owner.credential, writer.participantSessionId);
  const revoked = registry.getSnapshot(writer.credential);
  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.roleId, undefined);
  assert.deepEqual(revoked.capabilities, []);
  assert.equal(registry.authorize(writer.credential, {
    capability: 'document.read',
    documentPath: 'README.md',
  }).ok, false);
  assert.equal(revokedResponse.transition.action, 'grant_revoked');
  assert.equal(revokedResponse.transition.actor.participantSessionId, owner.participantSessionId);
  assert.deepEqual(
    registry.revoke(owner.credential, writer.participantSessionId).transition,
    revokedResponse.transition,
  );
});

test('Owner can update a Role and only Owner manages Roles', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  assert.throws(() => registry.assignRole(writer.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'reviewer',
  }), /Owner/);
  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });
  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'reviewer',
  });

  assert.equal(registry.getSnapshot(writer.credential).roleId, 'reviewer');
  assert.deepEqual(registry.getSnapshot(writer.credential).capabilities, ['document.read', 'document.suggest']);
});

test('authorization stays within the credential document room', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });

  assert.deepEqual(registry.authorize(owner.credential, {
    capability: 'document.edit',
    documentPath: 'README.md',
  }), {
    actor: {
      displayName: 'Mina',
      kind: 'human',
      participantSessionId: owner.participantSessionId,
      roleId: 'owner',
    },
    ok: true,
    session: {
      documentPath: 'README.md',
      participantSessionId: owner.participantSessionId,
      roleId: 'owner',
      state: 'active',
    },
  });
  assert.equal(registry.authorize(owner.credential, {
    capability: 'document.edit',
    documentPath: 'other.md',
  }).ok, false);
  assert.equal(registry.authorize('not-a-credential', {
    capability: 'document.read',
    documentPath: 'README.md',
  }).ok, false);
});

test('reset invalidates credentials and restarts room ownership', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const reviewer = registry.createSession({ documentPath: 'README.md', displayName: 'Reviewer', kind: 'ai' });

  registry.reset();

  assert.equal(registry.getSnapshot(owner.credential), undefined);
  assert.equal(registry.getSnapshot(reviewer.credential), undefined);
  const nextOwner = registry.createSession({ documentPath: 'README.md', displayName: 'New owner', kind: 'human' });
  assert.equal(registry.getSnapshot(nextOwner.credential).roleId, 'owner');
});

test('real Role transitions publish the new room version once while replay stays silent', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });
  const events = [];
  const unsubscribe = registry.onAccessChanged((event) => events.push(event));

  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });
  assert.deepEqual(events, [{
    documentPath: 'README.md',
    participantSessionId: writer.participantSessionId,
    version: 3,
  }]);

  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });
  assert.equal(events.length, 1);

  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'reviewer',
  });
  registry.revoke(owner.credential, writer.participantSessionId);
  assert.deepEqual(events.slice(1), [
    {
      documentPath: 'README.md',
      participantSessionId: writer.participantSessionId,
      version: 4,
    },
    {
      documentPath: 'README.md',
      participantSessionId: writer.participantSessionId,
      version: 5,
    },
  ]);

  unsubscribe();
  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });
  assert.equal(events.length, 3);
});

test('connection freshness requires the matching active participant and exact room version', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });
  registry.assignRole(owner.credential, {
    participantSessionId: writer.participantSessionId,
    roleId: 'editor',
  });

  assert.equal(registry.isConnectionCurrent({
    documentPath: 'README.md',
    participantSessionId: writer.participantSessionId,
    version: 3,
  }), true);
  assert.equal(registry.isConnectionCurrent({
    documentPath: 'README.md',
    participantSessionId: 'unknown-session',
    version: 3,
  }), false);
  assert.equal(registry.isConnectionCurrent({
    documentPath: 'other.md',
    participantSessionId: writer.participantSessionId,
    version: 3,
  }), false);
  assert.equal(registry.isConnectionCurrent({
    documentPath: 'README.md',
    participantSessionId: writer.participantSessionId,
    version: 2,
  }), false);
  for (const version of [undefined, '3', Number.NaN, 3.5]) {
    assert.equal(registry.isConnectionCurrent({
      documentPath: 'README.md',
      participantSessionId: writer.participantSessionId,
      version,
    }), false);
  }

  registry.revoke(owner.credential, writer.participantSessionId);
  assert.equal(registry.isConnectionCurrent({
    documentPath: 'README.md',
    participantSessionId: writer.participantSessionId,
    version: 4,
  }), false);
});

test('a throwing access-change listener does not roll back the authoritative Role transition', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });
  const events = [];
  registry.onAccessChanged(() => {
    throw new Error('listener failed');
  });
  registry.onAccessChanged((event) => events.push(event));

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    registry.assignRole(owner.credential, {
      participantSessionId: writer.participantSessionId,
      roleId: 'editor',
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(registry.getSnapshot(writer.credential).roleId, 'editor');
  assert.deepEqual(events, [{
    documentPath: 'README.md',
    participantSessionId: writer.participantSessionId,
    version: 3,
  }]);
});
