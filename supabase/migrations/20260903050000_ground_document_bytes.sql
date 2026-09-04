-- An edit is bounded by the single update and by the document it produces.
-- The commit boundary already holds the document row, so the resulting size is
-- summed from the bytes a reader would replay: the snapshot plus every retained
-- log row plus the arriving update. Measuring stored bytes keeps the cheap
-- append path cheap; encoding the true Yjs document would force a full load and
-- apply on every editor commit.
drop function public.ground_commit_update(
  text, uuid, bigint, text, text, bytea, integer, timestamptz
);

create function public.ground_commit_update(
  p_document_id text,
  p_actor_id uuid,
  p_expected_role_version bigint,
  p_operation_kind text,
  p_source text,
  p_update bytea,
  p_max_update_bytes integer,
  p_max_document_bytes integer,
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
  current_snapshot_sequence bigint;
  snapshot_bytes bigint;
  replayed_bytes bigint;
begin
  if p_max_update_bytes is null or p_max_update_bytes <= 0
    or p_max_document_bytes is null or p_max_document_bytes <= 0
  then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

  if p_update is null or octet_length(p_update) > p_max_update_bytes then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UPDATE_TOO_LARGE';
  end if;

  select document.head_sequence + 1,
         coalesce(octet_length(document.snapshot), 0),
         document.snapshot_sequence
  into committed_sequence, snapshot_bytes, current_snapshot_sequence
  from public.ground_documents as document
  where document.id = p_document_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  -- Compaction deletes every row through the snapshot sequence, so the rows
  -- above it are exactly what hydration replays.
  select coalesce(sum(octet_length(update_row.update_payload)), 0)
  into replayed_bytes
  from public.ground_yjs_updates as update_row
  where update_row.document_id = p_document_id
    and update_row.sequence > current_snapshot_sequence;

  if snapshot_bytes + replayed_bytes + octet_length(p_update) > p_max_document_bytes then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_UPDATE_TOO_LARGE';
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
  text, uuid, bigint, text, text, bytea, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.ground_commit_update(
  text, uuid, bigint, text, text, bytea, integer, integer, timestamptz
) to service_role;
