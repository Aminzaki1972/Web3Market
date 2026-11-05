-- W3M Protocol V1 — isolated Safe execution-attempt ledger.
-- Draft only. Do NOT deploy. No changes to production Deal Room/Safe tables.
-- This migration adds an atomic server-side claim + broadcast record primitive.
-- Finalization remains a separate, not-yet-implemented atomic contract.
-- The caller must perform cryptographic W3M report-signature verification and
-- the complete Safe execution guard immediately before this claim. SQL checks
-- trusted signer state/validity but does not verify ECDSA report signatures.

begin;

create table public.w3m_safe_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  transaction_id uuid not null references public.deal_multisig_transactions(id) on delete restrict,
  report_id uuid not null references public.w3m_acquisition_reports(id) on delete restrict,
  report_version integer not null check (report_version > 0),
  safe_tx_hash text not null check (safe_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  state text not null check (state in (
    'CLAIMED','BROADCAST','CONFIRMED','FAILED','RECONCILIATION_REQUIRED'
  )),
  executor_ref text not null check (length(btrim(executor_ref)) between 1 and 160),
  idempotency_key text not null unique
    check (length(btrim(idempotency_key)) between 16 and 160),
  broadcast_tx_hash text null
    check (broadcast_tx_hash is null or broadcast_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  claimed_at timestamptz not null default now(),
  broadcast_at timestamptz null,
  finalized_at timestamptz null,
  last_error_code text null check (last_error_code is null or length(last_error_code) <= 100),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  constraint w3m_attempt_broadcast_state_check check (
    (state = 'CLAIMED' and broadcast_tx_hash is null and broadcast_at is null)
    or (state <> 'CLAIMED' and state <> 'FAILED' and broadcast_tx_hash is not null and broadcast_at is not null)
    or (state = 'FAILED')
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
  'Server-only idempotent execution attempt ledger for W3M Safe releases. Draft V1; not deployed.';

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
as $function$
declare
  v_deal public.deals%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_report public.w3m_acquisition_reports%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_validation jsonb;
  v_signer record;
  v_attempt_id uuid;
  v_existing public.w3m_safe_execution_attempts%rowtype;
begin
  if p_deal_id is null or p_transaction_id is null or p_report_id is null
     or p_safe_tx_hash is null
     or p_safe_tx_hash !~ '^0x[0-9a-fA-F]{64}
     or p_executor_ref is null or length(btrim(p_executor_ref)) not between 1 and 160
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 16 and 160 then
    raise exception 'Invalid Safe execution claim arguments' using errcode = '22023';
  end if;

  -- Serialize claims for the same deal before inspecting the active-attempt state.
  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text, 0));

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

  if v_report.deal_id <> p_deal_id::text
     or v_report.project_id <> v_deal.project_id::text
     or v_report.status <> 'PASS'
     or v_report.report_version <> (
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
    raise exception 'Report signer key is not registered'
      using errcode = '23514';
  end if;
  if v_signer.status <> 'ACTIVE'
     or v_report.issued_at < v_signer.valid_from
     or (v_signer.valid_until is not null and v_report.issued_at >= v_signer.valid_until) then
    raise exception 'Report signer is not trusted and valid at report issue time'
      using errcode = '23514';
  end if;

  if v_deal.payment_status is distinct from 'confirmed'
     or v_deal.payment_tx_hash is null
     or v_deal.delivery_status is distinct from 'accepted'
     or v_deal.buyer_approved_at is null
     or coalesce(v_deal.dispute_status, 'none') <> 'none'
     or v_deal.chain_id is distinct from 56
     or v_deal.safe_address is null
     or v_deal.token_contract is null
     or v_policy.safe_address is null
     or v_policy.token_contract is null
     or v_policy.status not in ('locked','ready')
     or v_policy.chain_id is distinct from 56
     or lower(v_policy.safe_address) <> lower(v_deal.safe_address)
     or lower(v_policy.token_contract) <> lower(v_deal.token_contract) then
    raise exception 'Deal, payment, delivery, dispute, or release policy is not execution-ready'
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

  -- Preserve the existing production policy validator as an additional fail-closed check.
  v_validation := public.validate_deal_release_policy(p_deal_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception 'Existing release policy validator rejected the deal'
      using errcode = '23514';
  end if;

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
    raise exception 'Idempotency key was already used for a different execution attempt'
      using errcode = '23505';
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
$function$;

create or replace function public.w3m_record_safe_execution_broadcast(
  p_attempt_id uuid,
  p_broadcast_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_broadcast_tx_hash is null
     or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}
    raise exception 'Invalid broadcast recording arguments' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'BROADCAST'
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object('recorded', true, 'idempotent_replay', true, 'state', 'BROADCAST');
  end if;

  if v_attempt.state <> 'CLAIMED' then
    raise exception 'Attempt is not in CLAIMED state; reconcile before retry'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object('recorded', true, 'idempotent_replay', false, 'state', 'BROADCAST');
end;
$function$;

revoke all on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_record_safe_execution_broadcast(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.w3m_record_safe_execution_broadcast(uuid,text)
  to service_role;

commit;

     or p_executor_ref is null or length(btrim(p_executor_ref)) not between 1 and 160
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 16 and 160 then
    raise exception 'Invalid Safe execution claim arguments' using errcode = '22023';
  end if;

  -- Serialize claims for the same deal before inspecting the active-attempt state.
  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text, 0));

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

  if v_report.deal_id <> p_deal_id::text
     or v_report.project_id <> v_deal.project_id::text
     or v_report.status <> 'PASS'
     or v_report.report_version <> (
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

  if v_deal.payment_status <> 'confirmed'
     or v_deal.payment_tx_hash is null
     or v_deal.delivery_status <> 'accepted'
     or v_deal.buyer_approved_at is null
     or coalesce(v_deal.dispute_status, 'none') <> 'none'
     or v_deal.chain_id <> 56
     or v_policy.status not in ('locked','ready')
     or v_policy.chain_id <> 56
     or lower(v_policy.safe_address) <> lower(v_deal.safe_address)
     or lower(v_policy.token_contract) <> lower(v_deal.token_contract) then
    raise exception 'Deal, payment, delivery, dispute, or release policy is not execution-ready'
      using errcode = '23514';
  end if;

  if v_tx.action <> 'release_to_seller'
     or v_tx.status <> 'signed'
     or v_tx.safe_tx_hash is null
     or lower(v_tx.safe_tx_hash) <> lower(p_safe_tx_hash)
     or v_tx.chain_id <> 56
     or lower(v_tx.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Stored Safe transaction is not the exact signed release for this deal'
      using errcode = '23514';
  end if;

  -- Preserve the existing production policy validator as an additional fail-closed check.
  v_validation := public.validate_deal_release_policy(p_deal_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception 'Existing release policy validator rejected the deal'
      using errcode = '23514';
  end if;

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
    raise exception 'Idempotency key was already used for a different execution attempt'
      using errcode = '23505';
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
$function$;

create or replace function public.w3m_record_safe_execution_broadcast(
  p_attempt_id uuid,
  p_broadcast_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Invalid broadcast recording arguments' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'BROADCAST'
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object('recorded', true, 'idempotent_replay', true, 'state', 'BROADCAST');
  end if;

  if v_attempt.state <> 'CLAIMED' then
    raise exception 'Attempt is not in CLAIMED state; reconcile before retry'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object('recorded', true, 'idempotent_replay', false, 'state', 'BROADCAST');
end;
$function$;

revoke all on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_record_safe_execution_broadcast(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.w3m_record_safe_execution_broadcast(uuid,text)
  to service_role;

commit;
 then
    raise exception 'Invalid broadcast recording arguments' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'BROADCAST'
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object('recorded', true, 'idempotent_replay', true, 'state', 'BROADCAST');
  end if;

  if v_attempt.state <> 'CLAIMED' then
    raise exception 'Attempt is not in CLAIMED state; reconcile before retry'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object('recorded', true, 'idempotent_replay', false, 'state', 'BROADCAST');
end;
$function$;

revoke all on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_record_safe_execution_broadcast(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.w3m_record_safe_execution_broadcast(uuid,text)
  to service_role;

commit;

     or p_executor_ref is null or length(btrim(p_executor_ref)) not between 1 and 160
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 16 and 160 then
    raise exception 'Invalid Safe execution claim arguments' using errcode = '22023';
  end if;

  -- Serialize claims for the same deal before inspecting the active-attempt state.
  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text, 0));

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

  if v_report.deal_id <> p_deal_id::text
     or v_report.project_id <> v_deal.project_id::text
     or v_report.status <> 'PASS'
     or v_report.report_version <> (
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

  if v_deal.payment_status <> 'confirmed'
     or v_deal.payment_tx_hash is null
     or v_deal.delivery_status <> 'accepted'
     or v_deal.buyer_approved_at is null
     or coalesce(v_deal.dispute_status, 'none') <> 'none'
     or v_deal.chain_id <> 56
     or v_policy.status not in ('locked','ready')
     or v_policy.chain_id <> 56
     or lower(v_policy.safe_address) <> lower(v_deal.safe_address)
     or lower(v_policy.token_contract) <> lower(v_deal.token_contract) then
    raise exception 'Deal, payment, delivery, dispute, or release policy is not execution-ready'
      using errcode = '23514';
  end if;

  if v_tx.action <> 'release_to_seller'
     or v_tx.status <> 'signed'
     or v_tx.safe_tx_hash is null
     or lower(v_tx.safe_tx_hash) <> lower(p_safe_tx_hash)
     or v_tx.chain_id <> 56
     or lower(v_tx.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Stored Safe transaction is not the exact signed release for this deal'
      using errcode = '23514';
  end if;

  -- Preserve the existing production policy validator as an additional fail-closed check.
  v_validation := public.validate_deal_release_policy(p_deal_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception 'Existing release policy validator rejected the deal'
      using errcode = '23514';
  end if;

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
    raise exception 'Idempotency key was already used for a different execution attempt'
      using errcode = '23505';
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
$function$;

create or replace function public.w3m_record_safe_execution_broadcast(
  p_attempt_id uuid,
  p_broadcast_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
begin
  if p_attempt_id is null or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Invalid broadcast recording arguments' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'BROADCAST'
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object('recorded', true, 'idempotent_replay', true, 'state', 'BROADCAST');
  end if;

  if v_attempt.state <> 'CLAIMED' then
    raise exception 'Attempt is not in CLAIMED state; reconcile before retry'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object('recorded', true, 'idempotent_replay', false, 'state', 'BROADCAST');
end;
$function$;

revoke all on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_record_safe_execution_broadcast(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_claim_safe_execution_attempt(uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.w3m_record_safe_execution_broadcast(uuid,text)
  to service_role;

commit;
