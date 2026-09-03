import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGroundService } from './application/ground-document-service.js';
import { loadGroundHostedEnv } from './config/ground-hosted-env.js';
import { validateGovernanceManifest } from './config/governance-manifest.js';
import { createGroundFetchHandler } from './infrastructure/http/create-ground-fetch-handler.js';
import { createGroundAuthVerifier } from './infrastructure/supabase/ground-auth-verifier.js';
import { createGroundSupabaseStore } from './infrastructure/supabase/ground-supabase-store.js';

const readRepoFile = (relativePath) => readFile(
  fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
  'utf8',
);

export const createGroundRuntime = async ({ env, fetchImpl, limits } = {}) => {
  const config = loadGroundHostedEnv(env);
  const [manifestText, initialText] = await Promise.all([
    readRepoFile('collabmd.governance.json'),
    readRepoFile('docs/demo/launch-plan.md'),
  ]);

  const handler = createGroundFetchHandler({
    allowedOrigins: [config.publicOrigin],
    authVerifier: createGroundAuthVerifier({
      fetchImpl,
      publishableKey: config.supabasePublishableKey,
      supabaseUrl: config.supabaseUrl,
    }),
    publicConfig: config.publicConfig,
    service: createGroundService({
      initialText,
      limits: limits ?? {},
      manifest: validateGovernanceManifest(JSON.parse(manifestText)),
      store: createGroundSupabaseStore({
        fetchImpl,
        secretKey: config.supabaseSecretKey,
        supabaseUrl: config.supabaseUrl,
      }),
    }),
  });

  return { fetch: handler.fetch, publicConfig: config.publicConfig };
};
