import { expect, it } from 'vitest';

import { GroundGovernanceClient } from '../../src/client/infrastructure/ground-governance-client.js';

const DOCUMENT_ID = 'AbCdEf0123456789_-xyZA';
const OTHER_DOCUMENT_ID = 'ZyXwVu9876543210_-abCD';
const USER_ID = 'anonymous-user';

const ROLES = [
  { capabilities: ['document.read', 'document.suggest', 'document.edit', 'grant.manage'], roleId: 'owner' },
  { capabilities: ['document.read', 'document.suggest', 'document.edit'], roleId: 'editor' },
  { capabilities: ['document.read', 'document.suggest'], roleId: 'reviewer' },
];

const sessionOf = ({ capabilities, roleId, state, version = 1 }) => ({
  displayName: 'Visitor',
  documentPath: DOCUMENT_ID,
  participantSessionId: USER_ID,
  roleId,
  state,
  version,
  ...(capabilities ? { capabilities } : {}),
});

const PENDING_SESSION = sessionOf({ roleId: 'pending', state: 'pending' });
const OWNER_SESSION = sessionOf({
  capabilities: ROLES[0].capabilities,
  roleId: 'owner',
  state: 'active',
  version: 2,
});
const REVOKED_SESSION = sessionOf({ roleId: 'revoked', state: 'revoked', version: 3 });

const PARTICIPANTS = [
  { displayName: 'Visitor', participantSessionId: USER_ID, roleId: 'owner', state: 'active', version: 2 },
  { displayName: 'Writer Agent', participantSessionId: 'writer', roleId: 'pending', state: 'pending', version: 0 },
];

const createSupabaseFake = () => {
  const channels = [];
  const fake = {
    channels,
    removedChannels: [],
    channel: (topic, options) => {
      const channel = {
        handlers: new Map(),
        options,
        subscribeCalls: 0,
        topic,
        on: (type, filter, handler) => {
          channel.handlers.set(`${type}:${filter.event}`, handler);
          return channel;
        },
        subscribe: (callback) => {
          channel.subscribeCalls += 1;
          callback?.('SUBSCRIBED');
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: (channel) => {
      fake.removedChannels.push(channel);
    },
  };
  return fake;
};

const createApiFake = (responses = {}) => {
  const calls = [];
  return {
    calls,
    request: async (operation, input) => {
      calls.push({ input, operation });
      const respond = responses[operation];
      if (!respond) {
        throw Object.assign(new Error(operation), { code: 'GROUND_INVALID_REQUEST' });
      }
      return typeof respond === 'function' ? respond(input, calls) : respond;
    },
  };
};

const createClient = (responses, { userId = USER_ID } = {}) => {
  const api = createApiFake({ list_roles: { roles: ROLES }, ...responses });
  const supabase = createSupabaseFake();
  const client = new GroundGovernanceClient({ api, supabase, userId });
  const transitions = [];
  client.subscribe((snapshot, transition) => transitions.push({ snapshot, transition }));
  return { api, client, supabase, transitions };
};

const accessNotice = (supabase, payload) => {
  const channel = supabase.channels.at(-1);
  return channel.handlers.get('broadcast:access')({ payload });
};

it('joins once and publishes a Pending snapshot carrying no kind field', async () => {
  const { api, client, transitions } = createClient({ join_document: { session: PENDING_SESSION } });

  const snapshot = await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(api.calls.filter((call) => call.operation === 'join_document')).toEqual([
    { input: { displayName: 'Visitor', documentId: DOCUMENT_ID }, operation: 'join_document' },
  ]);
  expect(snapshot.state).toBe('pending');
  expect(snapshot.documentPath).toBe(DOCUMENT_ID);
  expect(snapshot.capabilities).toBe(undefined);
  expect('kind' in snapshot).toBe(false);
  expect(snapshot.participants).toEqual([]);
  expect(transitions.at(-1).transition).toMatchObject({
    documentPath: DOCUMENT_ID,
    status: 'snapshot',
  });
});

it('publishes an Active Owner snapshot with capabilities and the participant list', async () => {
  const { api, client } = createClient({
    join_document: { session: OWNER_SESSION },
    list_participants: { participants: PARTICIPANTS },
  });

  const snapshot = await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(snapshot.capabilities).toEqual(OWNER_SESSION.capabilities);
  expect(snapshot.participants).toEqual(PARTICIPANTS);
  expect(api.calls.some((call) => call.operation === 'list_participants')).toBe(true);
});

it('never requests participants without the managing Capability', async () => {
  const { api, client } = createClient({
    join_document: {
      session: sessionOf({
        capabilities: ROLES[2].capabilities,
        roleId: 'reviewer',
        state: 'active',
      }),
    },
  });

  const snapshot = await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(snapshot.participants).toEqual([]);
  expect(api.calls.some((call) => call.operation === 'list_participants')).toBe(false);
});

it('publishes a Revoked snapshot without capabilities or participants', async () => {
  const { client } = createClient({ join_document: { session: REVOKED_SESSION } });

  const snapshot = await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(snapshot.state).toBe('revoked');
  expect(snapshot.capabilities).toBe(undefined);
  expect(snapshot.participants).toEqual([]);
});

it('exposes the manifest Roles reported by the server as a capability map', async () => {
  const { client } = createClient({ join_document: { session: PENDING_SESSION } });

  await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(client.roles).toEqual({
    editor: ROLES[1].capabilities,
    owner: ROLES[0].capabilities,
    reviewer: ROLES[2].capabilities,
  });
});

it('suppresses a response that resolves after the document changed', async () => {
  let releaseFirstJoin;
  const { client, transitions } = createClient({
    join_document: async (input) => {
      if (input.documentId === DOCUMENT_ID) {
        await new Promise((resolve) => {
          releaseFirstJoin = resolve;
        });
        return { session: PENDING_SESSION };
      }
      return { session: sessionOf({ roleId: 'pending', state: 'pending' }) };
    },
  });

  const abandoned = client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });
  await client.start({ displayName: 'Visitor', docId: OTHER_DOCUMENT_ID });
  const publishedAfterSecondStart = transitions.length;
  releaseFirstJoin();

  await expect(abandoned).resolves.toBe(null);
  expect(transitions.length).toBe(publishedAfterSecondStart);
});

it('ignores a refreshed snapshot whose role version moved backwards', async () => {
  const { client, transitions } = createClient({
    get_session: () => ({ session: sessionOf({ roleId: 'pending', state: 'pending', version: 1 }) }),
    join_document: { session: OWNER_SESSION },
    list_participants: { participants: PARTICIPANTS },
  });
  await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });
  const publishedAfterStart = transitions.length;

  expect(await client.refresh()).toBe(null);
  expect(transitions.length).toBe(publishedAfterStart);
});

it('refreshes only for a personal access notice about the open document', async () => {
  const { api, client, supabase } = createClient({
    get_session: { session: REVOKED_SESSION },
    join_document: { session: OWNER_SESSION },
    list_participants: { participants: PARTICIPANTS },
  });
  await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(supabase.channels.at(-1).topic).toBe(`ground-access:${USER_ID}`);
  expect(supabase.channels.at(-1).options).toEqual({ config: { private: true } });

  await accessNotice(supabase, { accessState: 'active', documentId: OTHER_DOCUMENT_ID });
  expect(api.calls.some((call) => call.operation === 'get_session')).toBe(false);

  await accessNotice(supabase, { accessState: 'revoked', documentId: DOCUMENT_ID });
  expect(api.calls.some((call) => call.operation === 'get_session')).toBe(true);
  expect(client.snapshot.state).toBe('revoked');
});

// The hydration protocol subscribes and waits for the acknowledgement before it
// fetches. An assignment made between the join and the subscription would
// otherwise be announced to no one, leaving the participant Pending until a
// reload.
it('subscribes to the personal access channel and waits for it before joining', async () => {
  const order = [];
  const { client, supabase } = createClient({
    join_document: () => {
      order.push('join');
      return { session: PENDING_SESSION };
    },
  });
  const openChannel = supabase.channel;
  supabase.channel = (...args) => {
    const channel = openChannel(...args);
    const subscribe = channel.subscribe;
    channel.subscribe = (callback) => {
      order.push('subscribe');
      return subscribe(callback);
    };
    return channel;
  };

  await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(order).toEqual(['subscribe', 'join']);
});

it('applies an access notice that lands while the join request is in flight', async () => {
  const { client, supabase } = createClient({
    get_session: { session: OWNER_SESSION },
    join_document: async () => {
      await accessNotice(supabase, { accessState: 'active', documentId: DOCUMENT_ID });
      return { session: PENDING_SESSION };
    },
    list_participants: { participants: PARTICIPANTS },
  });

  const snapshot = await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  expect(snapshot.state).toBe('active');
  expect(client.snapshot.state).toBe('active');
});

it('routes Owner decisions through the documented operations', async () => {
  const { api, client } = createClient({
    assign_role: { sequence: 9, session: OWNER_SESSION },
    get_session: { session: OWNER_SESSION },
    join_document: { session: OWNER_SESSION },
    list_participants: { participants: PARTICIPANTS },
    recover_owner: { recoveryToken: 'rotated-token', sequence: 12 },
    resolve_proposal: { sequence: 11 },
    revoke_participant: { sequence: 10, session: OWNER_SESSION },
  });
  await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });

  await client.assignRole({ roleId: 'editor', targetUserId: 'writer' });
  await client.revoke({ targetUserId: 'writer' });
  await client.resolveProposal({ proposalId: 'proposal-1', resolution: 'accept' });
  const recovery = await client.recover({ displayName: 'Owner', recoveryToken: 'token' });

  expect(api.calls.map((call) => call.operation)).toEqual(expect.arrayContaining([
    'assign_role',
    'revoke_participant',
    'resolve_proposal',
    'recover_owner',
  ]));
  expect(api.calls.find((call) => call.operation === 'assign_role').input).toEqual({
    documentId: DOCUMENT_ID,
    expectedOwnerVersion: OWNER_SESSION.version,
    roleId: 'editor',
    targetUserId: 'writer',
  });
  expect(recovery.recoveryToken).toBe('rotated-token');
});

// Recovery runs before any session exists, so the client cannot fall back to a
// document id that only `start` would have captured.
it('sends the document id when recovering before any session has started', async () => {
  const { api, client } = createClient({
    recover_owner: { recoveryToken: 'rotated-token', sequence: 12 },
  });

  await client.recover({ displayName: 'Owner', docId: DOCUMENT_ID, recoveryToken: 'token' });

  expect(api.calls.find((call) => call.operation === 'recover_owner').input).toEqual({
    displayName: 'Owner',
    documentId: DOCUMENT_ID,
    recoveryToken: 'token',
  });
});

it('publishes a stable failure transition and keeps no snapshot', async () => {
  const { client, transitions } = createClient({
    join_document: () => {
      throw Object.assign(new Error('nope'), { code: 'GROUND_UNAVAILABLE' });
    },
  });

  await expect(client.start({ displayName: 'Visitor', docId: DOCUMENT_ID }))
    .rejects.toMatchObject({ code: 'GROUND_UNAVAILABLE' });
  expect(client.snapshot).toBe(null);
  expect(transitions.at(-1).snapshot).toBe(null);
  expect(transitions.at(-1).transition).toMatchObject({
    documentPath: DOCUMENT_ID,
    status: 'unavailable',
  });
});

it('removes the access channel and stops publishing after destroy', async () => {
  const { client, supabase, transitions } = createClient({
    get_session: { session: OWNER_SESSION },
    join_document: { session: OWNER_SESSION },
    list_participants: { participants: PARTICIPANTS },
  });
  await client.start({ displayName: 'Visitor', docId: DOCUMENT_ID });
  const channel = supabase.channels.at(-1);
  const publishedBeforeDestroy = transitions.length;

  client.destroy();

  expect(supabase.removedChannels).toEqual([channel]);
  expect(client.snapshot).toBe(null);
  expect(await client.refresh()).toBe(null);
  expect(transitions.length).toBe(publishedBeforeDestroy);
});
