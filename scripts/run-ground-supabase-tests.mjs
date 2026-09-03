import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export const parseSupabaseEnv = (text) => Object.fromEntries(
  text.trim().split('\n').map((line) => {
    const [name, ...parts] = line.split('=');
    return [name, parts.join('=').replace(/^"|"$/gu, '')];
  }),
);

const runSupabase = (arguments_) => spawnSync('supabase', arguments_, {
  encoding: 'utf8',
});

const localStackEnv = () => {
  const result = runSupabase(['status', '-o', 'env']);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Local Supabase is not running. Run npm run supabase:start first.${details ? `\n${details}` : ''}`);
  }

  return parseSupabaseEnv(result.stdout);
};

const resetDatabase = () => {
  const result = runSupabase(['db', 'reset']);
  if (result.status !== 0) {
    throw new Error('Local Supabase database reset failed.');
  }
};

const readTestPaths = async () => (await readdir('tests/supabase', { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => path.join('tests/supabase', entry.name))
  .sort();

const run = async () => {
  const supabaseEnv = localStackEnv();
  resetDatabase();
  const testPaths = await readTestPaths();
  const result = spawnSync(process.execPath, [
    '--test',
    '--test-force-exit',
    ...process.argv.slice(2),
    ...testPaths,
  ], {
    env: {
      ...process.env,
      SUPABASE_URL: supabaseEnv.API_URL,
      SUPABASE_PUBLISHABLE_KEY: supabaseEnv.PUBLISHABLE_KEY ?? supabaseEnv.ANON_KEY,
      SUPABASE_SECRET_KEY: supabaseEnv.SECRET_KEY ?? supabaseEnv.SERVICE_ROLE_KEY,
    },
    encoding: 'utf8',
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    await run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
