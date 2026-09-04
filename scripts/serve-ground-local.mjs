import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { parseGroundRoute } from '../src/client/domain/ground-route.js';
import { GROUND_MAX_REQUEST_BYTES } from '../src/domain/ground-hosted-contract.js';
import { createGroundRuntime } from '../src/server/create-ground-runtime.js';
import { parseSupabaseEnv } from './run-ground-supabase-tests.mjs';

const run = promisify(execFile);
const clientDir = resolve(import.meta.dirname, '../dist/client');

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
});

// The same headers vercel.json will serve, so the local suite exercises them.
const SECURITY_HEADERS = Object.freeze({
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

// The Supabase CLI is a devDependency, so this resolves through the npm script's
// node_modules/.bin PATH. The env parser is shared with the Supabase test runner.
const readSupabaseEnv = async () => {
  const { stdout } = await run('supabase', ['status', '-o', 'env'], {
    cwd: resolve(import.meta.dirname, '..'),
    maxBuffer: 1024 * 1024,
  });
  return parseSupabaseEnv(stdout);
};

const readBody = (request) => new Promise((settle, fail) => {
  const chunks = [];
  let bytes = 0;
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > GROUND_MAX_REQUEST_BYTES) {
      fail(Object.assign(new Error('GROUND_UPDATE_TOO_LARGE'), { tooLarge: true }));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => settle(Buffer.concat(chunks)));
  request.on('error', fail);
});

const sendFile = async (response, filePath) => {
  const stats = await stat(filePath);
  if (!stats.isFile()) {
    throw new Error('not a file');
  }
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
};

const sendStatus = (response, status, body = '') => {
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
};

const forwardToRuntime = async ({ origin, request, response, runtime, url }) => {
  let body;
  try {
    body = request.method === 'POST' ? await readBody(request) : undefined;
  } catch (error) {
    sendStatus(response, error.tooLarge ? 413 : 400);
    return;
  }

  const groundResponse = await runtime.fetch(new Request(`${origin}${url.pathname}${url.search}`, {
    body,
    headers: [
      // Vercel supplies this header in production. Setting it from the socket
      // keeps the local suite on the same network rate-limit path.
      ['x-forwarded-for', request.socket.remoteAddress ?? '127.0.0.1'],
      ...Object.entries(request.headers)
        .filter(([, value]) => typeof value === 'string')
        .map(([name, value]) => [name, value]),
    ],
    method: request.method,
  }));
  const headers = Object.fromEntries(groundResponse.headers.entries());
  response.writeHead(groundResponse.status, { ...SECURITY_HEADERS, ...headers });
  response.end(Buffer.from(await groundResponse.arrayBuffer()));
};

export const startGroundLocalServer = async ({ host = '127.0.0.1', port = 0 } = {}) => {
  const supabase = await readSupabaseEnv();
  const listening = createServer();
  await new Promise((settle) => listening.listen(port, host, settle));
  const { port: boundPort } = listening.address();
  const origin = `http://${host}:${boundPort}`;

  const runtime = await createGroundRuntime({
    env: {
      GROUND_PUBLIC_ORIGIN: origin,
      GROUND_RATE_LIMIT_HMAC_KEY: 'local-ground-e2e-key',
      NODE_ENV: 'development',
      SUPABASE_PUBLISHABLE_KEY: supabase.SUPABASE_PUBLISHABLE_KEY ?? supabase.ANON_KEY,
      SUPABASE_SECRET_KEY: supabase.SUPABASE_SECRET_KEY ?? supabase.SERVICE_ROLE_KEY,
      SUPABASE_URL: supabase.API_URL,
    },
    // Local runs are not a calibration; Plan 3 Task 4 commits measured limits.
    limits: { compactionUpdateCount: 50, maxDocumentBytes: 200_000, maxUpdateBytes: 64_000 },
    // Every local browser context shares one loopback address, so the frozen
    // hourly create limit would throttle the suite itself. Enforcement of the
    // production numbers is proved by the focused service and Supabase tests.
    rateLimits: {
      create: { limit: 10_000, windowSeconds: 3_600 },
      join: { limit: 10_000, windowSeconds: 3_600 },
      mutation: { limit: 10_000, windowSeconds: 10 },
    },
  });

  listening.on('request', (request, response) => {
    void (async () => {
      const url = new URL(request.url, origin);
      try {
        if (url.pathname === '/api/ground') {
          await forwardToRuntime({ origin, request, response, runtime, url });
          return;
        }
        if (url.pathname === '/app-config.js') {
          response.writeHead(200, {
            ...SECURITY_HEADERS,
            'cache-control': 'no-store',
            'content-type': 'text/javascript; charset=utf-8',
          });
          response.end(`window.__COLLABMD_CONFIG__ = ${JSON.stringify(runtime.publicConfig)};\n`);
          return;
        }

        const route = parseGroundRoute(url.pathname);
        if (route.type !== 'unavailable') {
          await sendFile(response, join(clientDir, 'index.html'));
          return;
        }
        await sendFile(response, join(clientDir, url.pathname.replace(/^\/+/u, '')));
      } catch {
        sendStatus(response, 404, 'Not found');
      }
    })();
  });

  return {
    baseURL: origin,
    close: () => new Promise((settle) => listening.close(settle)),
  };
};

if (import.meta.filename === process.argv[1]) {
  const server = await startGroundLocalServer({ port: Number(process.env.PORT ?? 4321) });
  process.stdout.write(`Ground listening on ${server.baseURL}\n`);
}
