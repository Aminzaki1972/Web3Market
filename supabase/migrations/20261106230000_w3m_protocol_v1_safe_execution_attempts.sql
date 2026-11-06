-- W3M Protocol V1 — isolated Safe execution-attempt ledger.
-- Draft only. Do NOT deploy. No production Deal Room/Safe tables are modified.
-- Caller must verify the signed report cryptographically and run the complete
-- Safe execution guard before claiming. SQL checks signer registry state only.
-- Finalization/reconciliation are intentionally not implemented in this migration.

begin;

create table public.w3m_safe_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  transaction_id uuid not null references public.deal_multisig_transactions(id) on delete restrict,
  report_id uuid not null references public.w3m_acquisition_reports(id) on delete restrict,
  report_version integer not null check (report_version > 0),
  safe_tx_hash text not null check (safe_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  state text not null check (state in ('CLAIMED','BROADCAST','CONFIRMED','FAILED','RECONCILIATION_REQUIRED')),
  executor_ref text not null check (length(btrim(executor_ref)) between 1 and 160),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 16 and 160),
  broadcast_tx_hash text check (broadcast_tx_hash is null or broadcast_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  claimed_at timestamptz not null default now(),
  broadcast_at timestamptz,
  finalized_at timestamptz,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 100),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  constraint w3m_attempt_broadcast_state_check check (
    (state = 'CLAIMED' and broadcast_tx_hash is null and broadcast_at is null)
    or (state in ('BROADCAST','CONFIRMED')
        and broadcast_tx_hash is not null and broadcast_at is not null)
    or (state = 'RECONCILIATION_REQUIRED' and (
        (broadcast_tx_hash is null and broadcast_at is null)
        or (broadcast_tx_hash is not null and broadcast_at is not null)
    ))
    or state = 'FAILED'
  ),
  constraint w3m_attempt_finalized_state_check check (
    (state in ('CONFIRMED','FAILED') and finalized_at is not null)
    or (state in ('CLAIMED','BROADCAST','RECONCILIATION_REQUIRED') and finalized_at is null)
  )
);

create unique index w3m_safe_attempt_one_active_per_deal
  on public.w3m_safe_execution_attempts(deal_id)
  where state in ('CLAIMED','BROADCAST','RECONCILIATION_REQUIRED');
create unique index w3m_safe_attempt_one_per_safe_hash
  on public.w3m_safe_execution_attempts(safe_tx_hash);
create index w3m_safe_attempt_transaction_idx
  on public.w3m_safe_execution_attempts(transaction_id, claimed_at desc);

alter table public.w3m_safe_execution_attempts enable row level security;
revoke all on public.w3m_safe_execution_attempts from public, anon, authenticated, service_role;
grant select on public.w3m_safe_execution_attempts to service_role;

comment on table public.w3m_safe_execution_attempts is
  'Server-only idempotent execution attempt ledger for W3M Safe releases. Isolated draft; not deployed.';

create or replace function public.w3m_claim_safe_execution_attempt(
  p_deal_id uuid,
  p_transaction_id uuid,
  p_report_id uuid,
  p_safe_tx_hash text,
  p_executor_ref text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $claim$
declare
  v_deal public.deals%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_report public.w3m_acquisition_reports%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_signer record;
  v_amount numeric;
  v_fee_percent numeric;
  v_fee numeric;
  v_seller_net numeric;
  v_platform_wallet constant text := '0x2b15cc63ee3b833f502c065767695fa2b584f8c9';
  v_bnb_usdt constant text := '0x55d398326f99059ff775485246999027b3197955';
  v_existing public.w3m_safe_execution_attempts%rowtype;
  v_attempt_id uuid;
begin
  if p_deal_id is null or p_transaction_id is null or p_report_id is null
     or p_safe_tx_hash is null or p_safe_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or p_executor_ref is null or length(btrim(p_executor_ref)) not between 1 and 160
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 16 and 160 then
    raise exception 'Invalid Safe execution claim arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text, 0));

  -- Replay is returned before mutable state checks: a retry after broadcast must
  -- return the original claim, never attempt to create a second execution.
  select * into v_existing
    from public.w3m_safe_execution_attempts
   where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.deal_id = p_deal_id
       and v_existing.transaction_id = p_transaction_id
       and v_existing.report_id = p_report_id
       and lower(v_existing.safe_tx_hash) = lower(p_safe_tx_hash) then
      return jsonb_build_object(
        'claimed', v_existing.state in ('CLAIMED','BROADCAST','RECONCILIATION_REQUIRED'),
        'idempotent_replay', true,
        'attempt_id', v_existing.id,
        'state', v_existing.state
      );
    end if;
    raise exception 'Idempotency key reused for a different execution attempt'
      using errcode = '23505';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  select * into v_tx
    from public.deal_multisig_transactions
   where id = p_transaction_id and deal_id = p_deal_id
   for update;
  if not found then raise exception 'Safe transaction does not belong to deal' using errcode = '23514'; end if;

  select * into v_report
    from public.w3m_acquisition_reports
   where id = p_report_id
   for share;
  if not found then raise exception 'W3M report not found' using errcode = 'P0002'; end if;

  select * into v_policy
    from public.deal_release_policies
   where deal_id = p_deal_id
   for share;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;

  if v_report.deal_id is distinct from p_deal_id::text
     or v_report.project_id is distinct from v_deal.project_id::text
     or v_report.buyer_id is distinct from v_deal.buyer_id::text
     or v_report.seller_id is distinct from v_deal.seller_id::text
     or v_report.status is distinct from 'PASS'
     or v_report.report_version is distinct from (
       select max(r.report_version)
         from public.w3m_acquisition_reports r
        where r.deal_id = p_deal_id::text
     )
     or v_report.expires_at <= clock_timestamp()
     or v_report.report_signature is null
     or v_report.signer_key_id is null then
    raise exception 'Latest unexpired signed PASS report is not bound to this deal/project'
      using errcode = '23514';
  end if;

  select * into v_signer
    from public.w3m_trusted_signer_key_status
   where key_id = v_report.signer_key_id;
  if not found then
    raise exception 'Report signer key is not registered' using errcode = '23514';
  end if;
  if v_signer.status is distinct from 'ACTIVE'
     or v_report.issued_at < v_signer.valid_from
     or (v_signer.valid_until is not null and v_report.issued_at >= v_signer.valid_until) then
    raise exception 'Report signer is not trusted and valid at report issue time'
      using errcode = '23514';
  end if;

  if v_deal.payment_status is distinct from 'confirmed'
     or v_deal.payment_tx_hash is null
     or v_deal.payment_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or v_deal.delivery_status is distinct from 'accepted'
     or v_deal.buyer_approved_at is null
     or coalesce(v_deal.dispute_status, 'none') <> 'none'
     or v_deal.chain_id is distinct from 56
     or v_deal.safe_address is null
     or lower(coalesce(v_deal.token_contract,'')) <> v_bnb_usdt
     or v_policy.status not in ('locked','ready')
     or v_policy.chain_id is distinct from 56
     or v_policy.safe_address is null
     or lower(v_policy.safe_address) <> lower(v_deal.safe_address)
     or lower(coalesce(v_policy.token_contract,'')) <> v_bnb_usdt
     or lower(coalesce(v_policy.platform_wallet,'')) <> v_platform_wallet
     or v_policy.token_symbol is distinct from 'USDT'
     or coalesce(v_deal.token_symbol, v_deal.currency) is distinct from 'USDT' then
    raise exception 'Deal, payment, delivery, dispute, or release policy is not execution-ready'
      using errcode = '23514';
  end if;

  -- Recompute canonical 18-decimal fee arithmetic here. The legacy
  -- validate_deal_release_policy function rounds to 8 decimals and may disagree
  -- with the locked policy, so it must not be used as the W3M execution gate.
  v_amount := v_policy.deal_amount;
  v_fee_percent := v_policy.fee_percent;
  v_fee := v_policy.fee_amount;
  v_seller_net := v_policy.seller_net_amount;
  if v_amount is null or v_fee_percent is null or v_fee is null or v_seller_net is null
     or v_amount <= 0 or v_fee_percent <> 7.5
     or v_deal.amount is distinct from v_amount
     or v_deal.platform_fee_percent is distinct from v_fee_percent
     or v_fee <> round(v_amount * v_fee_percent / 100, 18)
     or v_seller_net <> v_amount - v_fee then
    raise exception 'Exact 18-decimal release fee arithmetic mismatch'
      using errcode = '23514';
  end if;

  if v_tx.action is distinct from 'release_to_seller'
     or v_tx.status is distinct from 'signed'
     or v_tx.safe_tx_hash is null
     or lower(v_tx.safe_tx_hash) <> lower(p_safe_tx_hash)
     or v_tx.chain_id is distinct from 56
     or lower(v_tx.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Stored Safe transaction is not the exact signed release for this deal'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.w3m_safe_execution_attempts a
     where a.deal_id = p_deal_id
       and a.state in ('CLAIMED','BROADCAST','RECONCILIATION_REQUIRED')
  ) then
    raise exception 'An active or unresolved execution attempt already exists for this deal'
      using errcode = '23505';
  end if;

  insert into public.w3m_safe_execution_attempts (
    deal_id, transaction_id, report_id, report_version, safe_tx_hash,
    state, executor_ref, idempotency_key
  ) values (
    p_deal_id, p_transaction_id, p_report_id, v_report.report_version,
    lower(p_safe_tx_hash), 'CLAIMED', p_executor_ref, p_idempotency_key
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'claimed', true,
    'idempotent_replay', false,
    'attempt_id', v_attempt_id,
    'state', 'CLAIMED'
  );
end;
$claim$;

create or replace function public.w3m_mark_safe_execution_reconciliation_required(
  p_attempt_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $reconcile$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_error_code is null
     or length(btrim(p_error_code)) not between 1 and 100 then
    raise exception 'Invalid reconciliation request' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'RECONCILIATION_REQUIRED' then
    return jsonb_build_object('updated', true, 'idempotent_replay', true, 'state', v_attempt.state);
  end if;

  if v_attempt.state not in ('CLAIMED','BROADCAST') then
    raise exception 'Only an active attempt can require reconciliation'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'RECONCILIATION_REQUIRED',
         last_error_code = p_error_code
   where id = p_attempt_id;

  return jsonb_build_object('updated', true, 'idempotent_replay', false, 'state', 'RECONCILIATION_REQUIRED');
end;
$reconcile$;

create or replace function public.w3m_record_safe_execution_broadcast(
  p_attempt_id uuid,
  p_broadcast_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $broadcast$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_broadcast_tx_hash is null
     or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Invalid broadcast recording arguments' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state in ('BROADCAST','RECONCILIATION_REQUIRED')
     and v_attempt.broadcast_tx_hash is not null
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', true, 'state', v_attempt.state
    );
  end if;

  -- After an uncertain send, the executor may discover the original hash by
  -- reconciling the nonce/events. Bind that verified hash without clearing the
  -- blocking reconciliation state; finalization still requires receipt proof.
  if v_attempt.state = 'RECONCILIATION_REQUIRED'
     and v_attempt.broadcast_tx_hash is null then
    update public.w3m_safe_execution_attempts
       set broadcast_tx_hash = lower(p_broadcast_tx_hash),
           broadcast_at = clock_timestamp()
     where id = p_attempt_id;
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', false, 'state', 'RECONCILIATION_REQUIRED'
    );
  end if;

  if v_attempt.state <> 'CLAIMED' then
    raise exception 'Attempt is not eligible for a new broadcast hash; reconcile before retry'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object('recorded', true, 'idempotent_replay', false, 'state', 'BROADCAST');
end;
$broadcast$;

revoke all on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_record_safe_execution_broadcast(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_mark_safe_execution_reconciliation_required(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.w3m_record_safe_execution_broadcast(uuid,text)
  to service_role;
grant execute on function public.w3m_mark_safe_execution_reconciliation_required(uuid,text)
  to service_role;

commit;

     or v_deal.delivery_status is distinct from 'accepted'
     or v_deal.buyer_approved_at is null
     or coalesce(v_deal.dispute_status, 'none') <> 'none'
     or v_deal.chain_id is distinct from 56
     or v_deal.safe_address is null
     or lower(coalesce(v_deal.token_contract,'')) <> v_bnb_usdt
     or v_policy.status not in ('locked','ready')
     or v_policy.chain_id is distinct from 56
     or v_policy.safe_address is null
     or lower(v_policy.safe_address) <> lower(v_deal.safe_address)
     or lower(coalesce(v_policy.token_contract,'')) <> v_bnb_usdt
     or lower(coalesce(v_policy.platform_wallet,'')) <> v_platform_wallet
     or v_policy.token_symbol is distinct from 'USDT'
     or coalesce(v_deal.token_symbol, v_deal.currency) is distinct from 'USDT' then
    raise exception 'Deal, payment, delivery, dispute, or release policy is not execution-ready'
      using errcode = '23514';
  end if;

  -- Recompute the canonical 18-decimal fee here. Do not call the legacy
  -- validate_deal_release_policy function: its 8-decimal rounding can disagree
  -- with the locked policy and incorrectly veto a valid W3M release.
  v_amount := v_policy.deal_amount;
  v_fee_percent := v_policy.fee_percent;
  v_fee := v_policy.fee_amount;
  v_seller_net := v_policy.seller_net_amount;
  if v_amount is null or v_fee_percent is null or v_fee is null or v_seller_net is null
     or v_amount <= 0 or v_fee_percent <> 7.5
     or v_deal.amount is distinct from v_amount
     or v_deal.platform_fee_percent is distinct from v_fee_percent
     or v_fee <> round(v_amount * v_fee_percent / 100, 18)
     or v_seller_net <> v_amount - v_fee then
    raise exception 'Exact 18-decimal release fee arithmetic mismatch'
      using errcode = '23514';
  end if;

  if v_tx.action is distinct from 'release_to_seller'
     or v_tx.status is distinct from 'signed'
     or v_tx.safe_tx_hash is null
     or lower(v_tx.safe_tx_hash) <> lower(p_safe_tx_hash)
     or v_tx.chain_id is distinct from 56
     or lower(v_tx.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Stored Safe transaction is not the exact signed release for this deal'
      using errcode = '23514';
  end if;

  v_validation := public.validate_deal_release_policy(p_deal_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception 'Existing release policy validator rejected the deal'
      using errcode = '23514';
  end if;

  if exists (
    select 1 from public.w3m_safe_execution_attempts a
     where a.deal_id = p_deal_id
       and a.state in ('CLAIMED','BROADCAST','RECONCILIATION_REQUIRED')
  ) then
    raise exception 'An active or unresolved execution attempt already exists for this deal'
      using errcode = '23505';
  end if;

  insert into public.w3m_safe_execution_attempts (
    deal_id, transaction_id, report_id, report_version, safe_tx_hash,
    state, executor_ref, idempotency_key
  ) values (
    p_deal_id, p_transaction_id, p_report_id, v_report.report_version,
    lower(p_safe_tx_hash), 'CLAIMED', p_executor_ref, p_idempotency_key
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'claimed', true,
    'idempotent_replay', false,
    'attempt_id', v_attempt_id,
    'state', 'CLAIMED'
  );
end;
$claim$;

create or replace function public.w3m_mark_safe_execution_reconciliation_required(
  p_attempt_id uuid,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $reconcile$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_error_code is null
     or length(btrim(p_error_code)) not between 1 and 100 then
    raise exception 'Invalid reconciliation request' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'RECONCILIATION_REQUIRED' then
    return jsonb_build_object('updated', true, 'idempotent_replay', true, 'state', v_attempt.state);
  end if;

  if v_attempt.state not in ('CLAIMED','BROADCAST') then
    raise exception 'Only an active attempt can require reconciliation'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'RECONCILIATION_REQUIRED',
         last_error_code = p_error_code
   where id = p_attempt_id;

  return jsonb_build_object('updated', true, 'idempotent_replay', false, 'state', 'RECONCILIATION_REQUIRED');
end;
$reconcile$;

create or replace function public.w3m_record_safe_execution_broadcast(
  p_attempt_id uuid,
  p_broadcast_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $broadcast$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_broadcast_tx_hash is null
     or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Invalid broadcast recording arguments' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state in ('BROADCAST','RECONCILIATION_REQUIRED')
     and v_attempt.broadcast_tx_hash is not null
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', true, 'state', v_attempt.state
    );
  end if;

  -- After an uncertain send, the executor may discover the original hash by
  -- reconciling the nonce/events. Bind that verified hash without clearing the
  -- blocking reconciliation state; finalization still requires receipt proof.
  if v_attempt.state = 'RECONCILIATION_REQUIRED'
     and v_attempt.broadcast_tx_hash is null then
    update public.w3m_safe_execution_attempts
       set broadcast_tx_hash = lower(p_broadcast_tx_hash),
           broadcast_at = clock_timestamp()
     where id = p_attempt_id;
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', false, 'state', 'RECONCILIATION_REQUIRED'
    );
  end if;

  if v_attempt.state <> 'CLAIMED' then
    raise exception 'Attempt is not eligible for a new broadcast hash; reconcile before retry'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object('recorded', true, 'idempotent_replay', false, 'state', 'BROADCAST');
end;
$broadcast$;

revoke all on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_record_safe_execution_broadcast(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_mark_safe_execution_reconciliation_required(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.w3m_record_safe_execution_broadcast(uuid,text)
  to service_role;
grant execute on function public.w3m_mark_safe_execution_reconciliation_required(uuid,text)
  to service_role;

commit;
