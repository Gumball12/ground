const REQUIRED_VARIABLES = Object.freeze([
  'GROUND_PUBLIC_ORIGIN',
  'GROUND_RATE_LIMIT_HMAC_KEY',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
]);

const LOOPBACK_HOSTNAMES = Object.freeze(['127.0.0.1', 'localhost']);

const readRequired = (env, name) => {
  const value = String(env[name] ?? '').trim();
  if (!value) {
    throw new Error(`${name} is required for the Ground hosted runtime.`);
  }
  return value;
};

const parseAbsoluteUrl = (name, value) => {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
};

const requireSecureUrl = ({ allowLoopback, name, value }) => {
  const url = parseAbsoluteUrl(name, value);
  const loopback = LOOPBACK_HOSTNAMES.includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) {
    throw new Error(`${name} must use https outside loopback development addresses.`);
  }
  return url;
};

const requireOrigin = ({ allowLoopback, name, value }) => {
  const url = requireSecureUrl({ allowLoopback, name, value });
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be a bare origin without a path, query string, or hash.`);
  }
  return url.origin;
};

// Vercel supplies the bare host of the current deployment, of the Git branch
// alias, and of a production domain. A Git push deploys automatically, and the
// URL a reviewer opens for a Preview is the branch alias rather than the
// immutable deployment URL, so all three have to be allowed.
const VERCEL_HOST_VARIABLES = Object.freeze([
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
]);

// Only an exact host becomes an allowed Origin: no suffix matching, no
// wildcard, and nothing a caller can influence.
const platformOrigin = (vercelHost) => {
  const host = typeof vercelHost === 'string' ? vercelHost.trim() : '';
  // `null` is a legal host string but the value browsers send for an opaque
  // Origin, so it must never become an allowed Origin.
  if (host === 'null' || !host.includes('.') || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(host)) {
    return null;
  }
  try {
    const url = new URL(`https://${host}`);
    return url.origin === `https://${host}` ? url.origin : null;
  } catch {
    return null;
  }
};

export const loadGroundHostedEnv = (env = {}) => {
  const values = Object.fromEntries(
    REQUIRED_VARIABLES.map((name) => [name, readRequired(env, name)]),
  );
  const allowLoopback = String(env.NODE_ENV ?? '') !== 'production';
  const publicOrigin = requireOrigin({
    allowLoopback,
    name: 'GROUND_PUBLIC_ORIGIN',
    value: values.GROUND_PUBLIC_ORIGIN,
  });
  requireSecureUrl({
    allowLoopback,
    name: 'SUPABASE_URL',
    value: values.SUPABASE_URL,
  });

  const platformOrigins = VERCEL_HOST_VARIABLES
    .map((name) => platformOrigin(env[name]))
    .filter(Boolean);

  return Object.freeze({
    allowedOrigins: Object.freeze([publicOrigin, ...platformOrigins]
      .filter((origin, index, all) => all.indexOf(origin) === index)),
    publicConfig: Object.freeze({
      groundHosted: true,
      supabasePublishableKey: values.SUPABASE_PUBLISHABLE_KEY,
      supabaseUrl: values.SUPABASE_URL,
    }),
    publicOrigin,
    rateLimitHmacKey: values.GROUND_RATE_LIMIT_HMAC_KEY,
    supabasePublishableKey: values.SUPABASE_PUBLISHABLE_KEY,
    supabaseSecretKey: values.SUPABASE_SECRET_KEY,
    supabaseUrl: values.SUPABASE_URL,
  });
};
