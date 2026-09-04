-- Hydration read the document row and then its log as two statements. A fold
-- committed between them deletes rows the second statement still needs, so the
-- reader paired the old snapshot with a log missing the folded range and took
-- the old head as authoritative. One statement reads both under one snapshot.
--
-- Bytes travel as base64 without the line breaks encode() inserts every 76
-- characters, so the caller decodes them with one plain base64 step.
create function public.ground_load_state(p_document_id text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $function$
  select jsonb_build_object(
    'headSequence', document.head_sequence,
    'snapshot', replace(encode(document.snapshot, 'base64'), E'\n', ''),
    'snapshotSequence', document.snapshot_sequence,
    'updates', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sequence', update_row.sequence,
          'update', replace(encode(update_row.update_payload, 'base64'), E'\n', '')
        )
        order by update_row.sequence
      )
      from public.ground_yjs_updates as update_row
      where update_row.document_id = document.id
        and update_row.sequence > document.snapshot_sequence
    ), '[]'::jsonb)
  )
  from public.ground_documents as document
  where document.id = p_document_id;
$function$;

revoke all on function public.ground_load_state(text) from public, anon, authenticated;
grant execute on function public.ground_load_state(text) to service_role;
