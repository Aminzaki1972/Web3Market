-- Public aggregate project page views. No visitor identities or per-visitor logs are stored.
create table if not exists public.project_view_counts (
  project_id uuid primary key references public.projects(id) on delete cascade,
  total_views bigint not null default 0 check (total_views >= 0),
  updated_at timestamptz not null default now()
);

alter table public.project_view_counts enable row level security;
revoke all on public.project_view_counts from anon, authenticated;
grant select, insert, update, delete on public.project_view_counts to service_role;

create or replace function public.record_project_page_view(p_project_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_total bigint;
begin
  if p_project_id is null then
    return 0;
  end if;

  -- Do not count drafts, rejected projects, or test-mode listings.
  if not exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.status in ('active', 'sold')
      and coalesce(p.verification #>> '{ai,test_mode}', 'false') <> 'true'
  ) then
    return 0;
  end if;

  insert into public.project_view_counts (project_id, total_views, updated_at)
  values (p_project_id, 1, now())
  on conflict (project_id)
  do update set total_views = public.project_view_counts.total_views + 1,
                updated_at = now()
  returning total_views into v_total;

  return v_total;
end;
$function$;

create or replace function public.get_project_page_view_count(p_project_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select c.total_views
    from public.project_view_counts c
    join public.projects p on p.id = c.project_id
    where c.project_id = p_project_id
      and p.status in ('active', 'sold')
      and coalesce(p.verification #>> '{ai,test_mode}', 'false') <> 'true'
  ), 0)::bigint;
$function$;

revoke all on function public.record_project_page_view(uuid) from public;
revoke all on function public.get_project_page_view_count(uuid) from public;
grant execute on function public.record_project_page_view(uuid) to anon, authenticated;
grant execute on function public.get_project_page_view_count(uuid) to anon, authenticated;
