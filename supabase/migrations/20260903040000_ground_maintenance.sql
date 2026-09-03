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
