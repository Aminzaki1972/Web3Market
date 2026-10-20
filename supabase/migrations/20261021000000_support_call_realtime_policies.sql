-- Draft only: private WebRTC signaling for support conversations.
-- Review and apply separately only after the code has been tested.
-- Media is peer-to-peer; Supabase Realtime carries signaling messages only.

drop policy if exists "support_call_signal_read_participants" on realtime.messages;
create policy "support_call_signal_read_participants"
on realtime.messages for select to authenticated
using (
 extension = 'broadcast'
 and exists (
  select 1 from public.support_conversations c
  where realtime.topic() = 'support-call:' || c.id::text
   and (
    c.user_id = (select auth.uid())
    or (
     exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(coalesce(p.role,'')) = 'admin')
     and (select auth.jwt() ->> 'aal') = 'aal2'
    )
   )
 )
);

drop policy if exists "support_call_signal_send_participants" on realtime.messages;
create policy "support_call_signal_send_participants"
on realtime.messages for insert to authenticated
with check (
 extension = 'broadcast'
 and exists (
  select 1 from public.support_conversations c
  where realtime.topic() = 'support-call:' || c.id::text
   and (
    c.user_id = (select auth.uid())
    or (
     exists (select 1 from public.profiles p where p.id = (select auth.uid()) and lower(coalesce(p.role,'')) = 'admin')
     and (select auth.jwt() ->> 'aal') = 'aal2'
    )
   )
 )
);
