-- W3M Protocol V1 — transfer project ownership atomically with Safe settlement.
-- Draft only. Apply only in disposable PostgreSQL CI until separately approved.
-- The finalizer verifies the seller is the current owner under FOR UPDATE,
-- then transfers ownership to the buyer in the same database transaction.

begin;

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
      -- Idempotent replay also verifies that the atomic ownership transfer
      -- remains reflected in the persisted project row.
      select * into v_deal from public.deals
       where id = v_attempt.deal_id for update;
      if not found then raise exception 'Confirmed deal is missing' using errcode = 'P0002'; end if;
      select * into v_project from public.projects
       where id = v_deal.project_id for update;
      if not found
         or v_project.owner_id is distinct from v_deal.buyer_id
         or v_project.status is distinct from 'sold' then
        raise exception 'Confirmed Safe deal does not retain buyer project ownership'
          using errcode = '23514';
      end if;
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
  -- PREPARE accepts both 'none' and 'closed'. A closed parent status is
  -- terminal only when every persisted dispute row is also resolved/closed;
  -- active, null, and unclassified parent/child states remain fail-closed.
  if v_deal.dispute_status is null
     or v_deal.dispute_status not in ('none','closed')
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

  -- Transfer project ownership to the buyer in the same transaction as
  -- Safe settlement. A completed deal can never commit while the seller
  -- remains the recorded project owner.
  update public.projects
     set owner_id = v_deal.buyer_id,
         status = 'sold',
         updated_at = v_now
   where id = v_deal.project_id
     and owner_id = v_deal.seller_id;

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
      'platform_fee', v_policy.fee_amount::text,
      'previous_project_owner_id', v_deal.seller_id,
      'new_project_owner_id', v_deal.buyer_id
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
