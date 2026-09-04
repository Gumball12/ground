-- A server-composed edit (WebMCP apply, Proposal, resolution) is validated
-- against the document it loaded. Two such edits can load the same text, pass
-- validation against it, and commit in turn, so both replacements land although
-- the second no longer describes the document. The commit therefore accepts the
-- head the caller composed against and refuses to allocate once it has moved.
-- An editor update merges with concurrent edits and names no head.
drop function public.ground_commit_update(
  text, uuid, bigint, text, text, bytea, integer, integer, timestamptz
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
  p_now timestamptz,
  p_expected_head_sequence bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_head_sequence bigint;
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

  select document.head_sequence,
         coalesce(octet_length(document.snapshot), 0),
         document.snapshot_sequence
  into current_head_sequence, snapshot_bytes, current_snapshot_sequence
  from public.ground_documents as document
  where document.id = p_document_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  if p_expected_head_sequence is not null
    and p_expected_head_sequence <> current_head_sequence
  then
    raise exception using
      errcode = 'P0001',
      message = 'GROUND_STALE_STATE';
  end if;

  committed_sequence := current_head_sequence + 1;

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
  text, uuid, bigint, text, text, bytea, integer, integer, timestamptz, bigint
) from public, anon, authenticated;
grant execute on function public.ground_commit_update(
  text, uuid, bigint, text, text, bytea, integer, integer, timestamptz, bigint
) to service_role;
