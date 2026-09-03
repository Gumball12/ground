import { createClient } from '@supabase/supabase-js';

const unauthenticated = () => Object.assign(
  new Error('GROUND_UNAUTHENTICATED'),
  { code: 'GROUND_UNAUTHENTICATED' },
);

export const createGroundAuthVerifier = ({ fetchImpl, publishableKey, supabaseUrl }) => {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });

  return {
    verify: async (bearerToken) => {
      if (!bearerToken) {
        throw unauthenticated();
      }

      const { data, error } = await client.auth.getUser(bearerToken);
      if (error || !data?.user?.id) {
        throw unauthenticated();
      }

      return { accessToken: bearerToken, userId: data.user.id };
    },
  };
};
