-- A join appends its Activity to the shared document, so the document it
-- produces is bounded like any other update. Anonymous identities are free to
-- create, and the join window is keyed by the identity, so without this ceiling
-- an unbounded number of first joins could grow a document past the size its
-- readers replay and past the point where its editors may still add to it.
drop function public.ground_join_document(text, uuid, text, timestamptz, bytea);

create function public.ground_join_document(
  p_document_id text,
  p_user_id uuid,
  p_display_name text,
  p_now timestamptz,
  p_max_document_bytes integer,
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
  current_snapshot_sequence bigint;
  snapshot_bytes bigint;
  replayed_bytes bigint;
begin
  if p_max_document_bytes is null or p_max_document_bytes <= 0 then
    raise exception using
      errcode = '22023',
      message = 'GROUND_INVALID_REQUEST';
  end if;

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
    -- The document row is locked as the commit boundary locks it, so the size
    -- read and the sequence allocation see the same log.
    select coalesce(octet_length(document.snapshot), 0), document.snapshot_sequence
    into snapshot_bytes, current_snapshot_sequence
    from public.ground_documents as document
    where document.id = p_document_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'GROUND_UNAVAILABLE';
    end if;

    select coalesce(sum(octet_length(update_row.update_payload)), 0)
    into replayed_bytes
    from public.ground_yjs_updates as update_row
    where update_row.document_id = p_document_id
      and update_row.sequence > current_snapshot_sequence;

    if snapshot_bytes + replayed_bytes + octet_length(p_activity_update) > p_max_document_bytes then
      raise exception using
        errcode = 'P0001',
        message = 'GROUND_UPDATE_TOO_LARGE';
    end if;

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

revoke all on function public.ground_join_document(text, uuid, text, timestamptz, integer, bytea)
  from public, anon, authenticated;
grant execute on function public.ground_join_document(text, uuid, text, timestamptz, integer, bytea)
  to service_role;
