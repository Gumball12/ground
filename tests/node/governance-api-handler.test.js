import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { Readable } from 'node:stream';

import { GOVERNANCE_CAPABILITIES } from '../../src/domain/governance-contract.js';
import { GovernanceSessionRegistry } from '../../src/server/domain/governance-session-registry.js';
import { createGovernanceApiHandler } from '../../src/server/infrastructure/http/create-governance-api-handler.js';

const manifest = {
  defaultGrantMinutes: 60,
  roles: {
    owner: [...GOVERNANCE_CAPABILITIES],
    editor: ['document.read', 'document.comment', 'document.suggest', 'document.edit'],
    reviewer: ['document.read', 'document.comment', 'document.suggest'],
  },
};

const createRequest = ({ body, credential, method }) => {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.headers = credential ? { authorization: `Bearer ${credential}` } : {};
  request.method = method;
  return request;
};

const createResponse = () => {
  const response = new EventEmitter();
  response.headers = {};
  response.statusCode = 0;
  response.body = '';
  response.setHeader = (key, value) => { response.headers[key.toLowerCase()] = value; };
  response.getHeader = (key) => response.headers[String(key).toLowerCase()];
  response.writeHead = (statusCode, headers = {}) => {
    response.statusCode = statusCode;
    Object.entries(headers).forEach(([key, value]) => response.setHeader(key, value));
  };
  response.end = (chunk = '') => {
    response.body += String(chunk);
    response.emit('finish');
  };
  return response;
};

const createHarness = () => {
  let byte = 0;
  const registry = new GovernanceSessionRegistry({
    manifest,
    randomBytes: () => Buffer.alloc(32, ++byte),
  });
  const handler = createGovernanceApiHandler({ manifest, registry });

  return {
    async request(method, path, { body, credential } = {}) {
      const request = createRequest({ body, credential, method });
      const response = createResponse();
      await handler(request, response, new URL(path, 'http://localhost'));
      return {
        body: response.body ? JSON.parse(response.body) : null,
        status: response.statusCode,
      };
    },
  };
};

const createTwoSessions = async (harness) => {
  const owner = await harness.request('POST', '/api/governance/session', {
    body: { displayName: 'Mina', documentPath: 'README.md', kind: 'human' },
  });
  const reviewer = await harness.request('POST', '/api/governance/session', {
    body: { displayName: 'Reviewer', documentPath: 'README.md', kind: 'ai' },
  });
  return { owner: owner.body, reviewer: reviewer.body };
};

test('governance sessions use Bearer credentials and never echo them in participant snapshots', async () => {
  const harness = createHarness();
  const response = await harness.request('POST', '/api/governance/session', {
    body: { displayName: 'Mina', documentPath: 'README.md', kind: 'human' },
  });

  assert.equal(response.status, 201);
  assert.equal(typeof response.body.credential, 'string');
  assert.equal(JSON.stringify(response.body.participants).includes(response.body.credential), false);
  assert.equal((await harness.request('GET', '/api/governance/session')).status, 401);
  assert.equal((await harness.request('GET', '/api/governance/session', {
    credential: response.body.credential,
  })).body.roleId, 'owner');
});

test('only Owner can assign and revoke a collaborator Role', async () => {
  const harness = createHarness();
  const { owner, reviewer } = await createTwoSessions(harness);
  const path = `/api/governance/grants/${reviewer.participantSessionId}`;

  assert.equal((await harness.request('PUT', path, {
    body: { expiresInMinutes: 60, roleId: 'editor' },
    credential: reviewer.credential,
  })).status, 403);
  assert.equal((await harness.request('PUT', path, {
    body: { expiresInMinutes: 60, roleId: 'reviewer' },
    credential: owner.credential,
  })).status, 200);
  assert.equal((await harness.request('DELETE', path, {
    credential: owner.credential,
  })).status, 200);
});

test('governance control routes distinguish malformed input and unknown participants', async () => {
  const harness = createHarness();
  const { owner } = await createTwoSessions(harness);

  assert.equal((await harness.request('PUT', '/api/governance/grants/missing', {
    body: { expiresInMinutes: 60, roleId: 'reviewer' },
    credential: owner.credential,
  })).status, 404);
  assert.equal((await harness.request('PUT', '/api/governance/grants/missing', {
    body: { expiresInMinutes: 0, roleId: 'reviewer' },
    credential: owner.credential,
  })).status, 400);
  assert.equal((await harness.request('PUT', '/api/governance/grants/missing', {
    body: { expiresInMinutes: 60, roleId: 'owner' },
    credential: owner.credential,
  })).status, 400);
});

test('governance authorization only accepts a valid Bearer session', async () => {
  const harness = createHarness();
  const { owner } = await createTwoSessions(harness);

  assert.deepEqual((await harness.request('POST', '/api/governance/authorize', {
    body: { capability: 'document.edit', documentPath: 'README.md' },
    credential: owner.credential,
  })).body, { ok: true });
  assert.equal((await harness.request('POST', '/api/governance/authorize', {
    body: { capability: 'document.edit', documentPath: 'README.md' },
  })).status, 401);
});
