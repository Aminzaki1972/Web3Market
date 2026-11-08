-- W3M V1: explicit buyer confirmation after every included asset is accepted.
-- This migration is applied only to isolated test databases until separately approved.

create table w3m_private.w3m_deal_delivery_confirmations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  buyer_user_id uuid not null,
  terms_version bigint not null check (terms_version > 0),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  asset_set_digest text not null check (asset_set_digest ~ '^[0-9a-f]{64}$'),
  asset_count integer not null check (asset_count > 0),
  confirmed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint w3m_deal_delivery_confirmations_unique_asset_set
    unique (deal_id, terms_version, asset_set_digest)
);

alter table w3m_private.w3m_deal_delivery_confirmations enable row level security;
alter table w3m_private.w3m_deal_delivery_confirmations force row level security;
revoke all on w3m_private.w3m_deal_delivery_confirmations
  from public, anon, authenticated, service_role;
create index w3m_deal_delivery_confirmations_latest_idx
  on w3m_private.w3m_deal_delivery_confirmations
  (deal_id, terms_version, confirmed_at desc);

create or replace function w3m_private.w3m_reject_delivery_confirmation_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $w3m$
begin
  raise exception 'w3m_deal_delivery_confirmations_are_append_only'
    using errcode = '55000';
end;
$w3m$;

revoke all on function w3m_private.w3m_reject_delivery_confirmation_mutation()
  from public, anon, authenticated, service_role;
create trigger w3m_deal_delivery_confirmations_append_only
  before update or delete on w3m_private.w3m_deal_delivery_confirmations
  for each row execute function w3m_private.w3m_reject_delivery_confirmation_mutation();

-- Preserve the existing detailed checklist validator under an explicit name.
-- The public Safe claim RPC will call the new "ready" wrapper below.
alter function w3m_private.w3m_assert_deal_assets_ready(uuid, uuid)
  rename to w3m_assert_deal_assets_accepted;

create or replace function w3m_private.w3m_current_accepted_asset_set(
  p_deal_id uuid, p_buyer_id uuid
) returns table (asset_set_digest text, asset_count integer)
language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_assets jsonb;
begin
  perform w3m_private.w3m_assert_deal_assets_accepted(p_deal_id, p_buyer_id);

  select jsonb_agg(jsonb_build_object(
    'asset_id', a.id,
    'asset_name', a.asset_name,
    'delivery_url', a.delivery_url,
    'delivered_by', a.delivered_by,
    'delivered_at', a.delivered_at,
    'accepted_by', a.accepted_by,
    'accepted_at', a.accepted_at,
    'attempt_number', latest.attempt_number,
    'evidence_digest', latest.evidence_digest,
    'accepted_event_at', latest.occurred_at
  ) order by lower(a.asset_name), a.id)
  into v_assets
  from public.deal_assets a
  join lateral (
    select e.attempt_number, e.evidence_digest, e.occurred_at
    from w3m_private.w3m_deal_asset_events e
    where e.deal_id = a.deal_id and e.asset_id = a.id
    order by e.event_no desc
    limit 1
  ) latest on true
  where a.deal_id = p_deal_id;

  if v_assets is null or jsonb_array_length(v_assets) = 0 then
    raise exception 'deal_requires_at_least_one_accepted_asset'
      using errcode = '55000';
  end if;

  return query
  select encode(extensions.digest(convert_to(v_assets::text, 'UTF8'), 'sha256'), 'hex'),
         jsonb_array_length(v_assets);
end;
$w3m$;

revoke all on function w3m_private.w3m_current_accepted_asset_set(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_confirm_deal_delivery_v1(
  p_deal_id uuid,
  p_buyer_user_id uuid
) returns table (
  confirmation_id uuid,
  terms_version bigint,
  terms_hash text,
  asset_set_digest text,
  asset_count integer,
  confirmed_at timestamptz,
  created boolean
)
language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_deal public.deals%rowtype;
  v_terms record;
  v_asset_set record;
  v_confirmation_id uuid;
  v_confirmed_at timestamptz;
  v_created boolean := false;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_buyer_user_id is null then
    raise exception 'deal_and_buyer_required' using errcode = '22023';
  end if;

  -- Serialize final confirmation with asset redelivery and Safe release claims.
  select * into v_deal
  from public.deals d
  where d.id = p_deal_id
  for update;
  if not found then
    raise exception 'deal_not_found' using errcode = 'P0002';
  end if;
  if v_deal.buyer_id is distinct from p_buyer_user_id then
    raise exception 'buyer_confirmation_required' using errcode = '42501';
  end if;
  if v_deal.status not in ('funded', 'in_progress')
    or v_deal.dispute_status is distinct from 'none'
    or exists (
      select 1 from public.deal_disputes d
      where d.deal_id = p_deal_id
        and lower(d.status) not in ('resolved', 'closed', 'dismissed')
    ) then
    raise exception 'deal_not_eligible_for_final_delivery_confirmation'
      using errcode = '55000';
  end if;

  select t.terms_version, t.terms_hash
    into v_terms
  from w3m_private.w3m_acquisition_terms_versions t
  where t.deal_id = p_deal_id and t.status = 'published';
  if not found then
    raise exception 'published_terms_required_for_final_delivery_confirmation'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from w3m_private.w3m_agreement_acceptances a
    where a.deal_id = p_deal_id and a.party_role = 'buyer'
      and a.user_id = v_deal.buyer_id
      and a.terms_version = v_terms.terms_version and a.terms_hash = v_terms.terms_hash
  ) or not exists (
    select 1 from w3m_private.w3m_agreement_acceptances a
    where a.deal_id = p_deal_id and a.party_role = 'seller'
      and a.user_id = v_deal.seller_id
      and a.terms_version = v_terms.terms_version and a.terms_hash = v_terms.terms_hash
  ) then
    raise exception 'both_parties_must_accept_current_terms_before_final_delivery_confirmation'
      using errcode = '55000';
  end if;

  select * into v_asset_set
  from w3m_private.w3m_current_accepted_asset_set(p_deal_id, v_deal.buyer_id);

  insert into w3m_private.w3m_deal_delivery_confirmations (
    deal_id, buyer_user_id, terms_version, terms_hash,
    asset_set_digest, asset_count
  ) values (
    p_deal_id, v_deal.buyer_id, v_terms.terms_version, v_terms.terms_hash,
    v_asset_set.asset_set_digest, v_asset_set.asset_count
  )
  on conflict on constraint w3m_deal_delivery_confirmations_unique_asset_set do nothing
  returning id, w3m_deal_delivery_confirmations.confirmed_at
    into v_confirmation_id, v_confirmed_at;

  if found then
    v_created := true;
  else
    select c.id, c.confirmed_at
      into v_confirmation_id, v_confirmed_at
    from w3m_private.w3m_deal_delivery_confirmations c
    where c.deal_id = p_deal_id
      and c.terms_version = v_terms.terms_version
      and c.asset_set_digest = v_asset_set.asset_set_digest;
  end if;

  return query select v_confirmation_id, v_terms.terms_version, v_terms.terms_hash,
    v_asset_set.asset_set_digest, v_asset_set.asset_count, v_confirmed_at, v_created;
end;
$w3m$;

create or replace function public.w3m_get_deal_delivery_confirmation_status(
  p_deal_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_buyer_id uuid;
  v_terms_version bigint;
  v_terms_hash text;
  v_confirmation_id uuid;
  v_confirmation_digest text;
  v_confirmation_count integer;
  v_confirmed_at timestamptz;
  v_current_digest text;
  v_current_count integer;
  v_assets_ready boolean := false;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  select d.buyer_id into v_buyer_id
  from public.deals d where d.id = p_deal_id;
  if not found then
    raise exception 'deal_not_found' using errcode = 'P0002';
  end if;

  select t.terms_version, t.terms_hash
    into v_terms_version, v_terms_hash
  from w3m_private.w3m_acquisition_terms_versions t
  where t.deal_id = p_deal_id and t.status = 'published';
  if not found then
    return jsonb_build_object(
      'confirmed', false, 'stale', false, 'reason', 'published_terms_missing'
    );
  end if;

  select c.id, c.asset_set_digest, c.asset_count, c.confirmed_at
    into v_confirmation_id, v_confirmation_digest, v_confirmation_count, v_confirmed_at
  from w3m_private.w3m_deal_delivery_confirmations c
  where c.deal_id = p_deal_id
    and c.terms_version = v_terms_version
    and c.terms_hash = v_terms_hash
  order by c.confirmed_at desc, c.id desc
  limit 1;

  begin
    select s.asset_set_digest, s.asset_count
      into v_current_digest, v_current_count
    from w3m_private.w3m_current_accepted_asset_set(p_deal_id, v_buyer_id) s;
    v_assets_ready := true;
  exception when sqlstate '55000' then
    v_assets_ready := false;
  end;

  return jsonb_build_object(
    'confirmed', v_assets_ready and v_confirmation_id is not null
      and v_confirmation_digest = v_current_digest,
    'stale', v_confirmation_id is not null and (
      not v_assets_ready or v_confirmation_digest is distinct from v_current_digest
    ),
    'confirmation_id', v_confirmation_id,
    'terms_version', v_terms_version,
    'terms_hash', v_terms_hash,
    'asset_set_digest', v_confirmation_digest,
    'asset_count', v_confirmation_count,
    'current_asset_count', v_current_count,
    'confirmed_at', v_confirmed_at
  );
end;
$w3m$;

create or replace function w3m_private.w3m_assert_deal_assets_ready(
  p_deal_id uuid, p_buyer_id uuid
) returns void language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_terms record;
  v_asset_set record;
  v_confirmation_digest text;
begin
  perform w3m_private.w3m_assert_deal_assets_accepted(p_deal_id, p_buyer_id);

  select t.terms_version, t.terms_hash
    into v_terms
  from w3m_private.w3m_acquisition_terms_versions t
  where t.deal_id = p_deal_id and t.status = 'published';
  if not found then
    raise exception 'published_terms_required_for_safe_release'
      using errcode = '55000';
  end if;

  select * into v_asset_set
  from w3m_private.w3m_current_accepted_asset_set(p_deal_id, p_buyer_id);

  select c.asset_set_digest into v_confirmation_digest
  from w3m_private.w3m_deal_delivery_confirmations c
  where c.deal_id = p_deal_id
    and c.terms_version = v_terms.terms_version
    and c.terms_hash = v_terms.terms_hash
  order by c.confirmed_at desc, c.id desc
  limit 1;

  if not found or v_confirmation_digest is distinct from v_asset_set.asset_set_digest then
    raise exception 'buyer_final_delivery_confirmation_required'
      using errcode = '55000';
  end if;
end;
$w3m$;

revoke all on function w3m_private.w3m_assert_deal_assets_ready(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function w3m_private.w3m_current_accepted_asset_set(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.w3m_confirm_deal_delivery_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_confirm_deal_delivery_v1(uuid, uuid)
  to service_role;

revoke all on function public.w3m_get_deal_delivery_confirmation_status(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_get_deal_delivery_confirmation_status(uuid)
  to service_role;
