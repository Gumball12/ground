import { createGroundRuntime } from '../src/server/create-ground-runtime.js';

let runtimePromise;

export default {
  async fetch(request) {
    runtimePromise ??= createGroundRuntime({ env: process.env });
    return (await runtimePromise).fetch(request);
  },
};
