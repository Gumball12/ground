import { createClient } from '@supabase/supabase-js';

const GROUND_MESSAGE = /^GROUND_[A-Z_]+$/u;

const POSTGREST_CODE_MAP = Object.freeze({
  23505: 'GROUND_DOCUMENT_ID_TAKEN',
  PGRST116: 'GROUND_UNAVAILABLE',
});

// Supabase returns and accepts bytea as a `\x<hex>` literal; base64 does not
// round-trip through PostgREST, which the Plan 1 update tests proved.
const encodeBytea = (value) => `\\x${Buffer.from(value ?? []).toString('hex')}`;

const decodeBytea = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value);
  return new Uint8Array(text.startsWith('\\x')
    ? Buffer.from(text.slice(2), 'hex')
    : Buffer.from(text, 'base64'));
};

const groundFailure = (error) => {
  const code = GROUND_MESSAGE.test(error?.message ?? '')
    ? error.message
    : POSTGREST_CODE_MAP[error?.code] ?? 'GROUND_TEMPORARILY_UNAVAILABLE';
  return Object.assign(new Error(code, { cause: error }), { code });
};

const participantFrom = (row) => (row ? {
  accessState: row.access_state,
  displayName: row.display_name,
  roleId: row.role_id ?? undefined,
  roleVersion: Number(row.role_version),
  userId: row.user_id,
} : undefined);

export const createGroundSupabaseStore = ({ fetchImpl, secretKey, supabaseUrl }) => {
  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });

  const callRpc = async (name, input) => {
    const { data, error } = await client.rpc(name, input);
    if (error) {
      throw groundFailure(error);
    }
    return data;
  };

  const selectOne = async (table, columns, filters) => {
    let query = client.from(table).select(columns);
    Object.entries(filters).forEach(([column, value]) => {
      query = query.eq(column, value);
    });
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw groundFailure(error);
    }
    return data ?? undefined;
  };

  return {
    assignRole: async (input) => {
      const result = await callRpc('ground_assign_role', {
        p_activity_update: encodeBytea(input.activityUpdate),
        p_document_id: input.documentId,
        p_expected_owner_version: input.expectedOwnerVersion,
        p_now: input.now,
        p_owner_id: input.ownerId,
        p_role_id: input.roleId,
        p_target_user_id: input.targetUserId,
      });
      return {
        participant: participantFrom(result.participant),
        sequence: Number(result.sequence),
      };
    },

    commitUpdate: async (input) => {
      const result = await callRpc('ground_commit_update', {
        p_actor_id: input.actorId,
        p_document_id: input.documentId,
        // Only a server-composed edit names the head it was composed against;
        // an editor update merges with concurrent edits and names none.
        p_expected_head_sequence: input.expectedHeadSequence ?? null,
        p_expected_role_version: input.expectedRoleVersion,
        p_max_document_bytes: input.maxDocumentBytes,
        p_max_update_bytes: input.maxUpdateBytes,
        p_now: input.now,
        p_operation_kind: input.operationKind,
        p_source: input.source,
        p_update: encodeBytea(input.update),
      });
      return { sequence: Number(result.sequence) };
    },

    // Folds the log into one snapshot. The database takes the document lock and
    // deletes only the rows the candidate sequence covers.
    compactDocument: async (input) => {
      const result = await callRpc('ground_compact_document', {
        p_candidate_sequence: input.candidateSequence,
        p_document_id: input.documentId,
        p_snapshot: encodeBytea(input.snapshot),
      });
      return { snapshotSequence: Number(result.snapshotSequence) };
    },

    create: async (input) => {
      const rows = await callRpc('ground_create_document', {
        p_display_name: input.displayName,
        p_document_id: input.documentId,
        p_initial_snapshot: encodeBytea(input.snapshot),
        p_now: input.now,
        p_owner_id: input.ownerId,
        p_recovery_token_hash: encodeBytea(input.recoveryTokenHash),
      });
      const [row] = rows ?? [];
      return {
        accessState: row?.access_state,
        roleId: row?.role_id ?? undefined,
        roleVersion: Number(row?.role_version),
      };
    },

    getSession: async ({ documentId, userId }) => participantFrom(await selectOne(
      'ground_participants',
      'access_state, display_name, role_id, role_version, user_id',
      { document_id: documentId, user_id: userId },
    )),

    join: async (input) => {
      const rows = await callRpc('ground_join_document', {
        p_activity_update: encodeBytea(input.activityUpdate),
        p_display_name: input.displayName,
        p_document_id: input.documentId,
        p_max_document_bytes: input.maxDocumentBytes,
        p_now: input.now,
        p_user_id: input.userId,
      });
      const [row] = rows ?? [];
      return {
        accessState: row?.access_state,
        displayName: input.displayName,
        roleId: row?.role_id ?? undefined,
        roleVersion: Number(row?.role_version),
        userId: input.userId,
      };
    },

    listParticipants: async ({ documentId }) => {
      const { data, error } = await client
        .from('ground_participants')
        .select('access_state, display_name, role_id, role_version, user_id')
        .eq('document_id', documentId)
        .order('created_at');
      if (error) {
        throw groundFailure(error);
      }
      return data.map(participantFrom);
    },

    // The snapshot and the rows above it are read by one statement. Reading them
    // separately let a fold that committed in between delete rows the second
    // read still needed, pairing an old snapshot with a log missing that range.
    loadState: async ({ documentId }) => {
      const state = await callRpc('ground_load_state', { p_document_id: documentId });
      if (!state) {
        throw Object.assign(new Error('GROUND_UNAVAILABLE'), { code: 'GROUND_UNAVAILABLE' });
      }

      return {
        headSequence: Number(state.headSequence),
        snapshot: decodeBytea(state.snapshot),
        snapshotSequence: Number(state.snapshotSequence),
        updates: state.updates.map((row) => ({
          sequence: Number(row.sequence),
          update: decodeBytea(row.update),
        })),
      };
    },

    recover: async (input) => {
      const result = await callRpc('ground_recover_owner', {
        p_activity_update: encodeBytea(input.activityUpdate),
        p_actor_id: input.actorId,
        p_display_name: input.displayName,
        p_document_id: input.documentId,
        p_next_token_hash: encodeBytea(input.nextTokenHash),
        p_now: input.now,
        p_token_hash: encodeBytea(input.tokenHash),
      });
      return { sequence: Number(result.sequence) };
    },

    revoke: async (input) => {
      const result = await callRpc('ground_revoke_participant', {
        p_activity_update: encodeBytea(input.activityUpdate),
        p_document_id: input.documentId,
        p_expected_owner_version: input.expectedOwnerVersion,
        p_now: input.now,
        p_owner_id: input.ownerId,
        p_target_user_id: input.targetUserId,
      });
      return {
        participant: participantFrom(result.participant),
        sequence: Number(result.sequence),
      };
    },

    takeRateLimit: async (input) => callRpc('ground_take_rate_limit', {
      p_key_hash: encodeBytea(input.keyHash),
      p_limit: input.limit,
      p_now: input.now,
      p_scope: input.scope,
      p_window_seconds: input.windowSeconds,
    }),
  };
};
