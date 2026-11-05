-- Isolated PostgreSQL contract tests for W3M Safe execution attempts.
-- Run only after disposable fixtures + both W3M registry migrations + attempt migration.
begin;

do $test$
declare
  v_deal uuid := '10000000-0000-4000-8000-000000000001';
  v_project uuid := '20000000-0000-4000-8000-000000000002';
  v_tx uuid := '30000000-0000-4000-8000-000000000003';
  v_report uuid := '40000000-0000-4000-8000-000000000004';
  v_policy uuid := '50000000-0000-4000-8000-000000000005';
  v_attempt uuid;
  v_result jsonb;
  v_safe_hash text := '0x' || repeat('a', 64);
  v_broadcast_hash text := '0x' || repeat('b', 64);
begin
  insert into public.w3m_trusted_signer_keys (
    key_id, algorithm, public_address, valid_from, valid_until, created_by
  ) values (
    'attempt-test-key',
    'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
    '0x1111111111111111111111111111111111111111',
    now() - interval '1 day',
    now() + interval '1 day',
    'isolated-schema-test'
  );

  insert into public.w3m_trusted_signer_key_events (
    key_id, event_type, actor_type, reason, event_hash
  ) values (
    'attempt-test-key','ACTIVATED','SYSTEM','isolated test key',repeat('a',64)
  );

  insert into public.deals (
    id, project_id, payment_status, payment_tx_hash,
    delivery_status, buyer_approved_at, dispute_status,
    chain_id, safe_address, token_contract
  ) values (
    v_deal, v_project, 'confirmed', '0xpayment',
    'accepted', now(), 'none',
    56, '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333'
  );

  insert into public.deal_release_policies (
    id, deal_id, status, chain_id, safe_address, token_contract
  ) values (
    v_policy, v_deal, 'locked', 56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333'
  );

  insert into public.deal_multisig_transactions (
    id, deal_id, action, status, safe_tx_hash, chain_id, safe_address
  ) values (
    v_tx, v_deal, 'release_to_seller', 'signed', v_safe_hash, 56,
    '0x2222222222222222222222222222222222222222'
  );

  insert into public.w3m_acquisition_reports (
    id, deal_id, project_id, report_version, status, engine_version,
    evidence_hash, report_hash, report_payload, signer_key_id,
    report_signature, issued_at, expires_at
  ) values (
    v_report, v_deal::text, v_project::text, 1, 'PASS', 'test-engine',
    repeat('c',64), repeat('d',64), '{}'::jsonb, 'attempt-test-key',
    '0x' || repeat('e',130), now() - interval '1 minute', now() + interval '1 hour'
  );

  v_result := public.w3m_claim_safe_execution_attempt(
    v_deal, v_tx, v_report, v_safe_hash,
    'isolated-test-executor', 'attempt-idempotency-key-0001'
  );
  if coalesce((v_result->>'claimed')::boolean,false) is not true
     or coalesce((v_result->>'idempotent_replay')::boolean,true) is not false then
    raise exception 'Initial execution claim did not create a fresh claim';
  end if;
  v_attempt := (v_result->>'attempt_id')::uuid;

  v_result := public.w3m_claim_safe_execution_attempt(
    v_deal, v_tx, v_report, v_safe_hash,
    'isolated-test-executor', 'attempt-idempotency-key-0001'
  );
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true
     or (v_result->>'attempt_id')::uuid <> v_attempt then
    raise exception 'Same idempotency key did not return the original claim';
  end if;

  begin
    perform public.w3m_claim_safe_execution_attempt(
      v_deal, v_tx, v_report, v_safe_hash,
      'isolated-test-executor', 'attempt-idempotency-key-0002'
    );
    raise exception 'A second active attempt for the deal was unexpectedly accepted';
  exception when unique_violation then
    null;
  end;

  v_result := public.w3m_record_safe_execution_broadcast(v_attempt, v_broadcast_hash);
  if coalesce((v_result->>'recorded')::boolean,false) is not true then
    raise exception 'Broadcast hash was not recorded';
  end if;

  v_result := public.w3m_record_safe_execution_broadcast(v_attempt, v_broadcast_hash);
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Same broadcast hash was not idempotent';
  end if;

  -- An idempotent claim replay must remain safe even after the transaction row
  -- advances from signed to submitted following a successful broadcast.
  update public.deal_multisig_transactions
     set status = 'submitted'
   where id = v_tx;

  v_result := public.w3m_claim_safe_execution_attempt(
    v_deal, v_tx, v_report, v_safe_hash,
    'isolated-test-executor', 'attempt-idempotency-key-0001'
  );
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true
     or (v_result->>'attempt_id')::uuid <> v_attempt then
    raise exception 'Claim replay failed after transaction status advanced';
  end if;

  begin
    perform public.w3m_record_safe_execution_broadcast(v_attempt, '0x' || repeat('f',64));
    raise exception 'A different broadcast hash was unexpectedly accepted';
  exception when check_violation then
    null;
  end;

  if not exists (
    select 1 from public.w3m_safe_execution_attempts
     where id = v_attempt
       and state = 'BROADCAST'
       and lower(broadcast_tx_hash) = lower(v_broadcast_hash)
  ) then
    raise exception 'Attempt ledger did not preserve the exact broadcast hash';
  end if;
end;
$test$;

rollback;
