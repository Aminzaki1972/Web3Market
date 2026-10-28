-- Remove the limited support-agent feature while preserving all support conversations and messages.
-- Run this migration only after the application code no longer routes users to support-agent mode.

drop policy if exists support_conversations_select_participant_or_admin on public.support_conversations;
create policy support_conversations_select_participant_or_admin
on public.support_conversations for select to authenticated
using (
  (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
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
          or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
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
        (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
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
        (
          c.user_id = (select auth.uid())
          and (storage.foldername(name))[2] = (select auth.uid())::text
          and not (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
          and exists (
            select 1 from public.profiles p
            where p.id = c.user_id
              and lower(coalesce(p.role, '')) in ('buyer','seller')
          )
        )
        or (
          public.is_admin()
          and (select auth.jwt() ->> 'aal') = 'aal2'
          and (storage.foldername(name))[2] = c.user_id::text
        )
      )
  )
);

-- Keep private call signaling available to the conversation owner and AAL2 admins only.
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
        or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
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
        or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
      )
  )
);

drop function if exists private.support_is_support_agent();
drop table if exists public.support_agents;
