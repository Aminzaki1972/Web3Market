-- Test-branch migration: support message read receipts and private typing broadcasts.
-- Do not apply to production without a separate reviewed migration rollout.

create table if not exists public.support_message_reads (
  message_id uuid not null references public.support_messages(id) on delete cascade,
  reader_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, reader_id)
);

alter table public.support_message_reads enable row level security;
revoke all on public.support_message_reads from public, anon;
grant select, insert on public.support_message_reads to authenticated;

drop policy if exists support_message_reads_select_authorized on public.support_message_reads;
create policy support_message_reads_select_authorized
on public.support_message_reads for select to authenticated
using (
  reader_id = (select auth.uid())
  or exists (
    select 1
    from public.support_messages m
    where m.id = support_message_reads.message_id
      and (
        m.sender_id = (select auth.uid())
        or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
        or (private.support_is_support_agent() and (select auth.jwt() ->> 'aal') = 'aal2')
        or exists (
          select 1 from public.support_conversations c
          where c.id = m.conversation_id and c.user_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists support_message_reads_insert_recipient_only on public.support_message_reads;
create policy support_message_reads_insert_recipient_only
on public.support_message_reads for insert to authenticated
with check (
  reader_id = (select auth.uid())
  and exists (
    select 1
    from public.support_messages m
    join public.support_conversations c on c.id = m.conversation_id
    where m.id = support_message_reads.message_id
      and m.sender_id <> (select auth.uid())
      and (
        c.user_id = (select auth.uid())
        or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
        or (private.support_is_support_agent() and (select auth.jwt() ->> 'aal') = 'aal2')
      )
  )
);

-- Private typing broadcasts are scoped to one conversation topic.
-- Realtime authorization policies assume the existing private support helpers.
drop policy if exists support_typing_receive_authorized on realtime.messages;
create policy support_typing_receive_authorized
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1 from public.support_conversations c
    where realtime.topic() = 'support-chat:' || c.id::text
      and (
        c.user_id = (select auth.uid())
        or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
        or private.support_is_support_agent()
      )
  )
);

drop policy if exists support_typing_send_authorized on realtime.messages;
create policy support_typing_send_authorized
on realtime.messages for insert to authenticated
with check (
  extension = 'broadcast'
  and exists (
    select 1 from public.support_conversations c
    where realtime.topic() = 'support-chat:' || c.id::text
      and (
        c.user_id = (select auth.uid())
        or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
        or private.support_is_support_agent()
      )
  )
);
