import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getClientRuntimeConfig,
  resolveWsBaseUrl,
  resolveWsServerOverride,
} from '../../src/client/domain/runtime-paths.js';

test('getClientRuntimeConfig treats only exact participantKind=ai as AI presentation metadata', () => {
  const originalWindow = globalThis.window;

  try {
    for (const [search, expected] of [
      ['', 'human'],
      ['?participantKind=reviewer', 'human'],
      ['?participantKind=AI', 'human'],
      ['?participantKind=ai', 'ai'],
    ]) {
      globalThis.window = {
        __COLLABMD_CONFIG__: {},
        location: { search },
      };
      assert.equal(getClientRuntimeConfig().participantKind, expected);
    }
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveWsBaseUrl ignores query server overrides outside development and test environments', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {
      environment: 'production',
      wsBasePath: '/ws',
    },
    location: {
      host: 'app.example.test',
      origin: 'https://app.example.test',
      protocol: 'https:',
      search: '?server=wss%3A%2F%2Fevil.example.test%2Fws',
    },
  };

  try {
    assert.equal(resolveWsServerOverride(), '');
    assert.equal(resolveWsBaseUrl(), 'wss://app.example.test/ws');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveWsBaseUrl accepts explicit development server overrides with safe protocols', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {
      environment: 'development',
    },
    location: {
      host: 'app.example.test',
      origin: 'http://app.example.test',
      protocol: 'http:',
      search: '?server=ws%3A%2F%2Flocalhost%3A3000%2Fws%2F',
    },
  };

  try {
    assert.equal(resolveWsServerOverride(), 'ws://localhost:3000/ws');
    assert.equal(resolveWsBaseUrl(), 'ws://localhost:3000/ws');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('resolveWsBaseUrl rejects unsupported query server protocols', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {
      environment: 'test',
      wsBasePath: '/ws',
    },
    location: {
      host: 'app.example.test',
      origin: 'http://app.example.test',
      protocol: 'http:',
      search: '?server=javascript%3Aalert(1)',
    },
  };

  try {
    assert.equal(resolveWsServerOverride(), '');
    assert.equal(resolveWsBaseUrl(), 'ws://app.example.test/ws');
  } finally {
    globalThis.window = originalWindow;
  }
});
