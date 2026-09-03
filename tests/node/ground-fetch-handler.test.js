import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GROUND_OPERATIONS,
  createGroundFetchHandler,
} from '../../src/server/infrastructure/http/create-ground-fetch-handler.js';

const ALLOWED_ORIGIN = 'https://ground.test';
const ENDPOINT = 'https://ground.test/api/ground';
const BEARER = 'session-token';

const publicConfig = Object.freeze({
  groundHosted: true,
  supabasePublishableKey: 'sb_publishable_test',
  supabaseUrl: 'https://project.supabase.co',
});

const verifiedAuth = Object.freeze({
  verify: async (token) => {
    assert.equal(token, BEARER);
    return { accessToken: token, userId: 'actor-1' };
  },
});

const groundError = (code) => Object.assign(new Error(code), { code });

const buildHandler = (overrides = {}) => createGroundFetchHandler({
  allowedOrigins: [ALLOWED_ORIGIN],
  authVerifier: verifiedAuth,
  publicConfig,
  service: {},
  ...overrides,
});

const mutationRequest = ({
  body = JSON.stringify({ documentId: 'doc', operation: 'get_session' }),
  headers = {},
} = {}) => new Request(ENDPOINT, {
  body,
  headers: {
    authorization: `Bearer ${BEARER}`,
    'content-type': 'application/json',
    origin: ALLOWED_ORIGIN,
    ...headers,
  },
  method: 'POST',
});

test('returns public config without a bearer session', async () => {
  const handler = createGroundFetchHandler({
    allowedOrigins: [ALLOWED_ORIGIN],
    authVerifier: { verify: async () => assert.fail('must not authenticate config') },
    publicConfig,
    service: {},
  });

  const response = await handler.fetch(new Request(`${ENDPOINT}?operation=config`));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), publicConfig);
});

test('rejects a malformed body, a wrong Origin, and a missing Bearer', async () => {
  const handler = buildHandler({
    service: { get_session: async () => assert.fail('must not reach the service') },
  });

  const cases = [
    { expected: 400, request: mutationRequest({ body: 'not json' }) },
    { expected: 400, request: mutationRequest({ headers: { 'content-type': 'text/plain' } }) },
    { expected: 403, request: mutationRequest({ headers: { origin: 'https://evil.test' } }) },
    { expected: 403, request: mutationRequest({ headers: { origin: 'null' } }) },
    { expected: 401, request: mutationRequest({ headers: { authorization: '' } }) },
    { expected: 401, request: mutationRequest({ headers: { authorization: BEARER } }) },
  ];

  const statuses = [];
  for (const { request } of cases) {
    statuses.push((await handler.fetch(request)).status);
  }
  assert.deepEqual(statuses, cases.map(({ expected }) => expected));
});

test('rejects an unknown operation with 400 without calling the service', async () => {
  let called = false;
  const handler = buildHandler({
    service: new Proxy({}, {
      get: () => {
        called = true;
        return async () => ({});
      },
    }),
  });

  const response = await handler.fetch(mutationRequest({
    body: JSON.stringify({ operation: 'drop_everything' }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'GROUND_INVALID_REQUEST' });
  assert.equal(called, false);
});

test('rejects a GET for any operation other than config', async () => {
  const handler = buildHandler();

  const response = await handler.fetch(new Request(`${ENDPOINT}?operation=hydrate_document`));

  assert.equal(response.status, 400);
});

test('passes the verified actor id and remaining input to the same-named service method', async () => {
  const received = [];
  const handler = buildHandler({
    service: {
      append_update: async (input) => {
        received.push(input);
        return { sequence: 7 };
      },
    },
  });

  const response = await handler.fetch(mutationRequest({
    body: JSON.stringify({ documentId: 'doc-1', operation: 'append_update', update: 'AQI=' }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sequence: 7 });
  assert.deepEqual(received, [{ actorId: 'actor-1', documentId: 'doc-1', update: 'AQI=' }]);
});

test('maps every Ground service error code to its documented status', async () => {
  const expectations = [
    ['GROUND_INVALID_REQUEST', 400],
    ['GROUND_UNAUTHENTICATED', 401],
    ['GROUND_FORBIDDEN', 403],
    ['GROUND_UNAVAILABLE', 404],
    ['GROUND_STALE_STATE', 409],
    ['GROUND_UPDATE_TOO_LARGE', 413],
    ['GROUND_RATE_LIMITED', 429],
    ['GROUND_TEMPORARILY_UNAVAILABLE', 503],
  ];

  const observed = [];
  for (const [code] of expectations) {
    const handler = buildHandler({
      service: { get_session: async () => { throw groundError(code); } },
    });
    const response = await handler.fetch(mutationRequest());
    observed.push([(await response.json()).code, response.status]);
  }

  assert.deepEqual(observed, expectations);
});

test('serializes missing, expired, and inaccessible failures as one GROUND_UNAVAILABLE', async () => {
  const observed = [];
  for (const message of ['missing document', 'expired document', 'inaccessible document']) {
    const handler = buildHandler({
      service: {
        get_session: async () => {
          throw Object.assign(new Error(message), { code: 'GROUND_UNAVAILABLE' });
        },
      },
    });
    const response = await handler.fetch(mutationRequest());
    observed.push([response.status, await response.text()]);
  }

  assert.deepEqual(observed, observed.map(() => [404, '{"code":"GROUND_UNAVAILABLE"}']));
});

test('hides SQL, secret, stack, and recovery hash markers from an unexpected failure', async () => {
  const leak = 'select recovery_token_hash from ground_documents -- sb_secret_leaked';
  const handler = buildHandler({
    service: {
      get_session: async () => { throw new Error(leak); },
    },
  });

  const response = await handler.fetch(mutationRequest());
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(body), { code: 'GROUND_TEMPORARILY_UNAVAILABLE' });
  for (const marker of ['select', 'recovery_token_hash', 'ground_documents', 'sb_secret', 'at ']) {
    assert.equal(body.includes(marker), false);
  }
});

test('sets no-store and no-referrer on config, success, and failure responses', async () => {
  const handler = buildHandler({
    service: { get_session: async () => ({ ok: true }) },
  });

  const responses = [
    await handler.fetch(new Request(`${ENDPOINT}?operation=config`)),
    await handler.fetch(mutationRequest()),
    await handler.fetch(mutationRequest({ body: 'not json' })),
  ];

  assert.deepEqual(responses.map((response) => [
    response.headers.get('cache-control'),
    response.headers.get('referrer-policy'),
  ]), responses.map(() => ['no-store', 'no-referrer']));
});

test('rejects a path outside the Ground endpoint', async () => {
  const handler = buildHandler();

  const response = await handler.fetch(new Request('https://ground.test/api/other?operation=config'));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: 'GROUND_UNAVAILABLE' });
});

test('exposes the closed Ground operation union', () => {
  assert.deepEqual(GROUND_OPERATIONS, [
    'create_document', 'join_document', 'get_session', 'hydrate_document',
    'append_update', 'list_roles', 'list_participants', 'assign_role',
    'revoke_participant', 'recover_owner', 'resolve_proposal',
    'webmcp_read', 'webmcp_apply', 'webmcp_propose',
  ]);
  assert.equal(Object.isFrozen(GROUND_OPERATIONS), true);
});
