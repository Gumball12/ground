import { createHash, randomBytes as createRandomBytes, randomUUID } from 'node:crypto';

import { hasCapability } from '../../domain/governance-contract.js';

const digestCredential = (credential) => createHash('sha256').update(credential).digest('hex');

const actorFromParticipant = (participant) => ({
  displayName: participant.displayName,
  kind: participant.kind,
  participantSessionId: participant.participantSessionId,
  roleId: participant.roleId,
});

export class GovernanceSessionRegistry {
  #accessListeners = new Set();
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

  onAccessChanged(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.#accessListeners.add(listener);
    return () => this.#accessListeners.delete(listener);
  }

  isConnectionCurrent({ documentPath, participantSessionId, version } = {}) {
    if (!Number.isSafeInteger(version)) {
      return false;
    }

    const room = this.#rooms.get(documentPath);
    if (room === undefined || room.version !== version) {
      return false;
    }

    const participant = room.participants.find((candidate) => (
      candidate.participantSessionId === participantSessionId
    ));
    return participant !== undefined && this.#stateOf(participant) === 'active';
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
      issuedAt: isOwner ? createdAt : undefined,
      joinedAt: createdAt,
      kind,
      lastAccessTransition: undefined,
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
    return session === undefined ? undefined : this.#snapshot(session.room, session.participant);
  }

  assignRole(ownerCredential, {
    participantSessionId,
    roleId,
  }) {
    const { participant: owner, room } = this.#requireOwner(ownerCredential);
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
    if (this.#stateOf(participant) === 'active' && participant.roleId === roleId) {
      return this.#transitionResponse(room, participant, participant.lastAccessTransition);
    }

    const action = this.#stateOf(participant) === 'active' ? 'grant_changed' : 'grant_assigned';
    const issuedAt = this.#now();
    participant.issuedAt = issuedAt;
    participant.revokedAt = undefined;
    participant.roleId = roleId;
    room.version += 1;
    participant.lastAccessTransition = this.#createAccessTransition({
      action,
      actor: owner,
      createdAt: issuedAt,
      outcome: 'changed',
      room,
      target: participant,
    });
    this.#emitAccessChanged(room, participant);
    return this.#transitionResponse(room, participant, participant.lastAccessTransition);
  }

  revoke(ownerCredential, participantSessionId) {
    const { participant: owner, room } = this.#requireOwner(ownerCredential);
    const participant = room.participants.find((candidate) => candidate.participantSessionId === participantSessionId);

    if (participant === undefined) {
      throw new RangeError('Unknown participant session.');
    }
    if (participant.roleId === 'owner') {
      throw new TypeError('Owner role cannot be revoked.');
    }
    if (this.#stateOf(participant) === 'revoked'
      && participant.lastAccessTransition?.action === 'grant_revoked') {
      return this.#transitionResponse(room, participant, participant.lastAccessTransition);
    }
    if (participant.roleId === undefined) {
      throw new RangeError('Participant has no active grant.');
    }

    const revokedAt = this.#now();
    participant.revokedAt = revokedAt;
    participant.roleId = undefined;
    room.version += 1;
    participant.lastAccessTransition = this.#createAccessTransition({
      action: 'grant_revoked',
      actor: owner,
      createdAt: revokedAt,
      outcome: 'revoked',
      room,
      target: participant,
    });
    this.#emitAccessChanged(room, participant);
    return this.#transitionResponse(room, participant, participant.lastAccessTransition);
  }

  authorize(credential, { documentPath, capability } = {}) {
    const session = this.#getSession(credential);
    if (session === undefined || session.room.documentPath !== documentPath) {
      return { ok: false };
    }

    const state = this.#stateOf(session.participant);
    const sessionMetadata = {
      documentPath: session.room.documentPath,
      participantSessionId: session.participant.participantSessionId,
      roleId: session.participant.roleId,
      state,
    };
    if (state !== 'active') {
      return { ok: false, session: sessionMetadata };
    }

    return {
      actor: actorFromParticipant(session.participant),
      ok: hasCapability(this.#manifest, session.participant.roleId, capability),
      session: sessionMetadata,
    };
  }

  #createAccessTransition({ action, actor, createdAt, outcome, room, target }) {
    return Object.freeze({
      action,
      actor: Object.freeze(actorFromParticipant(actor)),
      createdAt,
      id: `access-${target.participantSessionId}-${room.version}`,
      outcome,
      source: 'access_management',
      target: target.participantSessionId,
    });
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

  #emitAccessChanged(room, participant) {
    const event = {
      documentPath: room.documentPath,
      participantSessionId: participant.participantSessionId,
      version: room.version,
    };
    for (const listener of this.#accessListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[governance] Access-change listener failed:', error.message);
      }
    }
  }

  #requireOwner(credential) {
    const session = this.#getSession(credential);
    if (session === undefined || session.participant.roleId !== 'owner') {
      throw new TypeError('Owner credential required.');
    }
    return session;
  }

  #snapshot(room, participant) {
    const toSnapshotParticipant = (candidate) => ({
      displayName: candidate.displayName,
      joinedAt: candidate.joinedAt,
      kind: candidate.kind,
      participantSessionId: candidate.participantSessionId,
      revokedAt: candidate.revokedAt,
      roleId: candidate.roleId,
      state: this.#stateOf(candidate),
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

  #transitionResponse(room, participant, transition) {
    return {
      ...this.#snapshot(room, participant),
      transition,
    };
  }

  #stateOf(participant) {
    if (participant.revokedAt !== undefined) {
      return 'revoked';
    }
    if (participant.roleId === undefined) {
      return 'pending';
    }
    return 'active';
  }
}
