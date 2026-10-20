-- Private admin-to-user support chat. Review and apply only after staging tests.
-- Does not alter deal_messages or the existing project-media bucket.
create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null default 'Web3Market Support' check (char_length(subject) between 1 and 160),
  user_email text not null default '',
  user_display_name text not null default 'Web3Market User',
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create or replace function public.support_set_conversation_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $
begin
  select coalesce(nullif(trim(p.display_name), ''), nullif(u.raw_user_meta_data ->> 'name', ''), 'Web3Market User'),
         coalesce(u.email, '')
    into new.user_display_name, new.user_email
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = new.user_id;
  if not found then
    raise exception 'Support account not found';
  end if;
  return new;
end;
$;
drop trigger if exists support_conversation_set_identity on public.support_conversations;
create trigger support_conversation_set_identity
before insert on public.support_conversations
for each row execute function public.support_set_conversation_identity();

create index if not exists support_conversations_user_last_idx
  on public.support_conversations(user_id, last_message_at desc);
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null default '' check (char_length(body) <= 10000),
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  created_at timestamptz not null default now(),
  constraint support_message_has_content check (
    char_length(trim(body)) > 0 or attachment_path is not null
  ),
  constraint support_attachment_fields_together check (
    (attachment_path is null and attachment_name is null and attachment_mime is null)
    or (attachment_path is not null and attachment_name is not null and attachment_mime is not null)
  )
);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages(conversation_id, created_at asc);
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
grant select, insert, update on public.support_conversations to authenticated;
grant select, insert on public.support_messages to authenticated;
drop policy if exists support_conversations_select_participant_or_admin on public.support_conversations;
create policy support_conversations_select_participant_or_admin
on public.support_conversations for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists support_conversations_insert_own on public.support_conversations;
create policy support_conversations_insert_own
on public.support_conversations for insert to authenticated
with check (user_id = (select auth.uid()) and not public.is_admin());
drop policy if exists support_conversations_admin_update on public.support_conversations;
create policy support_conversations_admin_update
on public.support_conversations for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists support_messages_select_participant_or_admin on public.support_messages;
create policy support_messages_select_participant_or_admin
on public.support_messages for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.support_conversations c
    where c.id = support_messages.conversation_id and c.user_id = (select auth.uid())
  )
);
drop policy if exists support_messages_insert_sender_authorized on public.support_messages;
create policy support_messages_insert_sender_authorized
on public.support_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and (
    public.is_admin()
    or exists (
      select 1 from public.support_conversations c
      where c.id = support_messages.conversation_id
        and c.user_id = (select auth.uid())
        and c.status = 'open'
    )
  )
  and (
    attachment_path is null
    or exists (
      select 1 from public.support_conversations c
      where c.id = support_messages.conversation_id
        and split_part(attachment_path, '/', 1) = c.id::text
        and split_part(attachment_path, '/', 2) = c.user_id::text
        and (c.user_id = (select auth.uid()) or public.is_admin())
    )
  )
);
create or replace function public.support_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_conversations
     set last_message_at = new.created_at, updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists support_messages_touch_conversation on public.support_messages;
create trigger support_messages_touch_conversation
after insert on public.support_messages
for each row execute function public.support_touch_conversation();

-- Private attachments are isolated from the public project-media bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists support_attachments_read_participant_or_admin on storage.objects;
create policy support_attachments_read_participant_or_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_conversations c
    where c.id::text = (storage.foldername(name))[1]
      and (c.user_id = (select auth.uid()) or public.is_admin())
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
      and (
        (c.user_id = (select auth.uid()) and (storage.foldername(name))[2] = (select auth.uid())::text and not public.is_admin())
        or (public.is_admin() and (storage.foldername(name))[2] = c.user_id::text)
      )
  )
);
-- No update/delete policies are intentionally granted for support attachments.
