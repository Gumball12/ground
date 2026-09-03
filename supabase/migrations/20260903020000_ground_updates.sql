create table public.ground_yjs_updates (
  document_id text not null references public.ground_documents(id) on delete cascade,
  sequence bigint not null,
  update_payload bytea not null,
  actor_id uuid not null references auth.users(id),
  operation_kind text not null check (operation_kind in (
    'document_edit',
    'proposal_create',
    'proposal_resolve',
    'access_change',
    'owner_recovery'
  )),
  source text not null check (source in (
    'document_editor',
    'webmcp_apply',
    'webmcp_proposal',
    'owner_decision',
    'access_management',
    'system_reconciliation'
  )),
  created_at timestamptz not null,
  primary key (document_id, sequence)
);

alter table public.ground_yjs_updates enable row level security;

revoke all on table public.ground_yjs_updates from public, anon, authenticated;
grant select on table public.ground_yjs_updates to authenticated;
grant all privileges on table public.ground_yjs_updates to service_role;

create policy ground_yjs_updates_read_active_participant
on public.ground_yjs_updates
for select
to authenticated
using (
  exists (
    select 1
    from private.ground_participant(ground_yjs_updates.document_id, (select auth.uid())) as participant
    where participant.access_state = 'active'
  )
);

create function public.ground_commit_update(
  p_document_id text,
  p_actor_id uuid,
  p_expected_role_version bigint,
  p_operation_kind text,
  p_source text,
  p_update bytea,
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

revoke all on function public.ground_commit_update(text, uuid, bigint, text, text, bytea, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ground_commit_update(text, uuid, bigint, text, text, bytea, timestamptz)
  to service_role;

drop function public.ground_join_document(text, uuid, text, timestamptz);

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
    update public.ground_documents as document
    set head_sequence = document.head_sequence + 1,
        last_mutation_at = p_now
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

create function private.ground_broadcast_update_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform realtime.send(
    jsonb_build_object('sequence', new.sequence),
    'update',
    'ground-document:' || new.document_id,
    true
  );
  return null;
end;
$function$;

revoke all on function private.ground_broadcast_update_sequence() from public;

create trigger ground_yjs_update_sequence_notice
after insert on public.ground_yjs_updates
for each row
execute function private.ground_broadcast_update_sequence();

create policy ground_document_realtime_read_active
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and (select realtime.topic()) ~ '^ground-document:[A-Za-z0-9_-]{22}$'
  and exists (
    select 1
    from private.ground_participant(
      substring((select realtime.topic()) from '^ground-document:(.+)$'),
      (select auth.uid())
    ) as participant
    where participant.access_state = 'active'
  )
);

create policy ground_document_realtime_write_presence
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and (select realtime.topic()) ~ '^ground-document:[A-Za-z0-9_-]{22}$'
  and exists (
    select 1
    from private.ground_participant(
      substring((select realtime.topic()) from '^ground-document:(.+)$'),
      (select auth.uid())
    ) as participant
    where participant.access_state = 'active'
  )
);

create policy ground_access_realtime_read_self
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select auth.uid()) is not null
  and (select realtime.topic()) = 'ground-access:' || (select auth.uid())::text
);
