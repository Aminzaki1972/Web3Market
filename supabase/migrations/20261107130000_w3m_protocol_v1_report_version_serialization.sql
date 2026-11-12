-- W3M Protocol V1 — serialize report-version appends with Safe finalization.
-- Isolated only. Never apply to production without a separate release decision.
begin;

create or replace function public.w3m_lock_report_version_append()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $lock$
declare
  v_latest_report_id uuid;
  v_latest_report_version integer;
begin
  if new.deal_id is null or length(btrim(new.deal_id)) = 0 then
    raise exception 'W3M report deal binding is required' using errcode = '23514';
  end if;

  -- Serialize every report append for this deal before reading its latest version.
  perform pg_advisory_xact_lock(hashtextextended(new.deal_id, 0));

  -- A report may not supersede the evidence basis after settlement. Because
  -- finalization takes this same advisory lock before checking the latest
  -- report and commits the completed deal before releasing it, this guard
  -- deterministically rejects any append that loses the race to finalization.
  if exists (
    select 1
      from public.deals d
     where d.id::text = new.deal_id
       and (d.status = 'completed' or d.release_tx_hash is not null)
  ) or exists (
    select 1
      from public.w3m_safe_execution_attempts a
     where a.deal_id::text = new.deal_id
       and a.state = 'CONFIRMED'
  ) then
    raise exception 'W3M acquisition reports cannot be appended after Safe settlement is confirmed'
      using errcode = '23514';
  end if;

  select id, report_version
    into v_latest_report_id, v_latest_report_version
    from public.w3m_acquisition_reports
   where deal_id = new.deal_id
   order by report_version desc, issued_at desc
   limit 1;

  if not found then
    if new.report_version is distinct from 1
       or new.supersedes_report_id is not null then
      raise exception 'First W3M report must be version 1 and cannot supersede another report'
        using errcode = '23514';
    end if;
  else
    if new.report_version is distinct from v_latest_report_version + 1
       or new.supersedes_report_id is distinct from v_latest_report_id then
      raise exception 'W3M report version must increment by one and supersede the latest report for this deal'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$lock$;

revoke all on function public.w3m_lock_report_version_append()
  from public, anon, authenticated, service_role;

drop trigger if exists w3m_acquisition_reports_serialize_version_append
  on public.w3m_acquisition_reports;
create trigger w3m_acquisition_reports_serialize_version_append
before insert on public.w3m_acquisition_reports
for each row execute function public.w3m_lock_report_version_append();

-- Evidence appends use the same per-deal advisory lock as report versioning
-- and finalization. This prevents a post-settlement manifest mutation and
-- makes append-vs-finalize races deterministic in either lock order.
create or replace function public.w3m_lock_acquisition_evidence_append()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $evidence_lock$
declare
  v_deal_id text;
begin
  select r.deal_id
    into v_deal_id
    from public.w3m_acquisition_reports r
   where r.id = new.report_id;

  if not found or v_deal_id is null or length(btrim(v_deal_id)) = 0 then
    raise exception 'W3M evidence must reference an existing deal-bound report'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_deal_id, 0));

  if exists (
    select 1 from public.deals d
     where d.id::text = v_deal_id
       and (d.status = 'completed' or d.release_tx_hash is not null)
  ) or exists (
    select 1 from public.w3m_safe_execution_attempts a
     where a.deal_id::text = v_deal_id
       and a.state = 'CONFIRMED'
  ) then
    raise exception 'W3M acquisition evidence cannot be appended after Safe settlement is confirmed'
      using errcode = '55000';
  end if;

  return new;
end;
$evidence_lock$;

revoke all on function public.w3m_lock_acquisition_evidence_append()
  from public, anon, authenticated, service_role;

drop trigger if exists w3m_acquisition_evidence_serialize_append
  on public.w3m_acquisition_evidence;
create trigger w3m_acquisition_evidence_serialize_append
before insert on public.w3m_acquisition_evidence
for each row execute function public.w3m_lock_acquisition_evidence_append();

create or replace function public.w3m_finalize_safe_execution_attempt(
  p_attempt_id uuid,
  p_broadcast_tx_hash text,
  p_actor_id uuid,
  p_receipt_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $finalize$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
  v_deal public.deals%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_now timestamptz := clock_timestamp();
  v_transfer_count integer;
  v_seller_count integer;
  v_platform_count integer;
begin
  if p_attempt_id is null
     or p_broadcast_tx_hash is null
     or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or p_actor_id is null
     or p_receipt_evidence is null
     or jsonb_typeof(p_receipt_evidence) is distinct from 'object' then
    raise exception 'Invalid Safe finalization arguments' using errcode = '22023';
  end if;

  -- This is a server attestation assembled only after independent chain reads.
  -- The RPC binds every reported fact to the persisted attempt and locked policy.
  if (p_receipt_evidence->>'chain_id')::bigint is distinct from 56
     or lower(coalesce(p_receipt_evidence->>'transaction_hash','')) <> lower(p_broadcast_tx_hash)
     or (p_receipt_evidence->>'receipt_status')::integer is distinct from 1
     or (p_receipt_evidence->>'execution_success')::boolean is distinct from true
     or coalesce((p_receipt_evidence->>'execution_failure')::boolean, true) is not false
     or p_receipt_evidence->>'block_timestamp' is null
     or jsonb_typeof(p_receipt_evidence->'transfers') is distinct from 'array'
     or jsonb_array_length(p_receipt_evidence->'transfers') <> 2 then
    raise exception 'Receipt evidence is incomplete or unsuccessful' using errcode = '23514';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then
    raise exception 'Execution attempt not found' using errcode = 'P0002';
  end if;

  -- Serialize latest-report insertion against finalization. The report INSERT
  -- trigger takes this same per-deal transaction advisory lock.
  perform pg_advisory_xact_lock(hashtextextended(v_attempt.deal_id::text, 0));

  if v_attempt.state = 'CONFIRMED' then
    if lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
      return jsonb_build_object(
        'finalized', true, 'idempotent_replay', true,
        'attempt_id', v_attempt.id, 'state', 'CONFIRMED',
        'broadcast_tx_hash', v_attempt.broadcast_tx_hash
      );
    end if;
    raise exception 'Confirmed attempt cannot be rebound to another transaction hash'
      using errcode = '23514';
  end if;

  if v_attempt.state not in ('BROADCAST','RECONCILIATION_REQUIRED')
     or v_attempt.broadcast_tx_hash is null
     or lower(v_attempt.broadcast_tx_hash) <> lower(p_broadcast_tx_hash)
     or v_attempt.package_actor_id is null
     or v_attempt.package_hash is null
     or v_attempt.package_payload is null
     or v_attempt.package_issued_at is null
     or v_attempt.package_expires_at is null
     or (p_receipt_evidence->>'block_timestamp')::timestamptz < v_attempt.package_issued_at
     or (p_receipt_evidence->>'block_timestamp')::timestamptz > v_attempt.package_expires_at then
    raise exception 'Attempt is not bound to this recorded broadcast'
      using errcode = '23514';
  end if;

  select * into v_deal from public.deals
   where id = v_attempt.deal_id
   for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  select * into v_tx from public.deal_multisig_transactions
   where id = v_attempt.transaction_id and deal_id = v_attempt.deal_id
   for update;
  if not found then raise exception 'Bound Safe transaction not found' using errcode = '23514'; end if;

  select * into v_policy from public.deal_release_policies
   where deal_id = v_attempt.deal_id
   for update;
  if not found then raise exception 'Release policy not found' using errcode = '23514'; end if;

  if p_actor_id not in (v_deal.buyer_id, v_deal.seller_id) then
    raise exception 'Finalization actor is not a deal participant' using errcode = '42501';
  end if;
  if v_attempt.package_actor_id not in (v_deal.buyer_id, v_deal.seller_id) then
    raise exception 'Wallet package actor is not a deal participant' using errcode = '42501';
  end if;

  if v_tx.action is distinct from 'release_to_seller'
     or v_tx.status not in ('signed','submitted')
     or lower(coalesce(v_tx.safe_tx_hash,'')) <> lower(v_attempt.safe_tx_hash)
     or (v_tx.tx_hash is not null and lower(v_tx.tx_hash) <> lower(p_broadcast_tx_hash))
     or v_deal.chain_id is distinct from 56
     or v_policy.chain_id is distinct from 56
     or v_policy.safe_address is null
     or v_tx.safe_address is null
     or v_policy.token_contract is null
     or lower(coalesce(v_deal.safe_address,'')) <> lower(v_policy.safe_address)
     or lower(coalesce(v_policy.safe_address,'')) <> lower(v_tx.safe_address)
     or lower(coalesce(p_receipt_evidence->>'safe_address','')) <> lower(v_policy.safe_address)
     or lower(coalesce(p_receipt_evidence->>'safe_tx_hash','')) <> lower(v_attempt.safe_tx_hash)
     or lower(coalesce(p_receipt_evidence->>'token_contract','')) <> lower(v_policy.token_contract)
     or lower(coalesce(v_deal.token_contract,'')) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_policy.deal_amount is distinct from v_deal.amount
     or v_policy.seller_wallet is null
     or v_policy.platform_wallet is null
     or lower(v_policy.seller_wallet) = lower(v_policy.platform_wallet)
     or (v_deal.release_tx_hash is not null and lower(v_deal.release_tx_hash) <> lower(p_broadcast_tx_hash))
     or (v_policy.release_tx_hash is not null and lower(v_policy.release_tx_hash) <> lower(p_broadcast_tx_hash)) then
    raise exception 'Persisted deal, transaction, policy, or receipt binding changed'
      using errcode = '23514';
  end if;

  select
    count(*),
    count(*) filter (
      where lower(coalesce(t.from_address,'')) = lower(v_policy.safe_address)
        and lower(coalesce(t.to_address,'')) = lower(v_policy.seller_wallet)
        and t.amount::numeric = v_policy.seller_net_amount
    ),
    count(*) filter (
      where lower(coalesce(t.from_address,'')) = lower(v_policy.safe_address)
        and lower(coalesce(t.to_address,'')) = lower(v_policy.platform_wallet)
        and t.amount::numeric = v_policy.fee_amount
    )
  into v_transfer_count, v_seller_count, v_platform_count
  from jsonb_to_recordset(p_receipt_evidence->'transfers')
    as t(from_address text, to_address text, amount text);

  if v_transfer_count <> 2 or v_seller_count <> 1 or v_platform_count <> 1 then
    raise exception 'Receipt transfers do not exactly match seller net and platform fee'
      using errcode = '23514';
  end if;

  -- All four state changes and the audit row commit or roll back together.
  update public.deal_multisig_transactions
     set tx_hash = p_broadcast_tx_hash,
         status = 'confirmed',
         updated_at = v_now
   where id = v_tx.id;

  update public.deal_release_policies
     set status = 'released',
         released_at = v_now,
         release_tx_hash = p_broadcast_tx_hash
   where id = v_policy.id;

  update public.deals
     set release_tx_hash = p_broadcast_tx_hash,
         status = 'completed',
         completed_at = v_now,
         updated_at = v_now
   where id = v_deal.id;

  update public.projects
     set status = 'sold',
         updated_at = v_now
   where id = v_deal.project_id;

  if not found then
    raise exception 'Project sold-status update did not affect a row'
      using errcode = '23514';
  end if;

  insert into public.deal_audit_logs (
    deal_id, actor_id, action, metadata, created_at
  ) values (
    v_deal.id, p_actor_id, 'safe_release_confirmed',
    jsonb_build_object(
      'tx_hash', p_broadcast_tx_hash,
      'safe_tx_hash', v_attempt.safe_tx_hash,
      'attempt_id', v_attempt.id,
      'report_id', v_attempt.report_id,
      'safe_nonce', v_tx.safe_nonce,
      'seller_amount', v_policy.seller_net_amount::text,
      'platform_fee', v_policy.fee_amount::text
    ),
    v_now
  );

  update public.w3m_safe_execution_attempts
     set state = 'CONFIRMED',
         finalized_at = v_now,
         last_error_code = null
   where id = v_attempt.id;

  return jsonb_build_object(
    'finalized', true,
    'idempotent_replay', false,
    'attempt_id', v_attempt.id,
    'state', 'CONFIRMED',
    'broadcast_tx_hash', p_broadcast_tx_hash
  );
end;
$finalize$;

commit;
