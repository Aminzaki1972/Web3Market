-- W3M Protocol V1: serialize dispute openings with Safe release execution.
-- Draft migration for the isolated feature branch. Do not apply to production
-- without explicit approval and a complete isolated integration test.

create table if not exists w3m_private.w3m_safe_release_claims (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  safe_tx_hash text not null check (safe_tx_hash ~* '^0x[0-9a-f]{64}$'),
  safe_nonce bigint not null check (safe_nonce >= 0),
  status text not null check (status in ('claimed','submitted','finalized','failed')),
  transaction_hash text check (transaction_hash is null or transaction_hash ~* '^0x[0-9a-f]{64}$'),
  failure_code text check (failure_code is null or failure_code in ('evm_revert','safe_execution_failure')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  submitted_at timestamptz,
  finalized_at timestamptz,
  failed_at timestamptz,
  unique (deal_id, safe_tx_hash, safe_nonce),
  check (status <> 'submitted' or transaction_hash is not null),
  check (status <> 'finalized' or (transaction_hash is not null and finalized_at is not null)),
  check (status <> 'failed' or (transaction_hash is not null and failure_code is not null and failed_at is not null))
);

create unique index if not exists w3m_safe_release_one_active_claim_per_deal
  on w3m_private.w3m_safe_release_claims (deal_id)
  where status in ('claimed','submitted');

alter table w3m_private.w3m_safe_release_claims enable row level security;
revoke all on w3m_private.w3m_safe_release_claims from public, anon, authenticated, service_role;

create or replace function w3m_private.w3m_guard_safe_release_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $w3m$
begin
  if tg_op = 'DELETE' then
    raise exception 'w3m_safe_release_claims_are_retained' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
    or new.deal_id is distinct from old.deal_id
    or new.safe_tx_hash is distinct from old.safe_tx_hash
    or new.safe_nonce is distinct from old.safe_nonce
    or new.created_at is distinct from old.created_at then
    raise exception 'w3m_safe_release_claim_identity_is_immutable' using errcode = '55000';
  end if;

  if old.status in ('finalized','failed') then
    raise exception 'w3m_safe_release_claim_is_terminal' using errcode = '55000';
  end if;

  if old.status = 'claimed' and new.status not in ('claimed','submitted','failed') then
    raise exception 'w3m_invalid_safe_release_claim_transition' using errcode = '55000';
  end if;
  if old.status = 'submitted' and new.status not in ('submitted','finalized','failed') then
    raise exception 'w3m_invalid_safe_release_claim_transition' using errcode = '55000';
  end if;

  if old.transaction_hash is not null
    and new.transaction_hash is distinct from old.transaction_hash then
    raise exception 'w3m_safe_release_transaction_hash_is_immutable' using errcode = '55000';
  end if;
  if new.status = 'submitted' and new.transaction_hash is null then
    raise exception 'w3m_submitted_claim_requires_transaction_hash' using errcode = '23514';
  end if;
  if new.status = 'finalized' and (new.transaction_hash is null or new.finalized_at is null) then
    raise exception 'w3m_finalized_claim_requires_verified_transaction' using errcode = '23514';
  end if;
  if new.status = 'failed'
    and (new.transaction_hash is null or new.failure_code is null or new.failed_at is null) then
    raise exception 'w3m_failed_claim_requires_confirmed_chain_failure' using errcode = '23514';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$w3m$;

drop trigger if exists w3m_safe_release_claim_guard on w3m_private.w3m_safe_release_claims;
create trigger w3m_safe_release_claim_guard
before update or delete on w3m_private.w3m_safe_release_claims
for each row execute function w3m_private.w3m_guard_safe_release_claim();

create or replace function w3m_private.w3m_guard_dispute_against_safe_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_deal_id uuid;
  v_deal_status text;
  v_dispute_status text;
begin
  if tg_op = 'UPDATE' then
    if new.deal_id is distinct from old.deal_id then
      raise exception 'w3m_dispute_deal_binding_is_immutable' using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_deal_id := old.deal_id;
  else
    v_deal_id := new.deal_id;
  end if;

  select d.status, d.dispute_status
    into v_deal_status, v_dispute_status
    from public.deals d
    where d.id = v_deal_id
    for update;

  if not found then
    -- A parent deal deletion cascades to deal_disputes after the parent row
    -- has become invisible. Preserve the existing ON DELETE CASCADE behavior.
    if tg_op = 'DELETE' then return old; end if;
    raise exception 'w3m_dispute_deal_not_found' using errcode = '23503';
  end if;

  if exists (
    select 1 from w3m_private.w3m_safe_release_claims c
    where c.deal_id = v_deal_id and c.status in ('claimed','submitted')
  ) then
    if tg_op = 'DELETE' then
      raise exception 'w3m_dispute_change_blocked_by_active_safe_release'
        using errcode = '55000';
    elsif lower(coalesce(new.status,'')) not in ('resolved','cancelled') then
      raise exception 'w3m_dispute_change_blocked_by_active_safe_release'
        using errcode = '55000';
    end if;
  end if;

  if tg_op <> 'DELETE'
    and lower(coalesce(v_deal_status,'')) in ('completed','cancelled','rejected')
    and lower(coalesce(new.status,'')) not in ('resolved','resolved_buyer','resolved_seller','closed','dismissed','rejected','cancelled','canceled','withdrawn') then
    raise exception 'w3m_dispute_cannot_be_opened_on_terminal_deal'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$w3m$;

drop trigger if exists w3m_dispute_safe_release_serialization on public.deal_disputes;
create trigger w3m_dispute_safe_release_serialization
before insert or update or delete on public.deal_disputes
for each row execute function w3m_private.w3m_guard_dispute_against_safe_release();

create or replace function w3m_private.w3m_guard_deal_state_against_safe_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $w3m$
begin
  if (new.status is distinct from old.status or new.dispute_status is distinct from old.dispute_status)
    and (lower(coalesce(new.status,'')) = 'disputed'
      or lower(coalesce(new.dispute_status,'')) not in ('none','resolved_buyer','resolved_seller','closed'))
    and exists (
      select 1 from w3m_private.w3m_safe_release_claims c
      where c.deal_id = new.id and c.status in ('claimed','submitted')
    ) then
    raise exception 'w3m_deal_dispute_state_blocked_by_active_safe_release'
      using errcode = '55000';
  end if;
  return new;
end;
$w3m$;

drop trigger if exists w3m_deal_safe_release_serialization on public.deals;
create trigger w3m_deal_safe_release_serialization
before update of status, dispute_status on public.deals
for each row execute function w3m_private.w3m_guard_deal_state_against_safe_release();

create or replace function public.w3m_claim_safe_release(
  p_deal_id uuid, p_safe_tx_hash text, p_safe_nonce bigint
) returns table (
  claim_id uuid, claim_status text, transaction_hash text, created boolean
)
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_deal public.deals%rowtype;
  v_claim w3m_private.w3m_safe_release_claims%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_safe_tx_hash is null
    or p_safe_tx_hash !~* '^0x[0-9a-f]{64}$'
    or p_safe_nonce is null or p_safe_nonce < 0 then
    raise exception 'invalid_safe_release_claim_parameters' using errcode = '22023';
  end if;

  -- Every V1 dispute and release claim serializes on this same deal row.
  select * into v_deal from public.deals d where d.id = p_deal_id for update;
  if not found then
    raise exception 'safe_release_deal_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(v_deal.status,'')) in ('completed','cancelled','rejected','disputed')
    or lower(coalesce(v_deal.dispute_status,'')) not in ('none','resolved_buyer','resolved_seller','closed')
    or v_deal.release_tx_hash is not null then
    raise exception 'safe_release_deal_is_not_eligible' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.deal_disputes d
    where d.deal_id = p_deal_id
      and lower(coalesce(d.status,'open')) not in ('resolved','cancelled')
  ) then
    raise exception 'safe_release_dispute_is_open' using errcode = '55000';
  end if;

  select * into v_claim
    from w3m_private.w3m_safe_release_claims c
    where c.deal_id = p_deal_id and c.status in ('claimed','submitted')
    for update;
  if found then
    if lower(v_claim.safe_tx_hash) <> lower(p_safe_tx_hash)
      or v_claim.safe_nonce <> p_safe_nonce then
      raise exception 'another_safe_release_claim_is_active' using errcode = '23505';
    end if;
    return query select v_claim.id, v_claim.status, v_claim.transaction_hash, false;
    return;
  end if;

  if exists (
    select 1 from w3m_private.w3m_safe_release_claims c
    where c.deal_id = p_deal_id and c.status = 'finalized'
  ) then
    raise exception 'safe_release_already_finalized' using errcode = '23505';
  end if;

  insert into w3m_private.w3m_safe_release_claims
    (deal_id, safe_tx_hash, safe_nonce, status)
  values (p_deal_id, lower(p_safe_tx_hash), p_safe_nonce, 'claimed')
  returning * into v_claim;

  return query select v_claim.id, v_claim.status, v_claim.transaction_hash, true;
end;
$w3m$;

create or replace function public.w3m_mark_safe_release_submitted(
  p_deal_id uuid, p_safe_tx_hash text, p_safe_nonce bigint, p_transaction_hash text
) returns text
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_claim w3m_private.w3m_safe_release_claims%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_safe_tx_hash is null or p_safe_tx_hash !~* '^0x[0-9a-f]{64}$'
    or p_safe_nonce is null or p_safe_nonce < 0
    or p_transaction_hash is null or p_transaction_hash !~* '^0x[0-9a-f]{64}$' then
    raise exception 'invalid_safe_release_submission_parameters' using errcode = '22023';
  end if;
  perform 1 from public.deals d where d.id = p_deal_id for update;
  if not found then raise exception 'safe_release_deal_not_found' using errcode = 'P0002'; end if;
  select * into v_claim from w3m_private.w3m_safe_release_claims c
    where c.deal_id=p_deal_id and lower(c.safe_tx_hash)=lower(p_safe_tx_hash)
      and c.safe_nonce=p_safe_nonce for update;
  if not found then raise exception 'safe_release_claim_not_found' using errcode = 'P0002'; end if;
  if v_claim.status in ('submitted','finalized','failed')
    and lower(coalesce(v_claim.transaction_hash,''))=lower(p_transaction_hash) then
    return v_claim.status;
  end if;
  if v_claim.status <> 'claimed' then
    raise exception 'safe_release_claim_cannot_be_submitted' using errcode = '55000';
  end if;
  update w3m_private.w3m_safe_release_claims
    set status='submitted', transaction_hash=lower(p_transaction_hash), submitted_at=clock_timestamp()
    where id=v_claim.id;
  return 'submitted';
end;
$w3m$;

create or replace function public.w3m_mark_safe_release_failed(
  p_deal_id uuid, p_safe_tx_hash text, p_safe_nonce bigint,
  p_transaction_hash text, p_failure_code text
) returns text
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_claim w3m_private.w3m_safe_release_claims%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_safe_tx_hash is null or p_safe_tx_hash !~* '^0x[0-9a-f]{64}$'
    or p_safe_nonce is null or p_safe_nonce < 0
    or p_transaction_hash is null or p_transaction_hash !~* '^0x[0-9a-f]{64}$'
    or p_failure_code not in ('evm_revert','safe_execution_failure') then
    raise exception 'invalid_safe_release_failure_parameters' using errcode = '22023';
  end if;
  perform 1 from public.deals d where d.id = p_deal_id for update;
  if not found then raise exception 'safe_release_deal_not_found' using errcode = 'P0002'; end if;
  select * into v_claim from w3m_private.w3m_safe_release_claims c
    where c.deal_id=p_deal_id and lower(c.safe_tx_hash)=lower(p_safe_tx_hash)
      and c.safe_nonce=p_safe_nonce for update;
  if not found then raise exception 'safe_release_claim_not_found' using errcode = 'P0002'; end if;
  if v_claim.status = 'failed'
    and lower(v_claim.transaction_hash)=lower(p_transaction_hash)
    and v_claim.failure_code=p_failure_code then return v_claim.status; end if;
  if v_claim.status not in ('claimed','submitted') then
    raise exception 'safe_release_claim_cannot_be_failed' using errcode = '55000';
  end if;
  if v_claim.transaction_hash is not null
    and lower(v_claim.transaction_hash) <> lower(p_transaction_hash) then
    raise exception 'safe_release_failure_transaction_hash_mismatch' using errcode = '23503';
  end if;
  update w3m_private.w3m_safe_release_claims
    set status='failed', transaction_hash=lower(p_transaction_hash),
        failure_code=p_failure_code, failed_at=clock_timestamp()
    where id=v_claim.id;
  return 'failed';
end;
$w3m$;

create or replace function public.w3m_mark_safe_release_finalized(
  p_deal_id uuid, p_safe_tx_hash text, p_safe_nonce bigint, p_transaction_hash text
) returns text
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_claim w3m_private.w3m_safe_release_claims%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_safe_tx_hash is null or p_safe_tx_hash !~* '^0x[0-9a-f]{64}$'
    or p_safe_nonce is null or p_safe_nonce < 0
    or p_transaction_hash is null or p_transaction_hash !~* '^0x[0-9a-f]{64}$' then
    raise exception 'invalid_safe_release_finalization_parameters' using errcode = '22023';
  end if;
  perform 1 from public.deals d where d.id = p_deal_id for update;
  if not found then raise exception 'safe_release_deal_not_found' using errcode = 'P0002'; end if;
  select * into v_claim from w3m_private.w3m_safe_release_claims c
    where c.deal_id=p_deal_id and lower(c.safe_tx_hash)=lower(p_safe_tx_hash)
      and c.safe_nonce=p_safe_nonce for update;
  if not found then raise exception 'safe_release_claim_not_found' using errcode = 'P0002'; end if;
  if v_claim.status='finalized' and lower(v_claim.transaction_hash)=lower(p_transaction_hash) then
    return v_claim.status;
  end if;
  if v_claim.status not in ('claimed','submitted')
    or (v_claim.transaction_hash is not null and lower(v_claim.transaction_hash)<>lower(p_transaction_hash)) then
    raise exception 'safe_release_claim_cannot_be_finalized' using errcode = '55000';
  end if;
  update w3m_private.w3m_safe_release_claims
    set status='finalized', transaction_hash=lower(p_transaction_hash),
        submitted_at=coalesce(submitted_at,clock_timestamp()), finalized_at=clock_timestamp()
    where id=v_claim.id;
  return 'finalized';
end;
$w3m$;

revoke all on function public.w3m_claim_safe_release(uuid,text,bigint)
  from public, anon, authenticated;
revoke all on function public.w3m_mark_safe_release_submitted(uuid,text,bigint,text)
  from public, anon, authenticated;
revoke all on function public.w3m_mark_safe_release_failed(uuid,text,bigint,text,text)
  from public, anon, authenticated;
revoke all on function public.w3m_mark_safe_release_finalized(uuid,text,bigint,text)
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_guard_safe_release_claim()
  from public, anon, authenticated, service_role;
revoke all on function w3m_private.w3m_guard_dispute_against_safe_release()
  from public, anon, authenticated, service_role;
revoke all on function w3m_private.w3m_guard_deal_state_against_safe_release()
  from public, anon, authenticated, service_role;

grant execute on function public.w3m_claim_safe_release(uuid,text,bigint) to service_role;
grant execute on function public.w3m_mark_safe_release_submitted(uuid,text,bigint,text) to service_role;
grant execute on function public.w3m_mark_safe_release_failed(uuid,text,bigint,text,text) to service_role;
grant execute on function public.w3m_mark_safe_release_finalized(uuid,text,bigint,text) to service_role;

comment on table w3m_private.w3m_safe_release_claims is
  'W3M V1 durable Safe release claims; claimed/submitted states block new disputes until a chain-confirmed terminal outcome.';
