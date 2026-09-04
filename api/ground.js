import { GROUND_MAX_UPDATE_BYTES_CEILING } from '../src/domain/ground-hosted-contract.js';
import { createGroundRuntime } from '../src/server/create-ground-runtime.js';

let runtimePromise;

export default {
  async fetch(request) {
    // Without an injected byte limit every mutation fails closed with
    // GROUND_TEMPORARILY_UNAVAILABLE. Plan 3 Task 4 replaces this with the
    // measured constant; a measured value can only be smaller than the
    // committed ceiling, so nothing accepted now becomes rejected later.
    runtimePromise ??= createGroundRuntime({
      env: process.env,
      limits: { maxUpdateBytes: GROUND_MAX_UPDATE_BYTES_CEILING },
    });
    return (await runtimePromise).fetch(request);
  },
};
