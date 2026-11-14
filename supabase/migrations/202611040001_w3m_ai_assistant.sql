-- W3M AI Assistant: isolated conversation storage with owner-only RLS.
-- Apply only after review in a non-production environment.
create table if not exists public.w3m_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'W3M AI Assistant',
  language text not null default 'en' check (language in ('ar','en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists w3m_ai_conversations_user_updated_idx
  on public.w3m_ai_conversations(user_id, updated_at desc);

create table if not exists public.w3m_ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.w3m_ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (char_length(content) between 1 and 12000),
  created_at timestamptz not null default now()
);
create index if not exists w3m_ai_messages_conversation_created_idx
  on public.w3m_ai_messages(conversation_id, created_at);

alter table public.w3m_ai_conversations enable row level security;
alter table public.w3m_ai_messages enable row level security;

drop policy if exists "Users read own W3M AI conversations" on public.w3m_ai_conversations;
create policy "Users read own W3M AI conversations"
  on public.w3m_ai_conversations for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users create own W3M AI conversations" on public.w3m_ai_conversations;
create policy "Users create own W3M AI conversations"
  on public.w3m_ai_conversations for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users update own W3M AI conversations" on public.w3m_ai_conversations;
create policy "Users update own W3M AI conversations"
  on public.w3m_ai_conversations for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read own W3M AI messages" on public.w3m_ai_messages;
create policy "Users read own W3M AI messages"
  on public.w3m_ai_messages for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "Users create own W3M AI messages" on public.w3m_ai_messages;
create policy "Users create own W3M AI messages"
  on public.w3m_ai_messages for insert to authenticated
  with check (
    auth.uid() = user_id
    and role = 'user'
    and exists (
      select 1 from public.w3m_ai_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

grant select, insert, update on public.w3m_ai_conversations to authenticated;
grant select, insert on public.w3m_ai_messages to authenticated;
grant usage, select on sequence public.w3m_ai_messages_id_seq to authenticated;
