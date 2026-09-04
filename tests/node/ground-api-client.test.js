import assert from 'node:assert/strict';
import test from 'node:test';

import { GroundApiClient } from '../../src/client/infrastructure/ground-api-client.js';

const ACCESS_TOKEN = 'fresh-access-token';
const DOCUMENT_ID = 'AbCdEf0123456789_-xyZA';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json' },
  status,
});

const createClient = ({ respond, tokens = [] } = {}) => {
  const calls = [];
  const remaining = [...tokens];
  const authClient = {
    accessTokenCalls: 0,
    accessToken: async () => {
      authClient.accessTokenCalls += 1;
      return remaining.shift() ?? ACCESS_TOKEN;
    },
  };
  const fetchImpl = async (url, options) => {
    calls.push({ options, url });
    return respond ? respond({ options, url }) : jsonResponse({ ok: true });
  };

  return { authClient, calls, client: new GroundApiClient({ authClient, fetchImpl }) };
};

test('posts one operation with a fresh bearer token and JSON headers', async () => {
  const { authClient, calls, client } = createClient({
    respond: () => jsonResponse({ documentId: DOCUMENT_ID }),
  });

  const result = await client.request('create_document', { displayName: 'Owner' });

  assert.deepEqual(result, { documentId: DOCUMENT_ID });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/ground');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    displayName: 'Owner',
    operation: 'create_document',
  });
  assert.equal(authClient.accessTokenCalls, 1);
});

test('reads a fresh session for every request instead of reusing a token', async () => {
  const { authClient, calls, client } = createClient({ tokens: ['first-token', 'second-token'] });

  await client.request('get_session', { documentId: DOCUMENT_ID });
  await client.request('get_session', { documentId: DOCUMENT_ID });

  assert.equal(authClient.accessTokenCalls, 2);
  assert.equal(calls[0].options.headers.authorization, 'Bearer first-token');
  assert.equal(calls[1].options.headers.authorization, 'Bearer second-token');
});

test('never keeps the bearer token on the client instance', async () => {
  const { client } = createClient();

  await client.request('get_session', { documentId: DOCUMENT_ID });

  assert.equal(Object.values(client).includes(ACCESS_TOKEN), false);
  assert.equal(JSON.stringify(client).includes(ACCESS_TOKEN), false);
});

test('maps every documented server error code to a thrown Ground error', async () => {
  const cases = [
    ['GROUND_FORBIDDEN', 403],
    ['GROUND_INVALID_REQUEST', 400],
    ['GROUND_RATE_LIMITED', 429],
    ['GROUND_STALE_STATE', 409],
    ['GROUND_TEMPORARILY_UNAVAILABLE', 503],
    ['GROUND_UNAUTHENTICATED', 401],
    ['GROUND_UNAVAILABLE', 404],
    ['GROUND_UPDATE_TOO_LARGE', 413],
  ];

  for (const [code, status] of cases) {
    const { client } = createClient({ respond: () => jsonResponse({ code }, status) });
    await assert.rejects(
      client.request('append_update', { documentId: DOCUMENT_ID }),
      (error) => error.code === code && error.status === status,
      code,
    );
  }
});

test('maps a failure without a usable code to GROUND_TEMPORARILY_UNAVAILABLE', async () => {
  const { client } = createClient({
    respond: () => new Response('<html>gateway</html>', { status: 502 }),
  });

  await assert.rejects(
    client.request('hydrate_document', { documentId: DOCUMENT_ID }),
    (error) => error.code === 'GROUND_TEMPORARILY_UNAVAILABLE' && error.status === 502,
  );
});

test('maps an unrecognized code string to GROUND_TEMPORARILY_UNAVAILABLE', async () => {
  const { client } = createClient({
    respond: () => jsonResponse({ code: 'SOMETHING_ELSE' }, 500),
  });

  await assert.rejects(
    client.request('hydrate_document', { documentId: DOCUMENT_ID }),
    (error) => error.code === 'GROUND_TEMPORARILY_UNAVAILABLE',
  );
});

test('maps a network failure to GROUND_TEMPORARILY_UNAVAILABLE without a status', async () => {
  const cause = new TypeError('Failed to fetch');
  const client = new GroundApiClient({
    authClient: { accessToken: async () => ACCESS_TOKEN },
    fetchImpl: async () => {
      throw cause;
    },
  });

  await assert.rejects(
    client.request('append_update', { documentId: DOCUMENT_ID }),
    (error) => error.code === 'GROUND_TEMPORARILY_UNAVAILABLE'
      && error.status === undefined
      && error.cause === cause,
  );
});

test('propagates an authentication failure raised before the request', async () => {
  const client = new GroundApiClient({
    authClient: {
      accessToken: async () => {
        throw Object.assign(new Error('gone'), { code: 'GROUND_UNAUTHENTICATED' });
      },
    },
    fetchImpl: async () => {
      throw new Error('fetch must not run without a token');
    },
  });

  await assert.rejects(
    client.request('get_session', { documentId: DOCUMENT_ID }),
    (error) => error.code === 'GROUND_UNAUTHENTICATED',
  );
});

test('returns an empty object for a success response without a JSON body', async () => {
  const { client } = createClient({ respond: () => new Response('', { status: 200 }) });

  assert.deepEqual(await client.request('append_update', { documentId: DOCUMENT_ID }), {});
});
