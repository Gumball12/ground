import { createHash, randomBytes as createRandomBytes, randomUUID } from 'node:crypto';

import { hasCapability } from '../../domain/governance-contract.js';

const digestCredential = (credential) => createHash('sha256').update(credential).digest('hex');

const isGrantDuration = (value) => Number.isInteger(value) && value >= 1 && value <= 1440;

export class GovernanceSessionRegistry {
  #credentials = new Map();
  #manifest;
  #now;
  #randomBytes;
  #rooms = new Map();

  constructor({ manifest, now = Date.now, randomBytes = createRandomBytes }) {
    this.#manifest = manifest;
    this.#now = now;
    this.#randomBytes = randomBytes;
  }

  reset() {
    this.#credentials.clear();
    this.#rooms.clear();
  }

  createSession({ documentPath, displayName, kind }) {
    const credential = this.#randomBytes(32).toString('base64url');
    const participantSessionId = randomUUID();
    let room = this.#rooms.get(documentPath);
    const createdAt = this.#now();

    if (room === undefined) {
      room = { documentPath, participants: [], version: 0 };
      this.#rooms.set(documentPath, room);
    }

    const isOwner = room.participants.length === 0;
    const participant = {
      displayName,
      documentPath,
      expiresAt: undefined,
      issuedAt: isOwner ? createdAt : undefined,
      joinedAt: createdAt,
      kind,
      participantSessionId,
      revokedAt: undefined,
      roleId: isOwner ? 'owner' : undefined,
    };
    room.participants.push(participant);
    room.version += 1;
    this.#credentials.set(digestCredential(credential), { documentPath, participantSessionId });

    return { credential, participantSessionId };
  }

  getSnapshot(credential) {
    const session = this.#getSession(credential);
    return session === undefined ? undefined : this.#snapshot(session.room, session.participant, this.#now());
  }

  assignRole(ownerCredential, {
    participantSessionId,
    roleId,
    expiresInMinutes = this.#manifest.defaultGrantMinutes,
  }) {
    const { room } = this.#requireOwner(ownerCredential);
    const participant = room.participants.find((candidate) => candidate.participantSessionId === participantSessionId);

    if (participant === undefined) {
      throw new RangeError('Unknown participant session.');
    }
    if (participant.roleId === 'owner') {
      throw new TypeError('Owner role cannot be reassigned.');
    }
    if (!Object.hasOwn(this.#manifest.roles, roleId) || roleId === 'owner') {
      throw new RangeError('Unknown assignable governance role.');
    }
    if (!isGrantDuration(expiresInMinutes)) {
      throw new RangeError('Grant duration must be an integer between 1 and 1440 minutes.');
    }

    const issuedAt = this.#now();
    participant.expiresAt = issuedAt + (expiresInMinutes * 60_000);
    participant.issuedAt = issuedAt;
    participant.revokedAt = undefined;
    participant.roleId = roleId;
    room.version += 1;
    return this.#snapshot(room, participant, issuedAt);
  }

  revoke(ownerCredential, participantSessionId) {
    const { room } = this.#requireOwner(ownerCredential);
    const participant = room.participants.find((candidate) => candidate.participantSessionId === participantSessionId);

    if (participant === undefined) {
      throw new RangeError('Unknown participant session.');
    }
    if (participant.roleId === 'owner') {
      throw new TypeError('Owner role cannot be revoked.');
    }
    if (participant.roleId === undefined || participant.revokedAt !== undefined) {
      throw new RangeError('Participant has no active grant.');
    }

    const revokedAt = this.#now();
    participant.revokedAt = revokedAt;
    room.version += 1;
    return this.#snapshot(room, participant, revokedAt);
  }

  authorize(credential, { documentPath, capability } = {}) {
    const session = this.#getSession(credential);
    if (session === undefined || session.room.documentPath !== documentPath) {
      return { ok: false };
    }

    const checkedAt = this.#now();
    if (this.#stateOf(session.participant, checkedAt) !== 'active') {
      return { ok: false };
    }

    return { ok: hasCapability(this.#manifest, session.participant.roleId, capability) };
  }

  #getSession(credential) {
    if (typeof credential !== 'string') {
      return undefined;
    }

    const reference = this.#credentials.get(digestCredential(credential));
    if (reference === undefined) {
      return undefined;
    }

    const room = this.#rooms.get(reference.documentPath);
    const participant = room?.participants.find((candidate) => (
      candidate.participantSessionId === reference.participantSessionId
    ));
    return participant === undefined ? undefined : { participant, room };
  }

  #requireOwner(credential) {
    const session = this.#getSession(credential);
    if (session === undefined || session.participant.roleId !== 'owner') {
      throw new TypeError('Owner credential required.');
    }
    return session;
  }

  #snapshot(room, participant, at) {
    const toSnapshotParticipant = (candidate) => ({
      displayName: candidate.displayName,
      expiresAt: candidate.expiresAt,
      joinedAt: candidate.joinedAt,
      kind: candidate.kind,
      participantSessionId: candidate.participantSessionId,
      revokedAt: candidate.revokedAt,
      roleId: candidate.roleId,
      state: this.#stateOf(candidate, at),
    });
    const currentParticipant = toSnapshotParticipant(participant);

    return {
      ...currentParticipant,
      capabilities: currentParticipant.state === 'active'
        ? [...this.#manifest.roles[participant.roleId]]
        : [],
      documentPath: room.documentPath,
      issuedAt: participant.issuedAt,
      participants: room.participants.map(toSnapshotParticipant),
      version: room.version,
    };
  }

  #stateOf(participant, at) {
    if (participant.roleId === undefined) {
      return 'pending';
    }
    if (participant.revokedAt !== undefined) {
      return 'revoked';
    }
    if (participant.expiresAt !== undefined && at >= participant.expiresAt) {
      return 'expired';
    }
    return 'active';
  }
}
