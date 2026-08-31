import { expect, it } from 'vitest';

import { GovernanceClient } from '../../src/client/infrastructure/governance-client.js';

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
