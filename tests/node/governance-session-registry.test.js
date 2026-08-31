import assert from 'node:assert/strict';
import test from 'node:test';

import { GOVERNANCE_CAPABILITIES } from '../../src/domain/governance-contract.js';
import { GovernanceSessionRegistry } from '../../src/server/domain/governance-session-registry.js';

const approvedManifest = {
  defaultGrantMinutes: 60,
  roles: {
    owner: [...GOVERNANCE_CAPABILITIES],
    editor: ['document.read', 'document.comment', 'document.suggest', 'document.edit'],
    reviewer: ['document.read', 'document.comment', 'document.suggest'],
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
  const registry = createRegistry({ now: () => 1_000 });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  assert.equal(registry.getSnapshot(owner.credential).roleId, 'owner');
  assert.deepEqual(registry.getSnapshot(owner.credential).capabilities, GOVERNANCE_CAPABILITIES);
  assert.deepEqual(registry.getSnapshot(writer.credential).capabilities, []);
  assert.equal(registry.getSnapshot(writer.credential).state, 'pending');
  assert.throws(() => registry.assignRole(owner.credential, {
    participantSessionId: owner.participantSessionId,
    roleId: 'editor',
    expiresInMinutes: 1,
  }), /Owner/);
  assert.throws(() => registry.revoke(owner.credential, owner.participantSessionId), /Owner/);
});

test('snapshots expose each Participant authoritative join time', () => {
  const clock = { now: 1_000 };
  const registry = createRegistry({ now: () => clock.now });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  clock.now = 2_000;
  const writer = registry.createSession({ documentPath: 'README.md', displayName: 'Writer', kind: 'ai' });

  const ownerSnapshot = registry.getSnapshot(owner.credential);
  const writerSnapshot = registry.getSnapshot(writer.credential);

  assert.equal(ownerSnapshot.joinedAt, 1_000);
  assert.deepEqual(ownerSnapshot.participants.map((participant) => ({
    joinedAt: participant.joinedAt,
    participantSessionId: participant.participantSessionId,
  })), [
    { joinedAt: 1_000, participantSessionId: owner.participantSessionId },
    { joinedAt: 2_000, participantSessionId: writer.participantSessionId },
  ]);
  assert.equal(writerSnapshot.joinedAt, 2_000);
});

test('snapshots expose capabilities only for the current active Participant', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const reviewer = registry.createSession({ documentPath: 'README.md', displayName: 'Reviewer', kind: 'ai' });
  registry.assignRole(owner.credential, {
    participantSessionId: reviewer.participantSessionId,
    roleId: 'reviewer',
  });

  const snapshot = registry.getSnapshot(reviewer.credential);

  assert.deepEqual(snapshot.capabilities, ['document.read', 'document.comment', 'document.suggest']);
  assert.equal(snapshot.participants.some((participant) => Object.hasOwn(participant, 'capabilities')), false);
});

test('snapshot capabilities follow recomposed and custom manifest roles', () => {
  const registry = createRegistry({
    manifest: {
      defaultGrantMinutes: 60,
      roles: {
        owner: [...GOVERNANCE_CAPABILITIES],
        editor: ['document.read', 'document.comment'],
        observer: ['document.read', 'document.suggest'],
      },
    },
  });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const editor = registry.createSession({ documentPath: 'README.md', displayName: 'Editor', kind: 'ai' });
  const observer = registry.createSession({ documentPath: 'README.md', displayName: 'Observer', kind: 'ai' });
  registry.assignRole(owner.credential, {
    participantSessionId: editor.participantSessionId,
    roleId: 'editor',
  });
  registry.assignRole(owner.credential, {
    participantSessionId: observer.participantSessionId,
    roleId: 'observer',
  });

  assert.deepEqual(registry.getSnapshot(editor.credential).capabilities, [
    'document.read',
    'document.comment',
  ]);
  assert.deepEqual(registry.getSnapshot(observer.credential).capabilities, [
    'document.read',
    'document.suggest',
  ]);
});

test('authorization ignores caller labels and expires collaborator Grants', () => {
  const clock = { now: 1_000 };
  const registry = createRegistry({ now: () => clock.now });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const reviewer = registry.createSession({ documentPath: 'README.md', displayName: 'Reviewer', kind: 'ai' });
  registry.assignRole(owner.credential, {
    participantSessionId: reviewer.participantSessionId,
    roleId: 'reviewer',
    expiresInMinutes: 1,
  });

  assert.equal(registry.authorize(reviewer.credential, {
    capability: 'document.edit',
    documentPath: 'README.md',
    role: 'owner',
    displayName: 'Mina',
    kind: 'human',
  }).ok, false);
  assert.equal(registry.authorize(reviewer.credential, {
    capability: 'document.read',
    documentPath: 'README.md',
  }).ok, true);

  clock.now += 60_001;
  assert.deepEqual(registry.getSnapshot(reviewer.credential).capabilities, []);
  assert.equal(registry.getSnapshot(reviewer.credential).state, 'expired');
  assert.equal(registry.authorize(reviewer.credential, {
    capability: 'document.read',
    documentPath: 'README.md',
  }).ok, false);
});

test('authorization ignores caller-provided time after a Grant expires', () => {
  const clock = { now: 1_000 };
  const registry = createRegistry({ now: () => clock.now });
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const reviewer = registry.createSession({ documentPath: 'README.md', displayName: 'Reviewer', kind: 'ai' });
  registry.assignRole(owner.credential, {
    participantSessionId: reviewer.participantSessionId,
    roleId: 'reviewer',
    expiresInMinutes: 1,
  });

  clock.now += 60_001;

  assert.equal(registry.authorize(reviewer.credential, {
    at: 1_001,
    capability: 'document.read',
    documentPath: 'README.md',
  }).ok, false);
});

test('only the Owner manages roles and revocation updates the room snapshot version', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });
  const editor = registry.createSession({ documentPath: 'README.md', displayName: 'Editor', kind: 'ai' });
  const beforeGrant = registry.getSnapshot(owner.credential).version;

  assert.throws(() => registry.assignRole(editor.credential, {
    participantSessionId: editor.participantSessionId,
    roleId: 'reviewer',
    expiresInMinutes: 1,
  }), /Owner/);

  const granted = registry.assignRole(owner.credential, {
    participantSessionId: editor.participantSessionId,
    roleId: 'editor',
    expiresInMinutes: 1,
  });
  const revoked = registry.revoke(owner.credential, editor.participantSessionId);

  assert.equal(granted.version, beforeGrant + 1);
  assert.equal(revoked.version, granted.version + 1);
  assert.deepEqual(registry.getSnapshot(editor.credential).capabilities, []);
  assert.equal(registry.getSnapshot(editor.credential).state, 'revoked');
  assert.equal(registry.authorize(editor.credential, {
    capability: 'document.read',
    documentPath: 'README.md',
  }).ok, false);
});

test('authorization stays within the credential document room', () => {
  const registry = createRegistry();
  const owner = registry.createSession({ documentPath: 'README.md', displayName: 'Mina', kind: 'human' });

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
