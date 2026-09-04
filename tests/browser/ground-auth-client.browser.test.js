import { expect, it } from 'vitest';

import { GroundAuthClient } from '../../src/client/infrastructure/ground-auth-client.js';

const EXISTING_SESSION = { access_token: 'existing-token', user: { id: 'existing-user' } };
const CREATED_SESSION = { access_token: 'created-token', user: { id: 'created-user' } };

const createSupabaseAuthFake = ({
  getSessionError,
  session = null,
  setAuthError,
  signInError,
} = {}) => {
  const fake = {
    getSessionCalls: 0,
    realtimeAuthCalls: [],
    signInAnonymouslyCalls: 0,
  };
  let current = session;

  fake.auth = {
    getSession: async () => {
      fake.getSessionCalls += 1;
      return getSessionError
        ? { data: { session: null }, error: getSessionError }
        : { data: { session: current }, error: null };
    },
    signInAnonymously: async () => {
      fake.signInAnonymouslyCalls += 1;
      if (signInError) {
        return { data: { session: null }, error: signInError };
      }
      current = CREATED_SESSION;
      return { data: { session: current }, error: null };
    },
  };
  fake.realtime = {
    setAuth: async (token) => {
      fake.realtimeAuthCalls.push(token);
      if (setAuthError) {
        throw setAuthError;
      }
    },
  };

  return fake;
};

it('restores an existing anonymous session without creating another', async () => {
  const supabase = createSupabaseAuthFake({ session: EXISTING_SESSION });
  const client = new GroundAuthClient({ supabase });

  const result = await client.initialize();

  expect(result.userId).toBe(EXISTING_SESSION.user.id);
  expect(result.accessToken).toBe(EXISTING_SESSION.access_token);
  expect(result.supabase).toBe(supabase);
  expect(supabase.signInAnonymouslyCalls).toBe(0);
  expect(supabase.realtimeAuthCalls).toEqual([EXISTING_SESSION.access_token]);
});

it('creates one anonymous session when none exists and authorizes Realtime with its token', async () => {
  const supabase = createSupabaseAuthFake({ session: null });
  const client = new GroundAuthClient({ supabase });

  const result = await client.initialize();

  expect(supabase.signInAnonymouslyCalls).toBe(1);
  expect(result.userId).toBe(CREATED_SESSION.user.id);
  expect(supabase.realtimeAuthCalls).toEqual([CREATED_SESSION.access_token]);
});

it('initializes only once for concurrent and repeated callers', async () => {
  const supabase = createSupabaseAuthFake({ session: null });
  const client = new GroundAuthClient({ supabase });

  const [first, second] = await Promise.all([client.initialize(), client.initialize()]);
  const third = await client.initialize();

  expect(supabase.signInAnonymouslyCalls).toBe(1);
  expect(first.userId).toBe(CREATED_SESSION.user.id);
  expect(second.userId).toBe(CREATED_SESSION.user.id);
  expect(third.userId).toBe(CREATED_SESSION.user.id);
});

it('reads a fresh session for every access token request', async () => {
  const supabase = createSupabaseAuthFake({ session: EXISTING_SESSION });
  const client = new GroundAuthClient({ supabase });
  await client.initialize();
  const callsAfterInitialize = supabase.getSessionCalls;

  expect(await client.accessToken()).toBe(EXISTING_SESSION.access_token);
  expect(await client.accessToken()).toBe(EXISTING_SESSION.access_token);
  expect(supabase.getSessionCalls).toBe(callsAfterInitialize + 2);
});

it('rejects an access token request once the session is gone', async () => {
  const supabase = createSupabaseAuthFake({ session: EXISTING_SESSION });
  const client = new GroundAuthClient({ supabase });
  await client.initialize();
  supabase.auth.getSession = async () => ({ data: { session: null }, error: null });

  await expect(client.accessToken()).rejects.toMatchObject({ code: 'GROUND_UNAUTHENTICATED' });
});

it.each([
  ['getSession', { getSessionError: new Error('get failed') }],
  ['signInAnonymously', { signInError: new Error('sign-in failed') }],
  ['realtime.setAuth', { setAuthError: new Error('set auth failed') }],
])('rejects a %s failure without publishing an identity', async (_label, failure) => {
  const supabase = createSupabaseAuthFake(failure);
  const client = new GroundAuthClient({ supabase });

  await expect(client.initialize()).rejects.toMatchObject({ code: 'GROUND_UNAUTHENTICATED' });
  expect(client.identity).toBe(undefined);
});

it('retries initialization after a failure instead of caching the rejection', async () => {
  const supabase = createSupabaseAuthFake({
    session: EXISTING_SESSION,
    setAuthError: new Error('set auth failed'),
  });
  const client = new GroundAuthClient({ supabase });
  await expect(client.initialize()).rejects.toMatchObject({ code: 'GROUND_UNAUTHENTICATED' });

  supabase.realtime.setAuth = async (token) => {
    supabase.realtimeAuthCalls.push(token);
  };

  await expect(client.initialize()).resolves.toMatchObject({ userId: EXISTING_SESSION.user.id });
  expect(client.identity?.userId).toBe(EXISTING_SESSION.user.id);
});
