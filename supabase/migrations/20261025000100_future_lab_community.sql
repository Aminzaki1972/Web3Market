-- Future Lab community foundation
-- Draft migration only: do NOT apply to production.
-- Apply only after a dedicated Future Lab test Supabase project is approved and verified.

create table if not exists public.future_lab_author_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 60),
  bio text not null default '' check (char_length(bio) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.future_lab_articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 8 and 180),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  excerpt text not null check (char_length(trim(excerpt)) between 20 and 400),
  content text not null check (char_length(trim(content)) between 80 and 100000),
  category text not null check (category in ('Web3','AI','Smart Contracts','Security','Research','Development')),
  source_urls text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','pending','published','rejected')),
  review_note text,
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
  on public.future_lab_articles (created_at asc)
  where status = 'pending';

create table if not exists public.future_lab_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.future_lab_articles(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists future_lab_comments_article_idx
  on public.future_lab_comments (article_id, created_at asc);

create table if not exists public.future_lab_likes (
  article_id uuid not null references public.future_lab_articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, user_id)
);

create or replace function public.future_lab_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists future_lab_author_profiles_updated_at on public.future_lab_author_profiles;
create trigger future_lab_author_profiles_updated_at
before update on public.future_lab_author_profiles
for each row execute function public.future_lab_set_updated_at();

drop trigger if exists future_lab_articles_updated_at on public.future_lab_articles;
create trigger future_lab_articles_updated_at
before update on public.future_lab_articles
for each row execute function public.future_lab_set_updated_at();

alter table public.future_lab_author_profiles enable row level security;
alter table public.future_lab_articles enable row level security;
alter table public.future_lab_comments enable row level security;
alter table public.future_lab_likes enable row level security;

-- Public can see author profiles; only the owner can create/update their own profile.
drop policy if exists "Future Lab public author profiles are readable" on public.future_lab_author_profiles;
create policy "Future Lab public author profiles are readable"
on public.future_lab_author_profiles for select to anon, authenticated using (true);
drop policy if exists "Future Lab authors create own profile" on public.future_lab_author_profiles;
create policy "Future Lab authors create own profile"
on public.future_lab_author_profiles for insert to authenticated
with check (user_id = (select auth.uid()));
drop policy if exists "Future Lab authors update own profile" on public.future_lab_author_profiles;
create policy "Future Lab authors update own profile"
on public.future_lab_author_profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Public sees published content; authors see their own drafts/submissions; admins can review all.
drop policy if exists "Future Lab published articles are readable" on public.future_lab_articles;
create policy "Future Lab published articles are readable"
on public.future_lab_articles for select to anon, authenticated
using (
  status = 'published'
  or author_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  )
);

drop policy if exists "Future Lab authors create own drafts" on public.future_lab_articles;
create policy "Future Lab authors create own drafts"
on public.future_lab_articles for insert to authenticated
with check (
  author_id = (select auth.uid())
  and status in ('draft','pending')
  and reviewed_by is null
  and reviewed_at is null
  and published_at is null
);

-- Authors may edit drafts/rejected articles and submit them; they cannot publish or edit published content.
drop policy if exists "Future Lab authors update unapproved articles" on public.future_lab_articles;
create policy "Future Lab authors update unapproved articles"
on public.future_lab_articles for update to authenticated
using (
  author_id = (select auth.uid())
  and status in ('draft','rejected')
)
with check (
  author_id = (select auth.uid())
  and status in ('draft','pending','rejected')
  and reviewed_by is null
  and reviewed_at is null
  and published_at is null
);

drop policy if exists "Future Lab admins review articles" on public.future_lab_articles;
create policy "Future Lab admins review articles"
on public.future_lab_articles for update to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
)
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

drop policy if exists "Future Lab authors delete own drafts" on public.future_lab_articles;
create policy "Future Lab authors delete own drafts"
on public.future_lab_articles for delete to authenticated
using (
  author_id = (select auth.uid())
  and status in ('draft','rejected')
);

-- Comments are readable only for published articles; authenticated users can comment on published articles.
drop policy if exists "Future Lab comments on published articles are readable" on public.future_lab_comments;
create policy "Future Lab comments on published articles are readable"
on public.future_lab_comments for select to anon, authenticated
using (
  exists (select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published')
  or author_id = (select auth.uid())
  or exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin')
);
drop policy if exists "Future Lab signed-in users comment on published articles" on public.future_lab_comments;
create policy "Future Lab signed-in users comment on published articles"
on public.future_lab_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published')
);
drop policy if exists "Future Lab authors delete own comments" on public.future_lab_comments;
create policy "Future Lab authors delete own comments"
on public.future_lab_comments for delete to authenticated
using (
  author_id = (select auth.uid())
  or exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin')
);

-- Likes require authentication and are limited to published articles.
drop policy if exists "Future Lab likes on published articles are readable" on public.future_lab_likes;
create policy "Future Lab likes on published articles are readable"
on public.future_lab_likes for select to anon, authenticated
using (
  exists (select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published')
  or user_id = (select auth.uid())
);
drop policy if exists "Future Lab signed-in users like published articles" on public.future_lab_likes;
create policy "Future Lab signed-in users like published articles"
on public.future_lab_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.future_lab_articles a
    where a.id = article_id and a.status = 'published')
);
drop policy if exists "Future Lab users remove own likes" on public.future_lab_likes;
create policy "Future Lab users remove own likes"
on public.future_lab_likes for delete to authenticated
using (user_id = (select auth.uid()));

-- Keep the new tables out of public use until the dedicated test backend is ready.
-- Explicit grants will be reviewed and applied only in that isolated environment.
