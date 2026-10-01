-- Web3Market: public 24-hour page-view counter
-- Idempotent migration for the existing homepage traffic counter.

create table if not exists public.page_view_events (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  visitor_id text not null,
  visited_at timestamptz not null default now()
);

create index if not exists page_view_events_path_visited_at_idx
  on public.page_view_events (path, visited_at desc);

create index if not exists page_view_events_visited_at_idx
  on public.page_view_events (visited_at desc);

alter table public.page_view_events enable row level security;

revoke all on table public.page_view_events from anon, authenticated;

create or replace function public.record_page_view(p_path text, p_visitor_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_path is null
     or length(p_path) < 1
     or length(p_path) > 500
     or left(p_path, 1) <> '/'
     or p_path like '%://%'
  then
    return;
  end if;

  if p_visitor_id is null
     or length(p_visitor_id) < 16
     or length(p_visitor_id) > 128
  then
    return;
  end if;

  insert into public.page_view_events(path, visitor_id)
  select p_path, p_visitor_id
  where not exists (
    select 1
    from public.page_view_events
    where path = p_path
      and visitor_id = p_visitor_id
      and visited_at > now() - interval '30 minutes'
  );

  delete from public.page_view_events
  where visited_at < now() - interval '90 days';
end;
$function$;

create or replace function public.get_page_views_last_24h(p_path text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::bigint
  from public.page_view_events
  where path = p_path
    and visited_at >= now() - interval '24 hours';
$function$;

revoke all on function public.record_page_view(text, text) from public;
revoke all on function public.get_page_views_last_24h(text) from public;

grant execute on function public.record_page_view(text, text) to anon, authenticated;
grant execute on function public.get_page_views_last_24h(text) to anon, authenticated;
