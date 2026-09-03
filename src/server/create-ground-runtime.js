import { loadGroundHostedEnv } from './config/ground-hosted-env.js';
import { createGroundFetchHandler } from './infrastructure/http/create-ground-fetch-handler.js';
import { createGroundAuthVerifier } from './infrastructure/supabase/ground-auth-verifier.js';

export const createGroundRuntime = ({ env, fetchImpl } = {}) => {
  const config = loadGroundHostedEnv(env);
  const handler = createGroundFetchHandler({
    allowedOrigins: [config.publicOrigin],
    authVerifier: createGroundAuthVerifier({
      fetchImpl,
      publishableKey: config.supabasePublishableKey,
      supabaseUrl: config.supabaseUrl,
    }),
    publicConfig: config.publicConfig,
    service: {},
  });

  return { fetch: handler.fetch, publicConfig: config.publicConfig };
};
