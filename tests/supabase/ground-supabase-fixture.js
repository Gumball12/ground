import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

const requireLocalSupabase = () => {
  if (!url || !publishableKey || !secretKey) {
    throw new Error('Run this test through npm run test:supabase so local Supabase credentials are available.');
  }
};

const throwRpcError = (error) => {
  if (!error) {
    return;
  }

  const failure = new Error(error.message, { cause: error });
  Object.assign(failure, { code: error.code, details: error.details, hint: error.hint });
  throw failure;
};

const callAdminRpc = async (name, input) => {
  const { data, error } = await createAdminClient().rpc(name, input);
  throwRpcError(error);
  return data;
};

export const createAnonymousClient = async () => {
  requireLocalSupabase();
  const client = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  throwRpcError(error);
  return { client, session: data.session, userId: data.user.id };
};

export const createAdminClient = () => {
  requireLocalSupabase();
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

export const uniqueDocumentId = () => randomBytes(16).toString('base64url');
export const encodeUpdate = (value) => Buffer.from(value).toString('base64');
export const decodeUpdate = (value) => new Uint8Array(Buffer.from(value, 'base64'));

export const createDocumentAsAdmin = ({
  actorId,
  documentId = uniqueDocumentId(),
  displayName = 'Ground user',
  snapshot = Buffer.alloc(0),
  recoveryTokenHash = randomBytes(32),
} = {}) => callAdminRpc('ground_create_document', {
  p_actor_id: actorId,
  p_document_id: documentId,
  p_display_name: displayName,
  p_recovery_token_hash: encodeUpdate(recoveryTokenHash),
  p_snapshot: encodeUpdate(snapshot),
});

export const createPendingScenario = async () => {
  const owner = await createAnonymousClient();
  const pending = await createAnonymousClient();
  const documentId = uniqueDocumentId();
  await createDocumentAsAdmin({ actorId: owner.userId, documentId });
  await callAdminRpc('ground_join_document', {
    p_actor_id: pending.userId,
    p_display_name: 'Pending user',
    p_document_id: documentId,
  });
  return { documentId, owner, pending };
};

export const assignRoleAsAdmin = (input) => callAdminRpc('ground_assign_role', {
  p_activity_update: encodeUpdate(input.activityUpdate ?? Buffer.alloc(0)),
  p_document_id: input.documentId,
  p_expected_owner_version: input.expectedOwnerVersion,
  p_now: input.now ?? new Date().toISOString(),
  p_owner_id: input.actorId,
  p_role_id: input.roleId,
  p_target_user_id: input.targetUserId,
});

export const createActiveEditorScenario = async () => {
  const scenario = await createPendingScenario();
  await assignRoleAsAdmin({
    actorId: scenario.owner.userId,
    documentId: scenario.documentId,
    expectedOwnerVersion: 1,
    roleId: 'editor',
    targetUserId: scenario.pending.userId,
  });
  return { ...scenario, editor: scenario.pending, editorRoleVersion: 2 };
};

export const commitRawUpdate = (scenario, update) => callAdminRpc('ground_commit_update', {
  p_actor_id: scenario.editor.userId,
  p_document_id: scenario.documentId,
  p_expected_role_version: scenario.editorRoleVersion,
  p_now: new Date().toISOString(),
  p_operation_kind: 'document_edit',
  p_source: 'document_editor',
  p_update: encodeUpdate(update),
});

export const readParticipantsAsAdmin = async (documentId) => {
  const { data, error } = await createAdminClient()
    .from('ground_participants')
    .select('access_state, role_id, role_version')
    .eq('document_id', documentId)
    .order('created_at');
  throwRpcError(error);
  return data;
};

export const readDocumentHead = async (documentId) => {
  const { data, error } = await createAdminClient()
    .from('ground_documents')
    .select('head_sequence, snapshot_sequence')
    .eq('id', documentId)
    .single();
  throwRpcError(error);
  return data;
};

export const readUpdateRows = async (documentId) => {
  const { data, error } = await createAdminClient()
    .from('ground_yjs_updates')
    .select('sequence, update_payload')
    .eq('document_id', documentId)
    .order('sequence');
  throwRpcError(error);
  return data;
};
