drop function public.ground_commit_update(text, uuid, bigint, text, text, bytea, timestamptz);

create function public.ground_commit_update(
  p_document_id text,
  p_actor_id uuid,
  p_expected_role_version bigint,
  p_operation_kind text,
  p_source text,
  p_update bytea,
  p_max_update_bytes integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  committed_sequence bigint;
  actor_access_state text;
  actor_role_version bigint;
begin
  if p_max_update_bytes is null or p_max_update_bytes <= 0 then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  if p_update is null or octet_length(p_update) > p_max_update_bytes then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UPDATE_TOO_LARGE';
  end if;

  select document.head_sequence + 1
  into committed_sequence
  from public.ground_documents as document
  where document.id = p_document_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  select participant.access_state, participant.role_version
  into actor_access_state, actor_role_version
  from public.ground_participants as participant
  where participant.document_id = p_document_id
    and participant.user_id = p_actor_id
  for update;

  if not found
    or actor_access_state <> 'active'
    or actor_role_version <> p_expected_role_version
  then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  update public.ground_documents as document
  set head_sequence = committed_sequence,
      last_mutation_at = p_now
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
    p_update,
    p_actor_id,
    p_operation_kind,
    p_source,
    p_now
  );

  return jsonb_build_object('sequence', committed_sequence);
end;
$function$;

revoke all on function public.ground_commit_update(
  text, uuid, bigint, text, text, bytea, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.ground_commit_update(
  text, uuid, bigint, text, text, bytea, integer, timestamptz
) to service_role;

create function public.ground_compact_document(
  p_document_id text,
  p_candidate_sequence bigint,
  p_snapshot bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_head_sequence bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id, 0));

  select document.head_sequence
  into current_head_sequence
  from public.ground_documents as document
  where document.id = p_document_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UNAVAILABLE';
  end if;

  if p_snapshot is null then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  if p_candidate_sequence is null
    or p_candidate_sequence < 0
    or p_candidate_sequence > current_head_sequence
  then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  -- Compaction rewrites durable history only. It never advances
  -- last_mutation_at, so it cannot postpone inactivity deletion.
  update public.ground_documents as document
  set snapshot = p_snapshot,
      snapshot_sequence = p_candidate_sequence
  where document.id = p_document_id;

  delete from public.ground_yjs_updates as update_row
  where update_row.document_id = p_document_id
    and update_row.sequence <= p_candidate_sequence;

  return jsonb_build_object('snapshotSequence', p_candidate_sequence);
end;
$function$;

revoke all on function public.ground_compact_document(text, bigint, bytea)
  from public, anon, authenticated;
grant execute on function public.ground_compact_document(text, bigint, bytea)
  to service_role;

create table private.ground_rate_limits (
  scope text not null check (scope in ('create', 'join', 'mutation')),
  key_hash bytea not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (scope, key_hash, window_started_at)
);

revoke all on table private.ground_rate_limits from public, anon, authenticated;

create function public.ground_take_rate_limit(
  p_scope text,
  p_key_hash bytea,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  aligned_window_start timestamptz;
  current_count integer;
begin
  if p_scope is null
    or p_key_hash is null
    or p_now is null
    or p_limit is null
    or p_limit <= 0
    or p_window_seconds is null
    or p_window_seconds <= 0
  then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  aligned_window_start := to_timestamp(
    (floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds)::double precision
  );

  insert into private.ground_rate_limits (
    scope,
    key_hash,
    window_started_at,
    request_count
  ) values (
    p_scope,
    p_key_hash,
    aligned_window_start,
    1
  )
  on conflict (scope, key_hash, window_started_at) do update
  set request_count = private.ground_rate_limits.request_count + 1
  returning private.ground_rate_limits.request_count into current_count;

  return current_count <= p_limit;
end;
$function$;

revoke all on function public.ground_take_rate_limit(text, bytea, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ground_take_rate_limit(text, bytea, integer, integer, timestamptz)
  to service_role;

create function public.ground_delete_expired_documents(p_cutoff timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate_ids text[];
  deleted_count integer;
begin
  if p_cutoff is null then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  select coalesce(array_agg(locked.id), '{}')
  into candidate_ids
  from (
    select document.id
    from public.ground_documents as document
    where document.last_mutation_at < p_cutoff
    order by document.id
    for update
  ) as locked;

  -- Recheck under the acquired row locks so a mutation that committed while the
  -- cleanup was waiting keeps its document.
  delete from public.ground_documents as document
  where document.id = any(candidate_ids)
    and document.last_mutation_at < p_cutoff;
  get diagnostics deleted_count = row_count;

  delete from private.ground_rate_limits as rate_window
  where rate_window.window_started_at < p_cutoff;

  return deleted_count;
end;
$function$;

revoke all on function public.ground_delete_expired_documents(timestamptz)
  from public, anon, authenticated;
grant execute on function public.ground_delete_expired_documents(timestamptz)
  to service_role;

drop function public.ground_join_document(text, uuid, text, timestamptz, bytea);

create function public.ground_join_document(
  p_document_id text,
  p_user_id uuid,
  p_display_name text,
  p_now timestamptz,
  p_activity_update bytea default '\x'::bytea
)
returns table (access_state text, role_id text, role_version bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_display_name text := btrim(p_display_name);
  participant_created boolean := false;
  activity_sequence bigint;
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
    p_user_id,
    normalized_display_name,
    'pending',
    null,
    p_now,
    p_now
  )
  on conflict (document_id, user_id) do nothing
  returning true into participant_created;

  if participant_created then
    -- A Pending join allocates an Activity sequence but is not a durable
    -- product mutation, so it must not postpone inactivity deletion.
    update public.ground_documents as document
    set head_sequence = document.head_sequence + 1
    where document.id = p_document_id
    returning document.head_sequence into activity_sequence;

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
      activity_sequence,
      p_activity_update,
      p_user_id,
      'access_change',
      'access_management',
      p_now
    );
  else
    update public.ground_participants as participant
    set display_name = normalized_display_name,
        updated_at = p_now
    where participant.document_id = p_document_id
      and participant.user_id = p_user_id;
  end if;

  return query
    select participant.access_state, participant.role_id, participant.role_version
    from public.ground_participants as participant
    where participant.document_id = p_document_id
      and participant.user_id = p_user_id;
end;
$function$;

revoke all on function public.ground_join_document(text, uuid, text, timestamptz, bytea)
  from public, anon, authenticated;
grant execute on function public.ground_join_document(text, uuid, text, timestamptz, bytea)
  to service_role;

create extension if not exists pg_cron;

select cron.schedule(
  'ground-delete-inactive-documents',
  '0 3 * * *',
  $job$select public.ground_delete_expired_documents(now() - interval '30 days')$job$
);
