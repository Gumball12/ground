import { createGroundRuntime } from '../src/server/create-ground-runtime.js';

// A deployment that cannot read its configuration is still a Ground deployment.
// Saying so keeps the page from falling back to local CollabMD, which would
// then call a filesystem API this deployment does not serve.
const UNAVAILABLE_CONFIG = Object.freeze({ groundHosted: true, unavailable: true });

const SAFE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/javascript; charset=utf-8',
  'referrer-policy': 'no-referrer',
});

let runtimePromise;

// Only a successful runtime is cached. Caching a rejection would keep answering
// unavailable after the missing variable is supplied.
const loadPublicConfig = async () => {
  try {
    runtimePromise ??= createGroundRuntime({ env: process.env });
    return (await runtimePromise).publicConfig;
  } catch {
    runtimePromise = undefined;
    return UNAVAILABLE_CONFIG;
  }
};

export default {
  async fetch() {
    const config = await loadPublicConfig();
    return new Response(`window.__COLLABMD_CONFIG__ = ${JSON.stringify(config)};\n`, {
      headers: SAFE_HEADERS,
    });
  },
};
