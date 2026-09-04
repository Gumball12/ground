import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import {
  GROUND_COMPACTION_UPDATE_CANDIDATES,
  GROUND_LIMIT_CANDIDATES,
  GROUND_MAX_REQUEST_BYTES,
  GROUND_MAX_UPDATE_BYTES_CEILING,
  GROUND_MEASUREMENT_RUNS,
  GROUND_RATE_LIMITS,
  groundP95,
  measureGroundLimits,
} from '../src/domain/ground-hosted-contract.js';

const UNREACHABLE_MS = Number.MAX_SAFE_INTEGER;

// The deployed boundary rate-limits this runner like any other caller. One
// document per candidate keeps the whole run inside the hourly creation window,
// and appends are spaced so no ten-second window holds more than the mutation
// limit. Samples are repeated reads of that one document.
const CANDIDATE_COUNT = GROUND_LIMIT_CANDIDATES.length + GROUND_COMPACTION_UPDATE_CANDIDATES.length;
const MUTATION_PACE_MS = Math.ceil(
  (GROUND_RATE_LIMITS.mutation.windowSeconds * 1_000) / GROUND_RATE_LIMITS.mutation.limit,
);

// A refused request means the run itself is outside the boundary, so it stops
// instead of recording the refusal as a candidate that failed on its merits.
class RateLimitedError extends Error {}

const rethrowRateLimited = (error) => {
  if (error instanceof RateLimitedError) {
    throw error;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readTarget = () => {
  const flagIndex = process.argv.indexOf('--target');
  const target = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.GROUND_MEASURE_TARGET;
  if (!target) {
    throw new Error('Pass --target <origin> or set GROUND_MEASURE_TARGET.');
  }
  return new URL(target).origin;
};

const createSession = async (target) => {
  const response = await fetch(`${target}/api/ground?operation=config`);
  if (!response.ok) {
    throw new Error(`Config request failed with ${response.status}.`);
  }
  const config = await response.json();
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(`Anonymous sign-in failed: ${error.message}`);
  }
  return data.session.access_token;
};

const createCaller = ({ accessToken, target }) => {
  let largestRequestBytes = 0;

  const call = async (body) => {
    const payload = JSON.stringify(body);
    largestRequestBytes = Math.max(largestRequestBytes, Buffer.byteLength(payload, 'utf8'));
    const response = await fetch(`${target}/api/ground`, {
      body: payload,
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        origin: target,
      },
      method: 'POST',
    });
    const text = await response.text();
    if (response.status === 429) {
      throw new RateLimitedError(`${body.operation} was refused by the rate limit: ${text}`);
    }
    if (!response.ok) {
      throw new Error(`${body.operation} failed with ${response.status}: ${text}`);
    }
    return JSON.parse(text);
  };

  return {
    call,
    // Each candidate is judged on its own largest request body, so the counter
    // resets per candidate instead of leaking one oversized candidate into all.
    takeLargestRequestBytes: () => {
      const observed = largestRequestBytes;
      largestRequestBytes = 0;
      return observed;
    },
  };
};

// The encoded update stays at or under `bytes`, so a chunk sized to the update
// ceiling is accepted rather than refused for a few bytes of framing. The
// framing grows with the length prefix, so a small margin covers that too.
const FRAMING_MARGIN_BYTES = 4;

const encodeSizedUpdate = (bytes) => {
  const encode = (length) => {
    const document = new Y.Doc();
    document.getText('codemirror').insert(0, 'x'.repeat(length));
    return Y.encodeStateAsUpdate(document);
  };
  const framing = encode(1).byteLength - 1 + FRAMING_MARGIN_BYTES;
  return Buffer.from(encode(Math.max(1, bytes - framing))).toString('base64');
};

// A candidate larger than one accepted update is built from several updates,
// each within the update ceiling and spaced at the mutation pace, so document
// sizes above the ceiling can be measured at all.
const appendSizedDocument = async (call, documentId, bytes) => {
  for (let appended = 0; appended < bytes; appended += GROUND_MAX_UPDATE_BYTES_CEILING) {
    await call({
      documentId,
      operation: 'append_update',
      update: encodeSizedUpdate(Math.min(GROUND_MAX_UPDATE_BYTES_CEILING, bytes - appended)),
    });
    await sleep(MUTATION_PACE_MS);
  }
};

const timed = async (work) => {
  const started = performance.now();
  await work();
  return performance.now() - started;
};

const createCalibrationDocument = async (call) => {
  const created = await call({ displayName: 'Calibration', operation: 'create_document' });
  return created.documentId;
};

const timedHydrate = (call, documentId) => timed(() => call({
  documentId,
  operation: 'hydrate_document',
}));

const measureCandidate = async ({ bytes, call, takeLargestRequestBytes }) => {
  const hydrateDurations = [];
  const reconnectDurations = [];
  const failures = [];
  takeLargestRequestBytes();
  let run = 0;

  try {
    const documentId = await createCalibrationDocument(call);
    await appendSizedDocument(call, documentId, bytes);
    for (; run < GROUND_MEASUREMENT_RUNS; run += 1) {
      hydrateDurations.push(await timedHydrate(call, documentId));
      reconnectDurations.push(await timedHydrate(call, documentId));
    }
  } catch (error) {
    rethrowRateLimited(error);
    failures.push({ message: error.message, run });
  }

  return {
    bytes,
    failures,
    hydrateDurations,
    maxRequestBytes: takeLargestRequestBytes(),
    reconnectDurations,
  };
};

const measureReplay = async ({ call, updateCount }) => {
  const durations = [];
  const failures = [];
  const update = encodeSizedUpdate(1_024);
  let run = 0;

  try {
    const documentId = await createCalibrationDocument(call);
    for (let index = 0; index < updateCount; index += 1) {
      await call({ documentId, operation: 'append_update', update });
      await sleep(MUTATION_PACE_MS);
    }
    for (; run < GROUND_MEASUREMENT_RUNS; run += 1) {
      durations.push(await timedHydrate(call, documentId));
    }
  } catch (error) {
    rethrowRateLimited(error);
    failures.push({ message: error.message, run });
  }

  return { durations, failures, updateCount };
};

const run = async () => {
  const target = readTarget();
  if (CANDIDATE_COUNT > GROUND_RATE_LIMITS.create.limit) {
    throw new Error(
      `${CANDIDATE_COUNT} candidates need more documents than the hourly creation limit of `
      + `${GROUND_RATE_LIMITS.create.limit} allows.`,
    );
  }
  const accessToken = await createSession(target);
  const { call, takeLargestRequestBytes } = createCaller({ accessToken, target });

  const rawDocuments = [];
  for (const bytes of GROUND_LIMIT_CANDIDATES) {
    rawDocuments.push(await measureCandidate({ bytes, call, takeLargestRequestBytes }));
  }

  const rawReplays = [];
  for (const updateCount of GROUND_COMPACTION_UPDATE_CANDIDATES) {
    rawReplays.push(await measureReplay({ call, updateCount }));
  }

  const maxRequestBytes = Math.max(...rawDocuments.map((raw) => raw.maxRequestBytes));
  const documentResults = rawDocuments.map((raw) => ({
    bytes: raw.bytes,
    maxRequestBytes: raw.maxRequestBytes,
    p95HydrateMs: raw.hydrateDurations.length > 0
      ? groundP95(raw.hydrateDurations)
      : UNREACHABLE_MS,
    passed: raw.failures.length === 0
      && raw.hydrateDurations.length === GROUND_MEASUREMENT_RUNS
      && raw.reconnectDurations.length === GROUND_MEASUREMENT_RUNS
      && raw.maxRequestBytes < GROUND_MAX_REQUEST_BYTES,
  }));
  const replayResults = rawReplays.map((raw) => ({
    p95ReplayMs: raw.durations.length > 0 ? groundP95(raw.durations) : UNREACHABLE_MS,
    updateCount: raw.updateCount,
  }));

  const report = {
    documentResults,
    maxRequestBytes,
    maxRequestBytesCeiling: GROUND_MAX_REQUEST_BYTES,
    mutationPaceMs: MUTATION_PACE_MS,
    rawDocuments,
    rawReplays,
    replayResults,
    runsPerCandidate: GROUND_MEASUREMENT_RUNS,
    target,
  };

  try {
    report.selected = measureGroundLimits(documentResults, replayResults);
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

try {
  await run();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
