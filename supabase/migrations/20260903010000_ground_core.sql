create schema if not exists private;

revoke all on schema private from public;

create table public.ground_documents (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  snapshot bytea not null,
  snapshot_sequence bigint not null default 0,
  head_sequence bigint not null default 0,
  last_mutation_at timestamptz not null,
  recovery_token_hash bytea not null,
  created_at timestamptz not null default now()
);

create table public.ground_participants (
  document_id text not null references public.ground_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 24),
  access_state text not null check (access_state in ('pending', 'active', 'revoked')),
  role_id text,
  role_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_id, user_id),
  check ((access_state = 'active') = (role_id is not null))
);

create unique index ground_one_owner_per_document
  on public.ground_participants(document_id)
  where access_state = 'active' and role_id = 'owner';

create function private.ground_require_single_owner(p_document_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  owner_count bigint;
begin
  if not exists (
    select 1
    from public.ground_documents as document
    where document.id = p_document_id
  ) then
    return;
  end if;

  select count(*)
  into owner_count
  from public.ground_participants as participant
  where participant.document_id = p_document_id
    and participant.access_state = 'active'
    and participant.role_id = 'owner';

  if owner_count <> 1 then
    raise exception using
      errcode = '23514',
      constraint = 'ground_document_has_exactly_one_owner',
      message = 'Every Ground document must have exactly one Active Owner.';
  end if;
end;
$function$;

create function private.ground_enforce_owner_invariant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_table_name = 'ground_documents' then
    perform private.ground_require_single_owner(new.id);
  elsif tg_op = 'DELETE' then
    perform private.ground_require_single_owner(old.document_id);
  elsif tg_op = 'UPDATE' then
    perform private.ground_require_single_owner(old.document_id);
    if new.document_id is distinct from old.document_id then
      perform private.ground_require_single_owner(new.document_id);
    end if;
  else
    perform private.ground_require_single_owner(new.document_id);
  end if;

  return null;
end;
$function$;

revoke all on function private.ground_require_single_owner(text) from public;
revoke all on function private.ground_enforce_owner_invariant() from public;

create constraint trigger ground_document_requires_owner
after insert on public.ground_documents
deferrable initially deferred
for each row
execute function private.ground_enforce_owner_invariant();

create constraint trigger ground_participant_preserves_owner
after insert or update or delete on public.ground_participants
deferrable initially deferred
for each row
execute function private.ground_enforce_owner_invariant();

create function private.ground_participant(p_document_id text, p_user_id uuid)
returns table (access_state text, role_id text, role_version bigint)
language sql
stable
security definer
set search_path = ''
as $function$
  select participant.access_state, participant.role_id, participant.role_version
  from public.ground_participants as participant
  where participant.document_id = p_document_id
    and participant.user_id = p_user_id;
$function$;

revoke all on function private.ground_participant(text, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.ground_participant(text, uuid) to authenticated;

create function public.ground_create_document(
  p_document_id text,
  p_owner_id uuid,
  p_display_name text,
  p_initial_snapshot bytea,
  p_recovery_token_hash bytea,
  p_now timestamptz
)
returns table (access_state text, role_id text, role_version bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_display_name text := btrim(p_display_name);
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

  insert into public.ground_documents (
    id,
    snapshot,
    last_mutation_at,
    recovery_token_hash,
    created_at
  ) values (
    p_document_id,
    p_initial_snapshot,
    p_now,
    p_recovery_token_hash,
    p_now
  );

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
    p_owner_id,
    normalized_display_name,
    'active',
    'owner',
    p_now,
    p_now
  );

  return query
    select participant.access_state, participant.role_id, participant.role_version
    from public.ground_participants as participant
    where participant.document_id = p_document_id
      and participant.user_id = p_owner_id;
end;
$function$;

create function public.ground_join_document(
  p_document_id text,
  p_user_id uuid,
  p_display_name text,
  p_now timestamptz
)
returns table (access_state text, role_id text, role_version bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  normalized_display_name text := btrim(p_display_name);
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
  on conflict (document_id, user_id) do update
  set display_name = excluded.display_name,
      updated_at = excluded.updated_at;

  return query
    select participant.access_state, participant.role_id, participant.role_version
    from public.ground_participants as participant
    where participant.document_id = p_document_id
      and participant.user_id = p_user_id;
end;
$function$;

revoke all on function public.ground_create_document(text, uuid, text, bytea, bytea, timestamptz)
  from public, anon, authenticated;
revoke all on function public.ground_join_document(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ground_create_document(text, uuid, text, bytea, bytea, timestamptz)
  to service_role;
grant execute on function public.ground_join_document(text, uuid, text, timestamptz)
  to service_role;

alter table public.ground_documents enable row level security;
alter table public.ground_participants enable row level security;

revoke all on table public.ground_documents, public.ground_participants
  from public, anon, authenticated;
grant select on table public.ground_documents, public.ground_participants
  to authenticated;
grant all privileges on table public.ground_documents, public.ground_participants
  to service_role;

create policy ground_documents_read_active_participant
on public.ground_documents
for select
to authenticated
using (
  exists (
    select 1
    from private.ground_participant(ground_documents.id, (select auth.uid())) as participant
    where participant.access_state = 'active'
  )
);

create policy ground_participants_read_self_or_owner
on public.ground_participants
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from private.ground_participant(ground_participants.document_id, (select auth.uid())) as participant
    where participant.access_state = 'active'
      and participant.role_id = 'owner'
  )
);
