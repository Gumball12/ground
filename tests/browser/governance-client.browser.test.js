import { afterEach, expect, it, vi } from 'vitest';

import { GovernanceClient } from '../../src/client/infrastructure/governance-client.js';

const SESSION_STORAGE_KEY = 'collabmd-governance-session';

const governanceSnapshot = (version = 1) => ({
  capabilities: ['document.read', 'document.suggest', 'document.edit'],
  displayName: 'Mina',
  documentPath: 'README.md',
  kind: 'human',
  participantSessionId: 'owner-session',
  participants: [],
  roleId: 'owner',
  state: 'active',
  version,
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  headers: { 'Content-Type': 'application/json' },
  status,
});

const storeSession = (credential = 'stored-credential') => {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    credential,
    documentPath: 'README.md',
    participantSessionId: 'owner-session',
  }));
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('keeps the Window receiver when using the browser native fetch by default', async () => {
  const nativeFetch = globalThis.fetch;
  const responseUrl = `data:application/json,${encodeURIComponent('{"allowed":true}')}`;
  globalThis.fetch = new Proxy(nativeFetch, {
    apply(target, receiver) {
      return Reflect.apply(target, receiver, [responseUrl]);
    },
  });

  try {
    const client = new GovernanceClient();

    await expect(client.authorize('document.read', 'README.md')).resolves.toMatchObject({ allowed: true });
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

it('keeps a stored credential and fails closed on a transient restore failure', async () => {
  storeSession();
  const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Temporary failure' }, 500));
  const client = new GovernanceClient({ fetchImpl, pollIntervalMs: 60_000 });
  const transitions = [];
  client.subscribe((snapshot, transition) => transitions.push({ snapshot, transition }));

  await expect(client.restoreOrCreate({
    displayName: 'Mina',
    documentPath: 'README.md',
    kind: 'human',
  })).rejects.toMatchObject({ code: 'GOVERNANCE_RETRYABLE' });

  expect(fetchImpl).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)).credential).toBe('stored-credential');
  expect(transitions).toEqual([]);
  client.destroy();
});

it('recreates a stored session only after a confirmed invalid credential', async () => {
  storeSession();
  const created = { ...governanceSnapshot(), credential: 'new-credential' };
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ error: 'Invalid governance credential' }, 401))
    .mockResolvedValueOnce(jsonResponse(created, 201));
  const client = new GovernanceClient({ fetchImpl, pollIntervalMs: 60_000 });

  await expect(client.restoreOrCreate({
    displayName: 'Mina',
    documentPath: 'README.md',
    kind: 'human',
  })).resolves.toMatchObject({ participantSessionId: 'owner-session' });

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)).credential).toBe('new-credential');
  client.destroy();
});

it('suppresses equal-version snapshots so polling does not rebuild focused UI', async () => {
  storeSession();
  const fetchImpl = vi.fn(async () => jsonResponse(governanceSnapshot()));
  const client = new GovernanceClient({ fetchImpl, pollIntervalMs: 60_000 });
  const listener = vi.fn();
  client.subscribe(listener);

  await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });
  await client.refresh();

  expect(listener).toHaveBeenCalledOnce();
  client.destroy();
});

it('ignores a stale refresh response after a newer request wins', async () => {
  storeSession();
  const stale = Promise.withResolvers();
  const current = Promise.withResolvers();
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse(governanceSnapshot()))
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(current.promise);
  const client = new GovernanceClient({ fetchImpl, pollIntervalMs: 60_000 });
  const versions = [];
  client.subscribe((snapshot) => versions.push(snapshot?.version));
  await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });

  const staleRefresh = client.refresh();
  const currentRefresh = client.refresh();
  current.resolve(jsonResponse(governanceSnapshot(2)));
  await currentRefresh;
  stale.resolve(jsonResponse(governanceSnapshot(3)));

  await expect(staleRefresh).resolves.toBeNull();
  expect(versions).toEqual([1, 2]);
  expect(client.snapshot.version).toBe(2);
  client.destroy();
});

it('publishes retryable failure and equal-version recovery without discarding credentials', async () => {
  storeSession();
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse(governanceSnapshot()))
    .mockResolvedValueOnce(jsonResponse({ error: 'Temporary failure' }, 503))
    .mockResolvedValueOnce(jsonResponse(governanceSnapshot()));
  const client = new GovernanceClient({ fetchImpl, pollIntervalMs: 60_000 });
  const transitions = [];
  client.subscribe((snapshot, transition) => transitions.push({ snapshot, status: transition.status }));
  await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });

  await expect(client.refresh()).rejects.toMatchObject({ code: 'GOVERNANCE_RETRYABLE' });
  expect(client.snapshot).toBeNull();
  expect(client.credential).toBe('stored-credential');
  await expect(client.refresh()).resolves.toMatchObject({ version: 1 });

  expect(transitions.map(({ snapshot, status }) => [snapshot?.version ?? null, status])).toEqual([
    [1, 'snapshot'],
    [null, 'retryable-error'],
    [1, 'snapshot'],
  ]);
  expect(JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY)).credential).toBe('stored-credential');
  client.destroy();
});

it('publishes invalid-session and removes a credential after a refresh 401', async () => {
  storeSession();
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(jsonResponse(governanceSnapshot()))
    .mockResolvedValueOnce(jsonResponse({ error: 'Invalid governance credential' }, 401));
  const client = new GovernanceClient({ fetchImpl, pollIntervalMs: 60_000 });
  const transitions = [];
  client.subscribe((snapshot, transition) => transitions.push({ snapshot, status: transition.status }));
  await client.restoreOrCreate({ displayName: 'Mina', documentPath: 'README.md', kind: 'human' });

  await expect(client.refresh()).rejects.toMatchObject({ code: 'GOVERNANCE_SESSION_INVALID' });

  expect(client.snapshot).toBeNull();
  expect(client.credential).toBe('');
  expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  expect(transitions.at(-1)).toEqual({ snapshot: null, status: 'invalid-session' });
  client.destroy();
});
