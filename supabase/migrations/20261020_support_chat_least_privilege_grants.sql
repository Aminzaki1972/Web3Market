-- Tighten table-level privileges for private support chat.
-- RLS remains the row-level authorization layer; SQL grants must also be least-privilege.
revoke all privileges on table public.support_conversations from public, anon, authenticated;
revoke all privileges on table public.support_messages from public, anon, authenticated;

grant select, insert on table public.support_conversations to authenticated;
grant update (status) on table public.support_conversations to authenticated;
grant select, insert on table public.support_messages to authenticated;
