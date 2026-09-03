import { createGroundRuntime } from '../src/server/create-ground-runtime.js';

let runtimePromise;

export default {
  async fetch() {
    runtimePromise ??= createGroundRuntime({ env: process.env });
    const runtime = await runtimePromise;
    const body = `window.__COLLABMD_CONFIG__ = ${JSON.stringify(runtime.publicConfig)};\n`;
    return new Response(body, {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/javascript; charset=utf-8',
        'referrer-policy': 'no-referrer',
      },
    });
  },
};
