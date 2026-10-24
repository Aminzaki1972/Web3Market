-- FUTURE LAB COMMUNITY: isolated preview migration draft.
-- DO NOT apply to production until reviewed and tested on a dedicated test project.
-- Requires public.profiles(id, role) and auth.users to exist.
begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to anon, authenticated;

create or replace function private.future_lab_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.role, '')) = 'admin'
  )
$$;
-- This helper returns only a boolean derived from auth.uid(); anonymous calls always resolve false.
revoke all on function private.future_lab_is_admin() from public;
grant execute on function private.future_lab_is_admin() to anon, authenticated;

create table if not exists public.future_lab_articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 8 and 180),
  category text not null check (category in ('Web3','AI','Smart Contracts','Security','Research','Development')),
  summary text not null check (char_length(trim(summary)) between 20 and 400),
  content text not null check (char_length(trim(content)) between 80 and 50000),
  sources text not null default '',
  status text not null default 'draft' check (status in ('draft','pending_review','changes_requested','published','rejected')),
  moderation_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists future_lab_articles_public_idx
  on public.future_lab_articles (published_at desc)
  where status = 'published';
create index if not exists future_lab_articles_author_idx
  on public.future_lab_articles (author_id, updated_at desc);
create index if not exists future_lab_articles_review_idx
  on public.future_lab_articles (status, created_at asc);

create table if not exists public.future_lab_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.future_lab_articles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists future_lab_comments_article_idx
  on public.future_lab_comments (article_id, created_at asc);

create table if not exists public.future_lab_likes (
  article_id uuid not null references public.future_lab_articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);
create index if not exists future_lab_likes_article_idx
  on public.future_lab_likes (article_id);

alter table public.future_lab_articles enable row level security;
alter table public.future_lab_comments enable row level security;
alter table public.future_lab_likes enable row level security;

revoke all on public.future_lab_articles from anon, authenticated;
revoke all on public.future_lab_comments from anon, authenticated;
revoke all on public.future_lab_likes from anon, authenticated;
grant select on public.future_lab_articles to anon, authenticated;
grant insert, update, delete on public.future_lab_articles to authenticated;
grant select, insert, delete on public.future_lab_comments to authenticated;
grant select, insert, delete on public.future_lab_likes to authenticated;

-- Public readers can only see published articles. Authors can see their own submissions.
drop policy if exists future_lab_articles_read on public.future_lab_articles;
create policy future_lab_articles_read on public.future_lab_articles
for select to anon, authenticated
using (status = 'published' or author_id = (select auth.uid()) or (select private.future_lab_is_admin()));

drop policy if exists future_lab_articles_insert on public.future_lab_articles;
create policy future_lab_articles_insert on public.future_lab_articles
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and status in ('draft','pending_review')
  and reviewed_by is null
  and reviewed_at is null
  and published_at is null
);

drop policy if exists future_lab_articles_author_update on public.future_lab_articles;
create policy future_lab_articles_author_update on public.future_lab_articles
for update to authenticated
using (author_id = (select auth.uid()) and status in ('draft','pending_review','changes_requested'))
with check (
  author_id = (select auth.uid())
  and status in ('draft','pending_review','changes_requested')
  and reviewed_by is null
  and reviewed_at is null
  and published_at is null
);

drop policy if exists future_lab_articles_author_delete on public.future_lab_articles;
create policy future_lab_articles_author_delete on public.future_lab_articles
for delete to authenticated
using (author_id = (select auth.uid()) and status in ('draft','pending_review','rejected'));

drop policy if exists future_lab_articles_admin_manage on public.future_lab_articles;
create policy future_lab_articles_admin_manage on public.future_lab_articles
for all to authenticated
using ((select private.future_lab_is_admin()))
with check ((select private.future_lab_is_admin()));

drop policy if exists future_lab_comments_read on public.future_lab_comments;
create policy future_lab_comments_read on public.future_lab_comments
for select to anon, authenticated
using (
  exists (
    select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published'
  )
  or author_id = (select auth.uid())
  or (select private.future_lab_is_admin())
);

drop policy if exists future_lab_comments_insert on public.future_lab_comments;
create policy future_lab_comments_insert on public.future_lab_comments
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published'
  )
);

-- Comment editing is intentionally disabled in v1 to avoid cross-article reassignment.
-- Authors can delete their own comments and post a corrected replacement.
drop policy if exists future_lab_comments_author_delete on public.future_lab_comments;
create policy future_lab_comments_author_delete on public.future_lab_comments
for delete to authenticated
using (author_id = (select auth.uid()) or (select private.future_lab_is_admin()));

drop policy if exists future_lab_likes_read on public.future_lab_likes;
create policy future_lab_likes_read on public.future_lab_likes
for select to anon, authenticated
using (
  exists (
    select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published'
  )
  or user_id = (select auth.uid())
  or (select private.future_lab_is_admin())
);

drop policy if exists future_lab_likes_insert on public.future_lab_likes;
create policy future_lab_likes_insert on public.future_lab_likes
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published'
  )
);

drop policy if exists future_lab_likes_delete on public.future_lab_likes;
create policy future_lab_likes_delete on public.future_lab_likes
for delete to authenticated
using (user_id = (select auth.uid()) or (select private.future_lab_is_admin()));

commit;
