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

  return Object.freeze({
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
