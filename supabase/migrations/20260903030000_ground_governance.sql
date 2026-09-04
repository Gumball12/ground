create function private.ground_allocate_sequence(p_document_id text, p_now timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  next_sequence bigint;
begin
  select document.head_sequence + 1
  into next_sequence
  from public.ground_documents as document
  where document.id = p_document_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UNAVAILABLE';
  end if;

  update public.ground_documents as document
  set head_sequence = next_sequence,
      last_mutation_at = p_now
  where document.id = p_document_id;

  return next_sequence;
end;
$function$;

create function private.ground_change_access(
  p_document_id text,
  p_owner_id uuid,
  p_expected_owner_version bigint,
  p_target_user_id uuid,
  p_next_access_state text,
  p_next_role_id text,
  p_activity_update bytea,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owner_access_state text;
  owner_role_id text;
  owner_role_version bigint;
  target_access_state text;
  target_role_id text;
  committed_sequence bigint;
  next_access_state text;
  next_role_id text;
  next_role_version bigint;
begin
  committed_sequence := private.ground_allocate_sequence(p_document_id, p_now);

  select participant.access_state, participant.role_id, participant.role_version
  into owner_access_state, owner_role_id, owner_role_version
  from public.ground_participants as participant
  where participant.document_id = p_document_id
    and participant.user_id = p_owner_id
  for update;

  if not found
    or owner_access_state <> 'active'
    or owner_role_id <> 'owner'
    or owner_role_version <> p_expected_owner_version
  then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  select participant.access_state, participant.role_id
  into target_access_state, target_role_id
  from public.ground_participants as participant
  where participant.document_id = p_document_id
    and participant.user_id = p_target_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UNAVAILABLE';
  end if;

  if target_access_state = 'active' and target_role_id = 'owner' then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_OWNER_IMMUTABLE';
  end if;

  update public.ground_participants as participant
  set access_state = p_next_access_state,
      role_id = p_next_role_id,
      role_version = participant.role_version + 1,
      updated_at = p_now
  where participant.document_id = p_document_id
    and participant.user_id = p_target_user_id
  returning participant.access_state, participant.role_id, participant.role_version
  into next_access_state, next_role_id, next_role_version;

  insert into public.ground_yjs_updates (
    document_id,
    sequence,
    update_payload,
    actor_id,
    operation_kind,
    source,
    created_at
  ) values (
    p_document_id,
    committed_sequence,
    p_activity_update,
    p_owner_id,
    'access_change',
    'access_management',
    p_now
  );

  return jsonb_build_object(
    'participant', jsonb_build_object(
      'access_state', next_access_state,
      'role_id', next_role_id,
      'role_version', next_role_version
    ),
    'sequence', committed_sequence
  );
end;
$function$;

create function public.ground_assign_role(
  p_document_id text,
  p_owner_id uuid,
  p_expected_owner_version bigint,
  p_target_user_id uuid,
  p_role_id text,
  p_activity_update bytea,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_role_id is null or btrim(p_role_id) = '' or p_role_id = 'owner' then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  return private.ground_change_access(
    p_document_id,
    p_owner_id,
    p_expected_owner_version,
    p_target_user_id,
    'active',
    p_role_id,
    p_activity_update,
    p_now
  );
end;
$function$;

create function public.ground_revoke_participant(
  p_document_id text,
  p_owner_id uuid,
  p_expected_owner_version bigint,
  p_target_user_id uuid,
  p_activity_update bytea,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return private.ground_change_access(
    p_document_id,
    p_owner_id,
    p_expected_owner_version,
    p_target_user_id,
    'revoked',
    null,
    p_activity_update,
    p_now
  );
end;
$function$;

create function public.ground_recover_owner(
  p_document_id text,
  p_actor_id uuid,
  p_display_name text,
  p_token_hash bytea,
  p_next_token_hash bytea,
  p_activity_update bytea,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_display_name text := btrim(p_display_name);
  stored_token_hash bytea;
  committed_sequence bigint;
begin
  if normalized_display_name is null
    or normalized_display_name = ''
    or char_length(normalized_display_name) > 24
    or normalized_display_name ~ '[[:cntrl:]]'
  then
    raise exception using
      errcode = '22023',
      message = 'Display name must contain 1 to 24 visible characters.';
  end if;

  if p_next_token_hash is null then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  select document.recovery_token_hash
  into stored_token_hash
  from public.ground_documents as document
  where document.id = p_document_id
  for update;

  -- Plain bytea equality is sufficient here: both values are SHA-256 digests, so
  -- leaked comparison timing does not help an attacker produce a matching token.
  if not found or p_token_hash is null or stored_token_hash <> p_token_hash then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UNAVAILABLE';
  end if;

  update public.ground_participants as participant
  set access_state = 'revoked',
      role_id = null,
      role_version = participant.role_version + 1,
      updated_at = p_now
  where participant.document_id = p_document_id
    and participant.user_id <> p_actor_id
    and participant.access_state = 'active'
    and participant.role_id = 'owner';

  insert into public.ground_participants (
    document_id,
    user_id,
    display_name,
    access_state,
    role_id,
    created_at,
    updated_at
  ) values (
    p_document_id,
    p_actor_id,
    normalized_display_name,
    'active',
    'owner',
    p_now,
    p_now
  )
  on conflict (document_id, user_id) do update
  set access_state = 'active',
      role_id = 'owner',
      role_version = public.ground_participants.role_version + 1,
      updated_at = p_now;

  committed_sequence := private.ground_allocate_sequence(p_document_id, p_now);

  update public.ground_documents as document
  set recovery_token_hash = p_next_token_hash
  where document.id = p_document_id;

  insert into public.ground_yjs_updates (
    document_id,
    sequence,
    update_payload,
    actor_id,
    operation_kind,
    source,
    created_at
  ) values (
    p_document_id,
    committed_sequence,
    p_activity_update,
    p_actor_id,
    'owner_recovery',
    'access_management',
    p_now
  );

  return jsonb_build_object('sequence', committed_sequence);
end;
$function$;

create function private.ground_broadcast_access_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform realtime.send(
    jsonb_build_object(
      'documentId', new.document_id,
      'accessState', new.access_state,
      'roleId', new.role_id,
      'roleVersion', new.role_version
    ),
    'access',
    'ground-access:' || new.user_id::text,
    true
  );
  return null;
end;
$function$;

create trigger ground_participant_access_notice
after update on public.ground_participants
for each row
when (
  new.access_state is distinct from old.access_state
  or new.role_id is distinct from old.role_id
  or new.role_version is distinct from old.role_version
)
execute function private.ground_broadcast_access_change();

revoke all on function private.ground_allocate_sequence(text, timestamptz) from public;
revoke all on function private.ground_change_access(
  text, uuid, bigint, uuid, text, text, bytea, timestamptz
) from public;
revoke all on function private.ground_broadcast_access_change() from public;

revoke all on function public.ground_assign_role(
  text, uuid, bigint, uuid, text, bytea, timestamptz
) from public, anon, authenticated;
revoke all on function public.ground_revoke_participant(
  text, uuid, bigint, uuid, bytea, timestamptz
) from public, anon, authenticated;
revoke all on function public.ground_recover_owner(
  text, uuid, text, bytea, bytea, bytea, timestamptz
) from public, anon, authenticated;

grant execute on function public.ground_assign_role(
  text, uuid, bigint, uuid, text, bytea, timestamptz
) to service_role;
grant execute on function public.ground_revoke_participant(
  text, uuid, bigint, uuid, bytea, timestamptz
) to service_role;
grant execute on function public.ground_recover_owner(
  text, uuid, text, bytea, bytea, bytea, timestamptz
) to service_role;
