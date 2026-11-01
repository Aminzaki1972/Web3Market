-- Limited support-agent access: read support threads and reply only.
-- This migration deliberately does not change profiles.role or admin_users.
create table if not exists public.support_agents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.support_agents enable row level security;
revoke all on public.support_agents from public, anon;
grant select on public.support_agents to authenticated;
drop policy if exists support_agents_read_own_assignment on public.support_agents;
create policy support_agents_read_own_assignment
on public.support_agents for select to authenticated
using (user_id = (select auth.uid()));

create or replace function private.support_is_support_agent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_agents a
    where a.user_id = (select auth.uid())
  )
$$;
revoke all on function private.support_is_support_agent() from public, anon;
grant execute on function private.support_is_support_agent() to authenticated;

drop policy if exists support_conversations_select_participant_or_admin on public.support_conversations;
create policy support_conversations_select_participant_or_admin
on public.support_conversations for select to authenticated
using (
  (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
  or private.support_is_support_agent()
  or (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and lower(coalesce(p.role, '')) in ('buyer','seller')
    )
  )
);

drop policy if exists support_messages_select_participant_or_admin on public.support_messages;
create policy support_messages_select_participant_or_admin
on public.support_messages for select to authenticated
using (
  (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
  or private.support_is_support_agent()
  or exists (
    select 1 from public.support_conversations c
    join public.profiles p on p.id = c.user_id
    where c.id = support_messages.conversation_id
      and c.user_id = (select auth.uid())
      and lower(coalesce(p.role, '')) in ('buyer','seller')
  )
);

drop policy if exists support_messages_insert_sender_authorized on public.support_messages;
create policy support_messages_insert_sender_authorized
on public.support_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and (
    (
      public.is_admin()
      and (select auth.jwt() ->> 'aal') = 'aal2'
      and exists (
        select 1 from public.support_conversations c
        where c.id = support_messages.conversation_id and c.status = 'open'
      )
    )
    or (
      private.support_is_support_agent()
      and exists (
        select 1 from public.support_conversations c
        where c.id = support_messages.conversation_id and c.status = 'open'
      )
    )
    or exists (
      select 1 from public.support_conversations c
      join public.profiles p on p.id = c.user_id
      where c.id = support_messages.conversation_id
        and c.user_id = (select auth.uid())
        and c.status = 'open'
        and lower(coalesce(p.role, '')) in ('buyer','seller')
    )
  )
  and (
    attachment_path is null
    or exists (
      select 1 from public.support_conversations c
      where c.id = support_messages.conversation_id
        and split_part(attachment_path, '/', 1) = c.id::text
        and split_part(attachment_path, '/', 2) = c.user_id::text
        and (
          c.user_id = (select auth.uid())
          or (
            (public.is_admin() or private.support_is_support_agent())
            and (select auth.jwt() ->> 'aal') = 'aal2'
          )
        )
    )
  )
);

drop policy if exists support_attachments_read_participant_or_admin on storage.objects;
create policy support_attachments_read_participant_or_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_conversations c
    where c.id::text = (storage.foldername(name))[1]
      and (storage.foldername(name))[2] = c.user_id::text
      and (
        ((public.is_admin() or private.support_is_support_agent()) and (select auth.jwt() ->> 'aal') = 'aal2')
        or (
          c.user_id = (select auth.uid())
          and exists (
            select 1 from public.profiles p
            where p.id = c.user_id
              and lower(coalesce(p.role, '')) in ('buyer','seller')
          )
        )
      )
  )
);

drop policy if exists support_attachments_insert_participant_or_admin on storage.objects;
create policy support_attachments_insert_participant_or_admin
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_conversations c
    where c.id::text = (storage.foldername(name))[1]
      and c.status = 'open'
      and (
        (c.user_id = (select auth.uid())
          and (storage.foldername(name))[2] = (select auth.uid())::text
          and not ((public.is_admin() or private.support_is_support_agent()) and (select auth.jwt() ->> 'aal') = 'aal2')
          and exists (
            select 1 from public.profiles p
            where p.id = c.user_id
              and lower(coalesce(p.role, '')) in ('buyer','seller')
          ))
        or (
          (public.is_admin() or private.support_is_support_agent())
          and (select auth.jwt() ->> 'aal') = 'aal2'
          and (storage.foldername(name))[2] = c.user_id::text
        )
      )
  )
);

-- Secure default: do not assign any support agent automatically in a production migration.
-- Add an explicitly approved account to public.support_agents through a separate,
-- access-controlled administrative procedure after verifying the intended identity.


-- Restrict private WebRTC signaling to the conversation owner, an AAL2 admin,
-- or an explicitly assigned AAL2 support agent. The browser uses topic
-- support-call:<conversation UUID>; no public channel access is granted.
drop policy if exists support_call_signal_read_participants on realtime.messages;
create policy support_call_signal_read_participants
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and topic = realtime.topic()
  and exists (
    select 1 from public.support_conversations c
    where realtime.topic() = ('support-call:' || c.id::text)
      and coalesce(c.status, 'open') <> 'closed'
      and (
        c.user_id = (select auth.uid())
        or (
          public.is_admin()
          and (select auth.jwt() ->> 'aal') = 'aal2'
        )
        or (
          private.support_is_support_agent()
          and (select auth.jwt() ->> 'aal') = 'aal2'
        )
      )
  )
);

drop policy if exists support_call_signal_send_participants on realtime.messages;
create policy support_call_signal_send_participants
on realtime.messages for insert to authenticated
with check (
  extension = 'broadcast'
  and topic = realtime.topic()
  and exists (
    select 1 from public.support_conversations c
    where realtime.topic() = ('support-call:' || c.id::text)
      and coalesce(c.status, 'open') <> 'closed'
      and (
        c.user_id = (select auth.uid())
        or (
          public.is_admin()
          and (select auth.jwt() ->> 'aal') = 'aal2'
        )
        or (
          private.support_is_support_agent()
          and (select auth.jwt() ->> 'aal') = 'aal2'
        )
      )
  )
);
