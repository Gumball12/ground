import { createClient } from '@supabase/supabase-js';

// Ground identities are invisible and anonymous: the session persists so a reload
// keeps the same participant, and Ground never reads a session out of the URL.
const GROUND_AUTH_OPTIONS = Object.freeze({
  autoRefreshToken: true,
  detectSessionInUrl: false,
  persistSession: true,
});

const unauthenticated = (cause) => Object.assign(
  new Error('Ground anonymous session is unavailable'),
  { cause, code: 'GROUND_UNAUTHENTICATED' },
);

export const createGroundSupabaseClient = (
  { supabasePublishableKey, supabaseUrl },
  createClientImpl = createClient,
) => createClientImpl(supabaseUrl, supabasePublishableKey, { auth: GROUND_AUTH_OPTIONS });

export class GroundAuthClient {
  constructor({ supabase }) {
    this.supabase = supabase;
    this.identity = undefined;
    this.pending = null;
  }

  initialize() {
    this.pending ??= this.#initialize().catch((error) => {
      this.pending = null;
      throw error;
    });
    return this.pending;
  }

  async accessToken() {
    const session = await this.#readSession();
    if (!session) {
      throw unauthenticated();
    }
    return session.access_token;
  }

  async #initialize() {
    try {
      const session = (await this.#readSession()) ?? (await this.#createSession());
      await this.supabase.realtime.setAuth(session.access_token);
      this.identity = Object.freeze({
        accessToken: session.access_token,
        supabase: this.supabase,
        userId: session.user.id,
      });
      return this.identity;
    } catch (cause) {
      throw cause?.code === 'GROUND_UNAUTHENTICATED' ? cause : unauthenticated(cause);
    }
  }

  async #readSession() {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      throw unauthenticated(error);
    }
    return data?.session ?? null;
  }

  async #createSession() {
    const { data, error } = await this.supabase.auth.signInAnonymously();
    if (error || !data?.session) {
      throw unauthenticated(error);
    }
    return data.session;
  }
}
