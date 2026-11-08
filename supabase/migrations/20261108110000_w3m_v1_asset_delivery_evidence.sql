-- W3M Protocol V1: immutable, per-asset delivery evidence.
-- Draft branch migration. Do not apply to production without explicit approval.

create table if not exists w3m_private.w3m_deal_asset_events (
  event_no bigint generated always as identity unique,
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  asset_id uuid not null,
  asset_name text not null,
  event_type text not null check (event_type in ('delivered','accepted','rejected')),
  attempt_number integer not null check (attempt_number > 0),
  actor_user_id uuid not null,
  evidence_digest text,
  occurred_at timestamptz not null default clock_timestamp()
);

create index if not exists w3m_deal_asset_events_asset_order_idx
  on w3m_private.w3m_deal_asset_events(asset_id, event_no);
create index if not exists w3m_deal_asset_events_deal_idx
  on w3m_private.w3m_deal_asset_events(deal_id, asset_id);

alter table w3m_private.w3m_deal_asset_events enable row level security;
alter table w3m_private.w3m_deal_asset_events force row level security;
revoke all on w3m_private.w3m_deal_asset_events from public, anon, authenticated, service_role;

create or replace function w3m_private.w3m_reject_asset_event_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $w3m$
begin
  raise exception 'w3m_asset_delivery_evidence_is_immutable' using errcode = '55000';
end;
$w3m$;

drop trigger if exists w3m_asset_event_immutable on w3m_private.w3m_deal_asset_events;
create trigger w3m_asset_event_immutable
before update or delete on w3m_private.w3m_deal_asset_events
for each row execute function w3m_private.w3m_reject_asset_event_mutation();

create or replace function public.protect_deal_asset_updates()
returns trigger language plpgsql security definer set search_path = 'public'
as $function$
declare
  uid uuid := auth.uid();
  buyer_id uuid;
  seller_id uuid;
  is_admin boolean := exists (select 1 from public.admin_users a where a.user_id = uid);
begin
  select d.buyer_id, d.seller_id into buyer_id, seller_id
    from public.deals d where d.id = new.deal_id;

  if is_admin then return new; end if;

  if uid = seller_id then
    if new.deal_id <> old.deal_id
       or new.asset_name <> old.asset_name
       or new.accepted_by is distinct from old.accepted_by
       or new.accepted_at is distinct from old.accepted_at then
      raise exception 'Seller cannot modify asset identity or buyer acceptance fields';
    end if;
    if new.status not in ('pending','delivered') then
      raise exception 'Seller may only set asset status to pending or delivered';
    end if;
    if old.status = 'delivered' and new.status = 'delivered'
       and (new.delivery_url is distinct from old.delivery_url
         or new.evidence is distinct from old.evidence) then
      raise exception 'Seller must restart the delivery attempt before changing delivery evidence';
    end if;
    if new.status is distinct from old.status and old.status in ('accepted','rejected') then
      new.accepted_by := null;
      new.accepted_at := null;
    end if;
    if new.status = 'pending' then
      new.delivered_by := null;
      new.delivered_at := null;
    elsif new.status is distinct from old.status then
      new.delivered_by := uid;
      new.delivered_at := now();
    else
      new.delivered_by := old.delivered_by;
      new.delivered_at := old.delivered_at;
    end if;
    return new;
  end if;

  if uid = buyer_id then
    if new.deal_id <> old.deal_id
       or new.asset_name <> old.asset_name
       or new.delivery_url is distinct from old.delivery_url
       or new.evidence is distinct from old.evidence
       or new.delivered_by is distinct from old.delivered_by
       or new.delivered_at is distinct from old.delivered_at
       or new.accepted_by is distinct from old.accepted_by
       or new.accepted_at is distinct from old.accepted_at then
      raise exception 'Buyer may only accept or reject delivered assets';
    end if;
    if new.status not in ('delivered','accepted','rejected') then
      raise exception 'Buyer may only accept or reject delivered assets';
    end if;
    if new.status in ('accepted','rejected') then
      if old.status <> 'delivered' then
        raise exception 'Asset must be delivered before buyer response';
      end if;
      if new.status = 'accepted' then
        new.accepted_by := uid;
        new.accepted_at := now();
      end if;
    end if;
    return new;
  end if;

  raise exception 'Not authorized to modify this deal asset';
end;
$function$;

create or replace function w3m_private.w3m_record_deal_asset_transition()
returns trigger language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_type text;
  v_actor uuid;
  v_attempt integer;
  v_digest text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'delivered' then
    v_type := 'delivered';
    v_actor := coalesce(new.delivered_by, auth.uid());
    select coalesce(max(e.attempt_number), 0) + 1 into v_attempt
      from w3m_private.w3m_deal_asset_events e
      where e.asset_id = new.id and e.event_type = 'delivered';
  elsif new.status = 'accepted' then
    v_type := 'accepted';
    v_actor := coalesce(new.accepted_by, auth.uid());
    select coalesce(max(e.attempt_number), 1) into v_attempt
      from w3m_private.w3m_deal_asset_events e
      where e.asset_id = new.id and e.event_type = 'delivered';
  elsif new.status = 'rejected' then
    v_type := 'rejected';
    v_actor := auth.uid();
    select coalesce(max(e.attempt_number), 1) into v_attempt
      from w3m_private.w3m_deal_asset_events e
      where e.asset_id = new.id and e.event_type = 'delivered';
  else
    return new;
  end if;

  if v_actor is null then
    raise exception 'asset_transition_actor_required' using errcode = '42501';
  end if;

  v_digest := encode(extensions.digest(
    convert_to(coalesce(new.delivery_url, '') || chr(10) || coalesce(new.evidence, ''), 'UTF8'),
    'sha256'
  ), 'hex');

  insert into w3m_private.w3m_deal_asset_events
    (deal_id, asset_id, asset_name, event_type, attempt_number,
     actor_user_id, evidence_digest, occurred_at)
  values
    (new.deal_id, new.id, new.asset_name, v_type, v_attempt,
     v_actor, v_digest, clock_timestamp());

  return new;
end;
$w3m$;

drop trigger if exists w3m_record_deal_asset_transition on public.deal_assets;
create trigger w3m_record_deal_asset_transition
after update of status on public.deal_assets
for each row execute function w3m_private.w3m_record_deal_asset_transition();

create or replace function public.w3m_get_deal_asset_finalization_evidence(p_deal_id uuid)
returns table (deal_id uuid, buyer_id uuid, asset_rows jsonb)
language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_buyer uuid;
  v_assets jsonb;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  select d.buyer_id into v_buyer from public.deals d where d.id = p_deal_id;
  if not found or v_buyer is null then
    raise exception 'asset_finalization_deal_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'asset_id', a.id::text,
    'asset_name', a.asset_name,
    'status', a.status,
    'accepted_by', a.accepted_by::text,
    'accepted_at', a.accepted_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_type', e.event_type,
        'attempt_number', e.attempt_number,
        'actor_user_id', e.actor_user_id::text,
        'evidence_digest', e.evidence_digest,
        'occurred_at', e.occurred_at
      ) order by e.event_no)
      from w3m_private.w3m_deal_asset_events e
      where e.asset_id = a.id and e.deal_id = a.deal_id
    ), '[]'::jsonb)
  ) order by a.asset_name, a.id), '[]'::jsonb)
  into v_assets
  from public.deal_assets a
  where a.deal_id = p_deal_id;

  return query select p_deal_id, v_buyer, v_assets;
end;
$w3m$;

revoke all on function public.w3m_get_deal_asset_finalization_evidence(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_get_deal_asset_finalization_evidence(uuid)
  to service_role;

comment on table w3m_private.w3m_deal_asset_events is
  'Append-only W3M V1 per-asset delivery, acceptance, rejection and redelivery evidence; evidence is SHA-256 digested and raw evidence is not copied.';
