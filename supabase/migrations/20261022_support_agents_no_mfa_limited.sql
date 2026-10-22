-- Let explicitly assigned support agents read and reply without AAL2.
-- Administrator actions remain AAL2-only. Support agents cannot change thread status
-- or use voice/video call signaling without the administrator MFA requirement.

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
          or (public.is_admin() and (select auth.jwt() ->> 'aal') = 'aal2')
          or private.support_is_support_agent()
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
        or private.support_is_support_agent()
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
          and not ((public.is_admin() or private.support_is_support_agent()) and (select auth.jwt() ->> 'aal') = 'aal2')
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
        or (
          private.support_is_support_agent()
          and (storage.foldername(name))[2] = c.user_id::text
        )
      )
  )
);

-- Deliberately leave realtime call-signaling policies unchanged: support agents
-- without AAL2 can reply to messages but cannot initiate or accept calls.
