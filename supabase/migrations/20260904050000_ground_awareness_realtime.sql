create policy ground_awareness_realtime_read_active
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) ~ '^ground-awareness:[A-Za-z0-9_-]{22}$'
  and exists (
    select 1
    from private.ground_participant(
      substring((select realtime.topic()) from '^ground-awareness:(.+)$'),
      (select auth.uid())
    ) as participant
    where participant.access_state = 'active'
  )
);

create policy ground_awareness_realtime_write_active
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) ~ '^ground-awareness:[A-Za-z0-9_-]{22}$'
  and exists (
    select 1
    from private.ground_participant(
      substring((select realtime.topic()) from '^ground-awareness:(.+)$'),
      (select auth.uid())
    ) as participant
    where participant.access_state = 'active'
  )
);
