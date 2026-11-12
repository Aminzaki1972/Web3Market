-- W3M Protocol V1 — finalization-time acquisition and agreement revalidation.
-- Isolated draft only. This migration is not approved for production deployment.
begin;

alter table public.w3m_safe_execution_attempts
  add column pinned_report_hash text,
  add column pinned_evidence_hash text,
  add column pinned_signer_key_id text,
  add column pinned_terms_version_id uuid,
  add column pinned_terms_version bigint,
  add column pinned_terms_hash text;

create or replace function public.w3m_pin_acquisition_and_terms_on_attempt()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $pin$
declare
  v_report public.w3m_acquisition_reports%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_signer public.w3m_trusted_signer_keys%rowtype;
  v_signer_event text;
  v_acceptance_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.deal_id::text, 0));
  select * into v_report from public.w3m_acquisition_reports
   where id = new.report_id for update;
  if not found then raise exception 'W3M report missing during attempt pinning' using errcode = '23514'; end if;
  if v_report.deal_id is distinct from new.deal_id::text
     or v_report.status is distinct from 'PASS'
     or v_report.report_version is distinct from new.report_version
     or v_report.report_version is distinct from (select max(r.report_version) from public.w3m_acquisition_reports r where r.deal_id = new.deal_id::text)
     or v_report.expires_at <= clock_timestamp()
     or v_report.report_signature is null or v_report.signer_key_id is null then
    raise exception 'Only the latest unexpired signed PASS report can be pinned' using errcode = '23514';
  end if;
  select * into v_signer from public.w3m_trusted_signer_keys k where k.key_id = v_report.signer_key_id for update;
  if not found or v_report.issued_at < v_signer.valid_from
     or (v_signer.valid_until is not null and v_report.issued_at >= v_signer.valid_until) then
    raise exception 'W3M report signer key is missing or outside its validity window' using errcode = '23514';
  end if;
  select e.event_type into v_signer_event from public.w3m_trusted_signer_key_events e
   where e.key_id = v_report.signer_key_id order by e.event_id desc limit 1;
  if v_signer_event is distinct from 'ACTIVATED' then
    raise exception 'W3M report signer is not active' using errcode = '23514';
  end if;
  select * into v_terms from public.w3m_deal_terms_versions
   where deal_id = new.deal_id order by terms_version desc limit 1 for update;
  if not found or v_report.report_payload->>'dealTermsHash' is distinct from v_terms.terms_hash
     or public.w3m_current_deal_terms_json(new.deal_id) is distinct from v_terms.canonical_terms then
    raise exception 'Latest signed deal terms do not match the acquisition report' using errcode = '23514';
  end if;
  perform 1 from public.w3m_deal_agreement_acceptances a where a.terms_version_id = v_terms.id for update;
  select count(*) into v_acceptance_count from public.w3m_deal_agreement_acceptances a
   where a.terms_version_id = v_terms.id and a.deal_id = new.deal_id
     and a.terms_version = v_terms.terms_version and a.terms_hash = v_terms.terms_hash
     and ((a.party_role = 'buyer' and a.party_id::text = v_report.buyer_id)
       or (a.party_role = 'seller' and a.party_id::text = v_report.seller_id));
  if v_acceptance_count <> 2 then
    raise exception 'Both buyer and seller must accept the pinned terms before execution claim' using errcode = '23514';
  end if;
  new.pinned_report_hash := v_report.report_hash;
  new.pinned_evidence_hash := v_report.evidence_hash;
  new.pinned_signer_key_id := v_report.signer_key_id;
  new.pinned_terms_version_id := v_terms.id;
  new.pinned_terms_version := v_terms.terms_version;
  new.pinned_terms_hash := v_terms.terms_hash;
  return new;
end;
$pin$;
revoke all on function public.w3m_pin_acquisition_and_terms_on_attempt() from public, anon, authenticated, service_role;
create trigger w3m_safe_attempt_pin_acquisition_terms
before insert on public.w3m_safe_execution_attempts
for each row execute function public.w3m_pin_acquisition_and_terms_on_attempt();

create or replace function public.w3m_lock_evidence_append()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $lock$
declare v_deal_id text;
begin
  select deal_id into v_deal_id from public.w3m_acquisition_reports where id = new.report_id;
  if v_deal_id is null then raise exception 'Evidence report binding is missing' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_deal_id, 0));
  if exists (
    select 1 from public.w3m_safe_execution_attempts a
     where a.report_id = new.report_id
       and a.state in ('CLAIMED','BROADCAST','CONFIRMED','RECONCILIATION_REQUIRED')
  ) then
    raise exception 'Evidence manifest is frozen after an execution attempt pins the report'
      using errcode = '55000';
  end if;
  return new;
end;
$lock$;
revoke all on function public.w3m_lock_evidence_append() from public, anon, authenticated, service_role;
create trigger w3m_acquisition_evidence_serialize_append
before insert on public.w3m_acquisition_evidence
for each row execute function public.w3m_lock_evidence_append();

create or replace function public.w3m_read_safe_finalization_acquisition_bundle(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public
as $bundle$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
  v_deal public.deals%rowtype;
  v_report public.w3m_acquisition_reports%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_evidence jsonb;
  v_signers jsonb;
  v_latest_version integer;
begin
  if p_attempt_id is null then raise exception 'Attempt ID is required' using errcode = '22023'; end if;
  select * into v_attempt from public.w3m_safe_execution_attempts where id = p_attempt_id;
  if not found then raise exception 'Execution attempt not found' using errcode = 'P0002'; end if;
  select * into v_deal from public.deals where id = v_attempt.deal_id;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_report from public.w3m_acquisition_reports where id = v_attempt.report_id;
  if not found then raise exception 'Pinned acquisition report not found' using errcode = 'P0002'; end if;
  select * into v_terms from public.w3m_deal_terms_versions where id = v_attempt.pinned_terms_version_id;
  if not found then raise exception 'Pinned deal terms not found' using errcode = 'P0002'; end if;
  select max(report_version) into v_latest_version
    from public.w3m_acquisition_reports where deal_id = v_attempt.deal_id::text;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb)
    into v_evidence from public.w3m_acquisition_evidence e where e.report_id = v_report.id;
  select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
    into v_signers from public.w3m_trusted_signer_key_status k
   where k.key_id = v_report.signer_key_id;
  return jsonb_build_object(
    'attempt',to_jsonb(v_attempt),
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text),
    'report_row',to_jsonb(v_report),
    'evidence_rows',v_evidence,
    'trusted_signer_registry_rows',v_signers,
    'latest_report_version',v_latest_version,
    'current_deal_terms_hash',v_terms.terms_hash
  );
end;
$bundle$;
revoke all on function public.w3m_read_safe_finalization_acquisition_bundle(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_read_safe_finalization_acquisition_bundle(uuid)
  to service_role;

-- Serialize dispute creation/status changes against finalization by locking
-- the parent deal row. Once a deal is completed, a new dispute cannot be added.
create or replace function public.w3m_lock_deal_dispute_mutation()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $dispute$
declare
  v_deal public.deals%rowtype;
  v_deal_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Deal dispute records cannot be deleted; resolve them with an explicit status'
      using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.deal_id is distinct from new.deal_id then
    raise exception 'A dispute cannot be moved to another deal'
      using errcode = '23514';
  end if;
  v_deal_id := new.deal_id;
  select * into v_deal from public.deals where id = v_deal_id for update;
  if not found then
    raise exception 'Dispute deal does not exist' using errcode = '23503';
  end if;
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and
     lower(coalesce(new.status,'')) not in ('resolved','closed') and
     (v_deal.status = 'completed' or v_deal.release_tx_hash is not null) then
    raise exception 'An active dispute cannot be created or reopened after settlement is completed'
      using errcode = '23514';
  end if;
  return new;
end;
$dispute$;
revoke all on function public.w3m_lock_deal_dispute_mutation()
  from public, anon, authenticated, service_role;
drop trigger if exists w3m_deal_disputes_lock_parent_deal on public.deal_disputes;
create trigger w3m_deal_disputes_lock_parent_deal
before insert or update or delete on public.deal_disputes
for each row execute function public.w3m_lock_deal_dispute_mutation();

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
  v_project public.projects%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_report public.w3m_acquisition_reports%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_latest_report_version integer;
  v_evidence_count integer;
  v_invalid_evidence_count integer;
  v_acceptance_count integer;
  v_signer public.w3m_trusted_signer_keys%rowtype;
  v_signer_event text;
  v_acquisition_attestation jsonb;
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

  -- Share the per-deal advisory lock with report and evidence append triggers.
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

  -- Revalidate project ownership under a row lock. The seller binding must
  -- still match the project owner at the exact moment settlement is committed.
  select * into v_project from public.projects
   where id = v_deal.project_id
   for update;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if v_deal.buyer_id = v_deal.seller_id
     or v_project.owner_id is distinct from v_deal.seller_id then
    raise exception 'Deal buyer/seller or current project ownership binding is invalid'
      using errcode = '23514';
  end if;

  -- The deal row is already locked above. A newly opened dispute must block
  -- settlement even when the previously signed acquisition report passed.
  -- The parent deal lock serializes dispute inserts and status changes. Avoid
  -- locking child dispute rows here: UPDATE already locks its child row before
  -- the trigger takes the parent lock, so the parent lock alone avoids inversion.
  -- Keep every non-terminal dispute fail-closed; resolved/closed records remain auditable.
  if v_deal.dispute_status is distinct from 'none'
     or exists (
       select 1 from public.deal_disputes d
        where d.deal_id = v_deal.id
          and lower(coalesce(d.status,'')) not in ('resolved','closed')
     ) then
    raise exception 'An open, unresolved, or unclassified dispute blocks Safe settlement'
      using errcode = '23514';
  end if;

  -- Lock the release policy before rebuilding canonical terms. The canonical
  -- terms function reads this row, so locking it first prevents a policy
  -- mutation between terms comparison and the later settlement checks.
  select * into v_policy from public.deal_release_policies
   where deal_id = v_attempt.deal_id
   for update;
  if not found then raise exception 'Release policy not found' using errcode = '23514'; end if;

  -- Lock and revalidate the exact persisted acquisition report at finalization.
  select * into v_report from public.w3m_acquisition_reports
   where id = v_attempt.report_id for update;
  if not found then raise exception 'Pinned acquisition report is missing' using errcode = '23514'; end if;
  select max(report_version) into v_latest_report_version
    from public.w3m_acquisition_reports where deal_id = v_attempt.deal_id::text;
  if v_report.status is distinct from 'PASS'
     or v_report.report_version is distinct from v_attempt.report_version
     or v_report.report_version is distinct from v_latest_report_version
     or v_report.expires_at <= clock_timestamp()
     or v_report.deal_id is distinct from v_attempt.deal_id::text
     or v_report.project_id is distinct from v_deal.project_id::text
     or v_report.buyer_id is distinct from v_deal.buyer_id::text
     or v_report.seller_id is distinct from v_deal.seller_id::text
     or v_report.report_hash is distinct from v_attempt.pinned_report_hash
     or v_report.evidence_hash is distinct from v_attempt.pinned_evidence_hash
     or v_report.signer_key_id is distinct from v_attempt.pinned_signer_key_id
     or v_report.report_signature is null then
    raise exception 'Pinned acquisition report is stale, superseded, expired, or misbound' using errcode = '23514';
  end if;

  v_acquisition_attestation := p_receipt_evidence->'acquisition_attestation';
  if jsonb_typeof(v_acquisition_attestation) is distinct from 'object'
     or v_acquisition_attestation->>'authorized' is distinct from 'true'
     or v_acquisition_attestation->>'signature_valid' is distinct from 'true'
     or v_acquisition_attestation->>'report_id' is distinct from v_attempt.report_id::text
     or v_acquisition_attestation->>'report_version' is distinct from v_attempt.report_version::text
     or v_acquisition_attestation->>'report_hash' is distinct from v_attempt.pinned_report_hash
     or v_acquisition_attestation->>'evidence_hash' is distinct from v_attempt.pinned_evidence_hash
     or v_acquisition_attestation->>'signer_key_id' is distinct from v_attempt.pinned_signer_key_id
     or v_acquisition_attestation->>'terms_version_id' is distinct from v_attempt.pinned_terms_version_id::text
     or v_acquisition_attestation->>'terms_version' is distinct from v_attempt.pinned_terms_version::text
     or v_acquisition_attestation->>'terms_hash' is distinct from v_attempt.pinned_terms_hash
     or v_acquisition_attestation->>'recomputed_evidence_hash' is distinct from v_attempt.pinned_evidence_hash then
    raise exception 'Cryptographic acquisition attestation does not match the pinned report and agreement' using errcode = '23514';
  end if;

  -- Evidence rows are append-only; serialize inserts with the same deal lock,
  -- then lock the visible manifest rows and reject missing/stale mandatory proof.
  perform 1 from public.w3m_acquisition_evidence e
   where e.report_id = v_report.id for update;
  select count(*), count(*) filter (
    where e.mandatory and (e.result is distinct from 'PASS'
      or (e.valid_until is not null and e.valid_until <= clock_timestamp()))
  ) into v_evidence_count, v_invalid_evidence_count
    from public.w3m_acquisition_evidence e where e.report_id = v_report.id;
  if v_evidence_count = 0
     or v_evidence_count is distinct from (v_report.report_payload->>'evidenceCount')::integer
     or v_invalid_evidence_count <> 0 then
    raise exception 'Pinned acquisition evidence manifest is incomplete or stale' using errcode = '23514';
  end if;

  -- A revocation RPC locks this same signer-key row before appending REVOKED.
  select * into v_signer from public.w3m_trusted_signer_keys k
   where k.key_id = v_report.signer_key_id for update;
  if not found or v_report.issued_at < v_signer.valid_from
     or (v_signer.valid_until is not null and v_report.issued_at >= v_signer.valid_until) then
    raise exception 'Pinned report signer key is missing or outside its validity window' using errcode = '23514';
  end if;
  select e.event_type into v_signer_event
    from public.w3m_trusted_signer_key_events e
   where e.key_id = v_report.signer_key_id
   order by e.event_id desc limit 1;
  if v_signer_event is distinct from 'ACTIVATED' then
    raise exception 'Pinned report signer has been revoked' using errcode = '23514';
  end if;

  -- Both parties must have accepted the exact immutable terms version pinned
  -- by the attempt. Agreement version rows and signatures are locked together.
  select * into v_terms from public.w3m_deal_terms_versions
   where id = v_attempt.pinned_terms_version_id for update;
  if not found or v_terms.deal_id <> v_deal.id
     or v_terms.terms_version is distinct from v_attempt.pinned_terms_version
     or v_terms.terms_hash is distinct from v_attempt.pinned_terms_hash
     or v_report.report_payload->>'dealTermsHash' is distinct from v_terms.terms_hash
     or public.w3m_current_deal_terms_json(v_deal.id) is distinct from v_terms.canonical_terms then
    raise exception 'Pinned deal agreement terms changed or no longer match the report' using errcode = '23514';
  end if;
  perform 1 from public.w3m_deal_agreement_acceptances a
   where a.terms_version_id = v_terms.id for update;
  select count(*) into v_acceptance_count
    from public.w3m_deal_agreement_acceptances a
   where a.terms_version_id = v_terms.id
     and a.deal_id = v_deal.id
     and a.terms_version = v_terms.terms_version
     and a.terms_hash = v_terms.terms_hash
     and ((a.party_role = 'buyer' and a.party_id = v_deal.buyer_id)
       or (a.party_role = 'seller' and a.party_id = v_deal.seller_id));
  if v_acceptance_count <> 2 then
    raise exception 'Both deal parties have not accepted the pinned agreement version' using errcode = '23514';
  end if;


  select * into v_tx from public.deal_multisig_transactions
   where id = v_attempt.transaction_id and deal_id = v_attempt.deal_id
   for update;
  if not found then raise exception 'Bound Safe transaction not found' using errcode = '23514'; end if;

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
     or v_policy.fee_percent is distinct from 7.5
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

revoke all on function public.w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb) to service_role;

commit;
