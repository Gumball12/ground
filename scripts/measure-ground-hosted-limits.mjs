import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import {
  GROUND_COMPACTION_UPDATE_CANDIDATES,
  GROUND_LIMIT_CANDIDATES,
  GROUND_MAX_REQUEST_BYTES,
  GROUND_MEASUREMENT_RUNS,
  groundP95,
  measureGroundLimits,
} from '../src/domain/ground-hosted-contract.js';

const UNREACHABLE_MS = Number.MAX_SAFE_INTEGER;

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

const encodeSizedUpdate = (bytes) => {
  const document = new Y.Doc();
  const text = document.getText('codemirror');
  let update = Y.encodeStateAsUpdate(document);
  while (update.byteLength < bytes) {
    text.insert(text.length, 'x'.repeat(Math.max(1, bytes - update.byteLength)));
    update = Y.encodeStateAsUpdate(document);
  }
  return Buffer.from(update).toString('base64');
};

const timed = async (work) => {
  const started = performance.now();
  await work();
  return performance.now() - started;
};

const measureCandidate = async ({ bytes, call, takeLargestRequestBytes }) => {
  const hydrateDurations = [];
  const reconnectDurations = [];
  const failures = [];
  const update = encodeSizedUpdate(bytes);
  takeLargestRequestBytes();

  for (let run = 0; run < GROUND_MEASUREMENT_RUNS; run += 1) {
    try {
      const created = await call({ displayName: 'Calibration', operation: 'create_document' });
      await call({ documentId: created.documentId, operation: 'append_update', update });
      hydrateDurations.push(await timed(() => call({
        documentId: created.documentId,
        operation: 'hydrate_document',
      })));
      reconnectDurations.push(await timed(() => call({
        documentId: created.documentId,
        operation: 'hydrate_document',
      })));
    } catch (error) {
      failures.push({ message: error.message, run });
    }
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

  for (let run = 0; run < GROUND_MEASUREMENT_RUNS; run += 1) {
    try {
      const created = await call({ displayName: 'Calibration', operation: 'create_document' });
      for (let index = 0; index < updateCount; index += 1) {
        await call({ documentId: created.documentId, operation: 'append_update', update });
      }
      durations.push(await timed(() => call({
        documentId: created.documentId,
        operation: 'hydrate_document',
      })));
    } catch (error) {
      failures.push({ message: error.message, run });
    }
  }

  return { durations, failures, updateCount };
};

const run = async () => {
  const target = readTarget();
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
