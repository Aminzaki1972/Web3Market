-- W3M V1 rollout phase 1: immutable, server-owned protocol-track registry.
-- Development branch only. Do not apply to production without explicit approval.
--
-- This migration deliberately classifies every existing and browser-created deal
-- as legacy. It does NOT enable V1 deal creation or change Safe/release gates.
-- A later migration may add a trusted, atomic V1 creation path after its full
-- authorization and regression tests exist.

begin;

create schema if not exists w3m_private;
revoke all on schema w3m_private from public, anon, authenticated;
grant usage on schema w3m_private to service_role;

-- Serialize the backfill with all concurrent deal inserts. The AFTER INSERT
-- trigger is installed before releasing this lock, so no deal can fall between
-- the backfill and automatic classification.
lock table public.deals in share row exclusive mode;

create table if not exists w3m_private.w3m_deal_protocol_tracks (
  deal_id uuid primary key
    references public.deals(id) on delete restrict,
  protocol_track text not null
    check (protocol_track in ('legacy', 'v1')),
  assignment_source text not null
    check (assignment_source in (
      'legacy_backfill',
      'legacy_insert',
      'trusted_v1_creation'
    )),
  assigned_at timestamptz not null default clock_timestamp(),
  constraint w3m_deal_protocol_track_source_matches
    check (
      (protocol_track = 'legacy'
        and assignment_source in ('legacy_backfill', 'legacy_insert'))
      or
      (protocol_track = 'v1'
        and assignment_source = 'trusted_v1_creation')
    )
);

comment on table w3m_private.w3m_deal_protocol_tracks is
  'Immutable server-owned protocol classification for each deal. Browser roles have no table access.';

alter table w3m_private.w3m_deal_protocol_tracks
  enable row level security;
alter table w3m_private.w3m_deal_protocol_tracks
  force row level security;

revoke all on w3m_private.w3m_deal_protocol_tracks
  from public, anon, authenticated, service_role;

-- Existing deals are permanently classified as legacy. The lock above makes
-- this backfill atomic with installation of the insert trigger.
insert into w3m_private.w3m_deal_protocol_tracks
  (deal_id, protocol_track, assignment_source)
select d.id, 'legacy', 'legacy_backfill'
from public.deals d
on conflict (deal_id) do nothing;

create or replace function w3m_private.w3m_reject_deal_protocol_track_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $w3m$
begin
  raise exception 'w3m_deal_protocol_track_is_immutable'
    using errcode = '55000';
end;
$w3m$;

revoke all on function w3m_private.w3m_reject_deal_protocol_track_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists w3m_deal_protocol_tracks_immutable
  on w3m_private.w3m_deal_protocol_tracks;
create trigger w3m_deal_protocol_tracks_immutable
before update or delete on w3m_private.w3m_deal_protocol_tracks
for each row
execute function w3m_private.w3m_reject_deal_protocol_track_mutation();

create or replace function w3m_private.w3m_classify_new_deal_as_legacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $w3m$
begin
  -- Until the separately reviewed trusted V1 creation RPC exists, every
  -- INSERT path (including the current authenticated browser path) is legacy.
  insert into w3m_private.w3m_deal_protocol_tracks
    (deal_id, protocol_track, assignment_source)
  values
    (new.id, 'legacy', 'legacy_insert');

  return new;
end;
$w3m$;

revoke all on function w3m_private.w3m_classify_new_deal_as_legacy()
  from public, anon, authenticated, service_role;

drop trigger if exists w3m_deals_assign_protocol_track
  on public.deals;
create trigger w3m_deals_assign_protocol_track
after insert on public.deals
for each row
execute function w3m_private.w3m_classify_new_deal_as_legacy();

-- Edge Functions use this narrowly scoped RPC instead of querying the private
-- schema through PostgREST. Missing evidence raises an error (fail closed).
create or replace function public.w3m_get_deal_protocol_track(
  p_deal_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_result jsonb;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'deal_id', t.deal_id,
    'protocol_track', t.protocol_track,
    'assignment_source', t.assignment_source,
    'assigned_at', t.assigned_at
  )
  into v_result
  from w3m_private.w3m_deal_protocol_tracks t
  where t.deal_id = p_deal_id;

  if v_result is null then
    raise exception 'deal_protocol_track_missing'
      using errcode = '55000';
  end if;

  return v_result;
end;
$w3m$;

revoke all on function public.w3m_get_deal_protocol_track(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_get_deal_protocol_track(uuid)
  to service_role;

-- Migration-time invariant: every extant deal must now have exactly one row.
do $w3m_check$
begin
  if exists (
    select 1
    from public.deals d
    left join w3m_private.w3m_deal_protocol_tracks t
      on t.deal_id = d.id
    where t.deal_id is null
  ) then
    raise exception 'w3m_protocol_track_backfill_incomplete';
  end if;
end;
$w3m_check$;

commit;
