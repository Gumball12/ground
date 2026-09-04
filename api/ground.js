import { GROUND_HOSTED_LIMITS } from '../src/domain/ground-hosted-contract.js';
import { createGroundRuntime } from '../src/server/create-ground-runtime.js';

let runtimePromise;

export default {
  async fetch(request) {
    // Every mutation is bounded by these values and hydration folds its log at
    // the compaction threshold, so a missing limit fails closed rather than
    // accepting an unbounded document. Plan 3 Task 4 replaces them with the
    // measured constants; a measured value can only tighten the byte limits and
    // relax the threshold, so nothing accepted now becomes rejected later.
    runtimePromise ??= createGroundRuntime({
      env: process.env,
      limits: GROUND_HOSTED_LIMITS,
    });
    return (await runtimePromise).fetch(request);
  },
};
