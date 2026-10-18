-- Community voting for public project listings.
-- This migration is intentionally staged in Git only; do not apply to production before review.

create table if not exists public.project_votes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_votes_one_vote_per_user unique (project_id, user_id)
);

create index if not exists project_votes_project_vote_idx
  on public.project_votes (project_id, vote);

alter table public.project_votes enable row level security;
revoke all on table public.project_votes from anon, authenticated;

create or replace function public.get_project_vote_summary(p_project_id uuid)
returns table (
  project_id uuid,
  positive_count bigint,
  negative_count bigint,
  total_votes bigint,
  user_vote smallint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.id,
    (select count(*)::bigint from public.project_votes pv where pv.project_id = p.id and pv.vote = 1),
    (select count(*)::bigint from public.project_votes pv where pv.project_id = p.id and pv.vote = -1),
    (select count(*)::bigint from public.project_votes pv where pv.project_id = p.id),
    (select pv.vote from public.project_votes pv where pv.project_id = p.id and pv.user_id = (select auth.uid()) limit 1)
  from public.projects p
  where p.id = p_project_id
    and p.status = 'active'
    and p.project_status = 'approved'
    and p.ai_status = 'approved'
    and coalesce(p.verification -> 'ai' ->> 'test_mode', 'false') <> 'true';
$function$;

create or replace function public.cast_project_vote(p_project_id uuid, p_vote smallint)
returns table (
  project_id uuid,
  positive_count bigint,
  negative_count bigint,
  total_votes bigint,
  user_vote smallint
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if p_project_id is null or p_vote is null or p_vote not in (-1, 1) then
    raise exception 'Invalid project vote';
  end if;

  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.status = 'active'
      and p.project_status = 'approved'
      and p.ai_status = 'approved'
      and coalesce(p.verification -> 'ai' ->> 'test_mode', 'false') <> 'true'
  ) then
    raise exception 'Project is not eligible for public voting';
  end if;

  insert into public.project_votes (project_id, user_id, vote)
  values (p_project_id, (select auth.uid()), p_vote)
  on conflict (project_id, user_id)
  do update set vote = excluded.vote, updated_at = now();

  return query
    select s.project_id, s.positive_count, s.negative_count, s.total_votes, s.user_vote
    from public.get_project_vote_summary(p_project_id) s;
end;
$function$;

create or replace function public.get_featured_project_by_votes()
returns table (
  id uuid,
  title text,
  short_description text,
  description text,
  price numeric,
  currency text,
  category text,
  logo_url text,
  cover_image_url text,
  positive_count bigint,
  negative_count bigint,
  total_votes bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.id,
    p.title,
    p.short_description,
    p.description,
    p.price,
    p.currency,
    p.category,
    p.logo_url,
    p.cover_image_url,
    count(*) filter (where pv.vote = 1)::bigint as positive_count,
    count(*) filter (where pv.vote = -1)::bigint as negative_count,
    count(*)::bigint as total_votes
  from public.projects p
  join public.project_votes pv on pv.project_id = p.id
  where p.status = 'active'
    and p.project_status = 'approved'
    and p.ai_status = 'approved'
    and coalesce(p.verification -> 'ai' ->> 'test_mode', 'false') <> 'true'
  group by p.id, p.title, p.short_description, p.description, p.price, p.currency,
           p.category, p.logo_url, p.cover_image_url, p.created_at
  having count(*) filter (where pv.vote = 1) > 0
  order by
    count(*) filter (where pv.vote = 1) desc,
    (count(*) filter (where pv.vote = 1) - count(*) filter (where pv.vote = -1)) desc,
    count(*) desc,
    p.created_at desc
  limit 1;
$function$;

revoke all on function public.get_project_vote_summary(uuid) from public, anon, authenticated;
revoke all on function public.cast_project_vote(uuid, smallint) from public, anon, authenticated;
revoke all on function public.get_featured_project_by_votes() from public, anon, authenticated;

grant execute on function public.get_project_vote_summary(uuid) to anon, authenticated;
grant execute on function public.cast_project_vote(uuid, smallint) to authenticated;
grant execute on function public.get_featured_project_by_votes() to anon, authenticated;
