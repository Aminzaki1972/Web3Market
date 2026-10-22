-- Align support-agent RLS with the frontend: explicitly assigned agents use normal authenticated sessions,
-- while administrator access continues to require AAL2. These policies grant no status-management rights.
create policy support_agent_read_all_conversations
on public.support_conversations for select to authenticated
using (private.support_is_support_agent());

create policy support_agent_read_all_messages
on public.support_messages for select to authenticated
using (private.support_is_support_agent());

create policy support_agent_reply_to_open_conversations
on public.support_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and private.support_is_support_agent()
  and exists (
    select 1 from public.support_conversations c
    where c.id = support_messages.conversation_id
      and c.status = 'open'
      and (
        attachment_path is null
        or (
          split_part(attachment_path, '/', 1) = c.id::text
          and split_part(attachment_path, '/', 2) = c.user_id::text
        )
      )
  )
);

create policy support_agent_read_attachments_without_aal2
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and private.support_is_support_agent()
  and exists (
    select 1 from public.support_conversations c
    where c.id::text = (storage.foldername(name))[1]
      and (storage.foldername(name))[2] = c.user_id::text
  )
);

create policy support_agent_upload_attachments_without_aal2
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and private.support_is_support_agent()
  and exists (
    select 1 from public.support_conversations c
    where c.id::text = (storage.foldername(name))[1]
      and c.status = 'open'
      and (storage.foldername(name))[2] = c.user_id::text
  )
);

create policy support_agent_read_call_signals_without_aal2
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and topic = realtime.topic()
  and private.support_is_support_agent()
  and exists (
    select 1 from public.support_conversations c
    where realtime.topic() = ('support-call:' || c.id::text)
      and coalesce(c.status, 'open') <> 'closed'
  )
);

create policy support_agent_send_call_signals_without_aal2
on realtime.messages for insert to authenticated
with check (
  extension = 'broadcast'
  and topic = realtime.topic()
  and private.support_is_support_agent()
  and exists (
    select 1 from public.support_conversations c
    where realtime.topic() = ('support-call:' || c.id::text)
      and coalesce(c.status, 'open') <> 'closed'
  )
);
