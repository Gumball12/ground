-- Two hydrations can fold the same document from different heads. Once the
-- newer fold has committed, the older candidate's snapshot no longer covers the
-- rows the newer fold deleted, and its own delete removes nothing, so accepting
-- it would replace a complete snapshot with one missing every row in between.
-- The candidate therefore has to lie strictly above the stored snapshot.
drop function public.ground_compact_document(text, bigint, bytea);

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
  current_snapshot_sequence bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id, 0));

  select document.head_sequence, document.snapshot_sequence
  into current_head_sequence, current_snapshot_sequence
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
    or p_candidate_sequence <= current_snapshot_sequence
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
