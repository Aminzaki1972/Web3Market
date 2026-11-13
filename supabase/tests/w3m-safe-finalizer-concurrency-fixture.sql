-- Persistent fixture for two-session tests of the REAL W3M Safe finalizer.
-- Disposable PostgreSQL only. The caller must clean fixture_key='signer-race'.
CREATE TABLE IF NOT EXISTS public.w3m_test_finalizer_race_fixture (
  fixture_key text PRIMARY KEY,
  attempt_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  project_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  signer_key_id text NOT NULL,
  broadcast_tx_hash text NOT NULL,
  receipt jsonb NOT NULL
);

do $test$
declare
  v_deal uuid := '10000000-0000-4000-8000-000000000001';
  v_project uuid := '20000000-0000-4000-8000-000000000002';
  v_buyer uuid := '21000000-0000-4000-8000-000000000002';
  v_seller uuid := '22000000-0000-4000-8000-000000000002';
  v_tx uuid := '30000000-0000-4000-8000-000000000003';
  v_report uuid := '40000000-0000-4000-8000-000000000004';
  v_stale_report uuid := '40000000-0000-4000-8000-000000000005';
  v_policy uuid := '50000000-0000-4000-8000-000000000005';
  v_attempt uuid;
  v_actor uuid := '21000000-0000-4000-8000-000000000002';
  v_package_hash text := repeat('c',64);
  v_package jsonb;
  v_package_expiry timestamptz;
  v_package_issue_at timestamptz;
  v_result jsonb;
  v_safe_hash text := '0x' || repeat('a', 64);
  v_broadcast_hash text := '0x' || repeat('b', 64);
  v_receipt jsonb;
  v_snapshot jsonb;
  v_terms_hash text := repeat('f',64);
  v_terms jsonb;
  v_terms_result jsonb;
  v_acceptance jsonb;
  v_rejected boolean;
begin
  insert into public.projects (id,owner_id,status,github_url) values (v_project,v_seller,'active','https://github.com/aminzaki1972/Web3Market');

  -- Match the live database owner guard: an authenticated user cannot transfer
  -- project ownership directly. Only the trusted service-role finalizer may.
  perform set_config('request.jwt.claim.role','authenticated',true);
  v_rejected := false;
  begin
    update public.projects set owner_id=v_buyer where id=v_project;
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected
     or not exists (select 1 from public.projects where id=v_project and owner_id=v_seller) then
    raise exception 'Ordinary authenticated owner mutation was not blocked';
  end if;
  perform set_config('request.jwt.claim.role','service_role',true);

  insert into public.w3m_trusted_signer_keys (
    key_id, algorithm, public_address, valid_from, valid_until, created_by
  ) values (
    'attempt-test-key','ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
    '0x1111111111111111111111111111111111111111',
    now() - interval '1 day', now() + interval '1 day','isolated-schema-test'
  );

  insert into public.w3m_trusted_signer_key_events (
    key_id, event_type, actor_type, reason, event_hash
  ) values ('attempt-test-key','ACTIVATED','SYSTEM','isolated test key',repeat('a',64));

  insert into auth.users(id) values (v_buyer),(v_seller) on conflict do nothing;
  insert into public.profiles (id,wallet_address,wallet_verified,wallet_verified_at) values
    (v_buyer,'0x3333333333333333333333333333333333333333',true,now()),
    (v_seller,'0x4444444444444444444444444444444444444444',true,now());

  insert into public.deals (
    id, project_id, buyer_id, seller_id, amount, payment_status, payment_tx_hash,
    delivery_status, buyer_approved_at, dispute_status, chain_id, safe_address, token_contract
  ) values (
    v_deal,v_project,v_buyer,v_seller,100,'confirmed','0x' || repeat('a',64),'accepted',now(),'none',56,
    '0x2222222222222222222222222222222222222222',
    '0x55d398326f99059ff775485246999027b3197955'
  );

  insert into public.deal_release_policies (
    id,deal_id,status,chain_id,safe_address,token_contract,deal_amount,
    seller_wallet,platform_wallet,seller_net_amount,fee_amount,fee_percent,token_symbol
  ) values (
    v_policy,v_deal,'locked',56,
    '0x2222222222222222222222222222222222222222',
    '0x55d398326f99059ff775485246999027b3197955',100,
    '0x4444444444444444444444444444444444444444',
    '0x2B15cC63eE3b833F502C065767695Fa2B584f8c9',92.5,7.5,7.5,'USDT'
  );

  insert into public.deal_multisig_transactions (
    id,deal_id,action,status,safe_tx_hash,chain_id,safe_address,safe_nonce
  ) values (
    v_tx,v_deal,'release_to_seller','signed',v_safe_hash,56,
    '0x2222222222222222222222222222222222222222',7
  );

  -- The deal terms now bind to a pre-agreement immutable Code Audit manifest.
  insert into public.code_audits (
    id,project_id,repo_url,repo_owner,repo_name,audit_type,overall_score,risk_level,
    analysis_method,commit_sha,status,completed_at,engine_version,analysis_progress,
    files_scanned,critical_count,high_count,medium_count,low_count,info_count
  ) values (
    '75000000-0000-4000-8000-000000000001',v_project,
    'https://github.com/aminzaki1972/Web3Market','aminzaki1972','Web3Market',
    'code',90,'low','gemini',repeat('1',40),'running',null,'w3m-code-audit-1.0',
    jsonb_build_object('evidence_version','w3m-audit-evidence-v1','tree_truncated',false,'persisted_file_count',1),
    1,0,0,0,0,0
  );
  insert into public.code_audit_files(id,audit_id,path)
    values ('75100000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','README.md');
  update public.code_audits
     set status='completed',completed_at='2026-11-01T10:00:00Z'
   where id='75000000-0000-4000-8000-000000000001';
  v_snapshot := public.w3m_create_deal_code_audit_snapshot(
    v_deal,'75000000-0000-4000-8000-000000000001',
    'w3m-audit-manifest-v1',repeat('a',64),1,0
  );
  if v_snapshot->>'audit_id' <> '75000000-0000-4000-8000-000000000001' then
    raise exception 'Safe-attempt fixture failed to create its independent audit snapshot';
  end if;

  -- Pin a real immutable terms version and both party acceptances for the attempt.
  v_terms := public.w3m_current_deal_terms_json(v_deal);
  v_terms_result := public.w3m_register_deal_terms_version(v_deal,v_terms_hash,v_terms);
  if coalesce((v_terms_result->>'terms_version')::bigint,0) <> 1 then
    raise exception 'Attempt fixture could not register its immutable deal terms';
  end if;
  v_acceptance := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'buyer',v_buyer,'0x3333333333333333333333333333333333333333',
    v_terms_hash,v_terms,'0x' || repeat('1',64),'0x' || repeat('2',130)
  );
  if coalesce((v_acceptance->>'accepted')::boolean,false) is not true then
    raise exception 'Attempt fixture buyer acceptance failed';
  end if;
  v_acceptance := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'seller',v_seller,'0x4444444444444444444444444444444444444444',
    v_terms_hash,v_terms,'0x' || repeat('3',64),'0x' || repeat('4',130)
  );
  if coalesce((v_acceptance->>'accepted')::boolean,false) is not true then
    raise exception 'Attempt fixture seller acceptance failed';
  end if;

  insert into public.w3m_acquisition_reports (
    id,deal_id,project_id,report_version,supersedes_report_id,buyer_id,seller_id,status,engine_version,
    evidence_hash,report_hash,report_payload,signer_key_id,report_signature,issued_at,expires_at
  ) values (
    v_report,v_deal::text,v_project::text,1,null,v_buyer::text,v_seller::text,'PASS','test-engine',
    repeat('c',64),repeat('d',64),jsonb_build_object('dealTermsHash',v_terms_hash,'evidenceCount',2,'auditId','75000000-0000-4000-8000-000000000001','expectedCommitSha',repeat('1',40)),'attempt-test-key',
    '0x' || repeat('e',130),now() - interval '1 minute',now() + interval '1 hour'
  );

  insert into public.w3m_acquisition_evidence (
    report_id,evidence_type,source_table,source_record_id,source_version,
    evidence_hash,result,mandatory,observed_at,valid_until,details
  ) values (
    v_report,'PROJECT_IDENTITY',null,null,null,repeat('c',64),'PASS',true,now(),now() + interval '1 hour',
    jsonb_build_object('evidenceId','attempt-test-project-identity','evidenceObservedAt',now(),'evidenceValidUntil',now() + interval '1 hour')
  ), (
    v_report,'CODE_AUDIT','code_audits','75000000-0000-4000-8000-000000000001',repeat('1',40),
    repeat('a',64),'PASS',true,now(),now() + interval '1 hour',
    jsonb_build_object(
      'auditStatus','completed',
      'auditManifestVersion','w3m-audit-manifest-v1',
      'auditManifestHash',repeat('a',64),
      'commitSha',repeat('1',40),
      'auditType','code',
      'overallScore',90,'riskLevel','low','analysisMethod','gemini',
      'completedAt','2026-11-01T10:00:00.000Z',
      'repositoryOwner','aminzaki1972',
      'repositoryName','Web3Market',
      'auditFileCount','1',
      'auditFindingCount','0'
    )
  );

  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms immediate';
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms deferred';

  v_result := public.w3m_claim_safe_execution_attempt(
    v_deal,v_tx,v_report,v_safe_hash,v_actor::text,'signer-race-idempotency-key-0001'
  );
  if coalesce((v_result->>'claimed')::boolean,false) is not true
     or coalesce((v_result->>'idempotent_replay')::boolean,true) is not false then
    raise exception 'Initial execution claim did not create a fresh claim';
  end if;
  v_attempt := (v_result->>'attempt_id')::uuid;

  -- Once the execution attempt pins this report, evidence is frozen. This
  -- behavioral assertion complements the independent-session report race.
  v_rejected := false;
  begin
    insert into public.w3m_acquisition_evidence (
      report_id,evidence_type,source_table,source_record_id,source_version,
      evidence_hash,result,mandatory,observed_at,valid_until,details
    ) values (
      v_report,'DISPUTE_CHECK',null,null,null,repeat('9',64),'PASS',true,
      now(),now()+interval '1 hour',jsonb_build_object('test','post-pin append must fail')
    );
  exception when sqlstate '55000' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'Evidence append was allowed after the execution attempt pinned the report';
  end if;

  begin
    perform public.w3m_claim_safe_execution_attempt(
      v_deal,v_tx,v_report,v_safe_hash,v_seller::text,'signer-race-idempotency-key-0001'
    );
    raise exception 'A different deal participant reused another actor idempotency claim';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.w3m_claim_safe_execution_attempt(
      v_deal,v_tx,v_report,v_safe_hash,'23000000-0000-4000-8000-000000000003',
      'signer-race-idempotency-key-0002'
    );
    raise exception 'A non-participant was unexpectedly allowed to claim Safe execution';
  exception when insufficient_privilege then null;
  end;

  v_package_expiry := clock_timestamp() + interval '90 seconds';
  v_package := jsonb_build_object(
    'protocol','W3M_PROTOCOL_V1',
    'issuedAt',clock_timestamp(),
    'expiresAt',v_package_expiry,
    'dealId',v_deal::text,
    'executorWallet','0x3333333333333333333333333333333333333333'
  );
  begin
    perform public.w3m_issue_safe_execution_package(
      v_attempt,v_actor,v_package_hash,v_package - 'executorWallet',v_package_expiry
    );
    raise exception 'Package without authenticated executor wallet was unexpectedly issued';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.w3m_issue_safe_execution_package(
    v_attempt,v_actor,v_package_hash,v_package,v_package_expiry
  );
  if coalesce((v_result->>'issued')::boolean,false) is not true
     or coalesce((v_result->>'idempotent_replay')::boolean,true) is not false
     or v_result->>'package_hash' <> v_package_hash
     or v_result->'package' <> v_package then
    raise exception 'Initial connected-wallet package issuance failed';
  end if;

  v_package := jsonb_build_object(
    'protocol','W3M_PROTOCOL_V1',
    'issuedAt',clock_timestamp(),
    'expiresAt',clock_timestamp() + interval '4 seconds',
    'dealId',v_deal::text,
    'executorWallet','0x3333333333333333333333333333333333333333'
  );
  v_result := public.w3m_issue_safe_execution_package(
    v_attempt,v_actor,repeat('d',64),v_package,(v_package->>'expiresAt')::timestamptz
  );
  if coalesce((v_result->>'issued')::boolean,false) is not true
     or coalesce((v_result->>'idempotent_replay')::boolean,false) is not true
     or (v_result->'package'->>'expiresAt')::timestamptz <> v_package_expiry then
    raise exception 'Exact semantic wallet package replay did not return the original package';
  end if;

  begin
    v_package := jsonb_set(v_package,'{dealId}',to_jsonb('different-deal'::text));
    perform public.w3m_issue_safe_execution_package(
      v_attempt,v_actor,repeat('d',64),v_package,(v_package->>'expiresAt')::timestamptz
    );
    raise exception 'Changed wallet package payload was unexpectedly accepted';
  exception when unique_violation then null;
  end;

  if has_function_privilege('anon','public.w3m_issue_safe_execution_package(uuid,uuid,text,jsonb,timestamp with time zone)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_issue_safe_execution_package(uuid,uuid,text,jsonb,timestamp with time zone)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_issue_safe_execution_package(uuid,uuid,text,jsonb,timestamp with time zone)','EXECUTE') then
    raise exception 'Wallet package issuance RPC privileges are not service-role-only';
  end if;

  v_result := public.w3m_claim_safe_execution_attempt(
    v_deal,v_tx,v_report,v_safe_hash,v_actor::text,'signer-race-idempotency-key-0001'
  );
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true
     or (v_result->>'attempt_id')::uuid <> v_attempt then
    raise exception 'Same idempotency key did not return the original claim';
  end if;

  begin
    perform public.w3m_claim_safe_execution_attempt(
      v_deal,v_tx,v_report,v_safe_hash,v_seller::text,'signer-race-idempotency-key-0002'
    );
    raise exception 'A second active attempt for the deal was unexpectedly accepted';
  exception when unique_violation then null;
  end;

  -- A package cannot be used by another participant or after expiry.
  begin
    perform public.w3m_record_safe_wallet_submission(
      v_attempt,v_seller,v_package_hash,v_broadcast_hash
    );
    raise exception 'Wallet package submission by a different actor was unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.w3m_record_safe_wallet_submission(
      v_attempt,v_actor,repeat('f',64),v_broadcast_hash
    );
    raise exception 'Wallet package submission with a different package hash was unexpectedly accepted';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set wallet_verified = false where id = v_actor;
  begin
    perform public.w3m_record_safe_wallet_submission(
      v_attempt,v_actor,v_package_hash,'0x' || repeat('f',64)
    );
    raise exception 'A revoked participant wallet was unexpectedly allowed to submit';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set wallet_verified = true where id = v_actor;

  -- The outer hash can be reported after expiry if a wallet broadcast may
  -- have happened earlier. This remains unverified until canonical receipt
  -- timestamp enforcement inside FINALIZE.
  -- Concurrency fixture skips the independent delayed-handoff timing assertion.
  v_result := public.w3m_record_safe_wallet_submission(
    v_attempt,v_actor,v_package_hash,v_broadcast_hash
  );
  if coalesce((v_result->>'recorded')::boolean,false) is not true
     or v_result->>'state' <> 'BROADCAST' then
    raise exception 'Delayed wallet hash handoff was not recorded for receipt reconciliation';
  end if;

  if has_function_privilege('anon','public.w3m_record_safe_wallet_submission(uuid,uuid,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_record_safe_wallet_submission(uuid,uuid,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_record_safe_wallet_submission(uuid,uuid,text,text)','EXECUTE') then
    raise exception 'Wallet submission RPC privileges are not service-role-only';
  end if;

  v_result := public.w3m_record_safe_wallet_submission(
    v_attempt,v_actor,v_package_hash,v_broadcast_hash
  );
  if coalesce((v_result->>'recorded')::boolean,false) is not true
     or v_result->>'state' <> 'BROADCAST'
     or v_result->>'broadcast_tx_hash' <> lower(v_broadcast_hash) then
    raise exception 'Connected-wallet transaction hash was not recorded against its exact package';
  end if;
  v_result := public.w3m_record_safe_wallet_submission(
    v_attempt,v_actor,v_package_hash,v_broadcast_hash
  );
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Same connected-wallet transaction hash was not idempotent';
  end if;

  update public.deal_multisig_transactions set status='submitted',tx_hash=v_broadcast_hash where id=v_tx;

  v_result := public.w3m_claim_safe_execution_attempt(
    v_deal,v_tx,v_report,v_safe_hash,v_actor::text,'signer-race-idempotency-key-0001'
  );
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true
     or (v_result->>'attempt_id')::uuid <> v_attempt then
    raise exception 'Claim replay failed after transaction status advanced';
  end if;

  begin
    perform public.w3m_record_safe_execution_broadcast(v_attempt,'0x' || repeat('f',64));
    raise exception 'A different broadcast hash was unexpectedly accepted';
  exception when check_violation then null;
  end;

  v_result := public.w3m_mark_safe_execution_reconciliation_required(v_attempt,'RPC_TIMEOUT_UNCERTAIN');
  if coalesce((v_result->>'updated')::boolean,false) is not true then
    raise exception 'Attempt did not enter reconciliation-required state';
  end if;
  v_result := public.w3m_mark_safe_execution_reconciliation_required(v_attempt,'RPC_TIMEOUT_UNCERTAIN');
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Reconciliation transition was not idempotent';
  end if;

  -- Simulate a process crash after broadcast but before the hash was persisted.
  -- A trusted reconciler can bind the discovered original hash, but the attempt
  -- remains blocking in RECONCILIATION_REQUIRED (never reopened for rebroadcast).
  update public.w3m_safe_execution_attempts
     set broadcast_tx_hash = null, broadcast_at = null
   where id = v_attempt;
  v_result := public.w3m_record_safe_wallet_submission(
    v_attempt,v_actor,v_package_hash,v_broadcast_hash
  );
  if coalesce((v_result->>'recorded')::boolean,false) is not true
     or v_result->>'state' <> 'RECONCILIATION_REQUIRED' then
    raise exception 'Reconciled wallet transaction hash was not bound while preserving the blocking state';
  end if;
  v_result := public.w3m_record_safe_wallet_submission(
    v_attempt,v_actor,v_package_hash,v_broadcast_hash
  );
  if coalesce((v_result->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Reconciled wallet transaction hash replay was not idempotent';
  end if;

  if has_function_privilege('anon','public.w3m_read_safe_finalization_snapshot(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_read_safe_finalization_snapshot(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_read_safe_finalization_snapshot(uuid)','EXECUTE') then
    raise exception 'Safe finalization snapshot reader privileges are not service-role-only';
  end if;

  v_snapshot := public.w3m_read_safe_finalization_snapshot(v_attempt);
  if v_snapshot->>'attempt_id' <> v_attempt::text
     or v_snapshot->>'deal_id' <> v_deal::text
     or v_snapshot->>'transaction_id' <> v_tx::text
     or v_snapshot->>'report_id' <> v_report::text
     or v_snapshot->>'broadcast_tx_hash' <> lower(v_broadcast_hash)
     or v_snapshot->>'safe_tx_hash' <> lower(v_safe_hash)
     or v_snapshot->>'chain_id' <> '56'
     or v_snapshot->>'seller_net_amount' <> '92.5'
     or v_snapshot->>'platform_fee' <> '7.5'
     or v_snapshot->>'policy_status' <> 'locked'
     or v_snapshot->>'attempt_state' <> 'RECONCILIATION_REQUIRED'
     or v_snapshot->>'package_actor_id' <> v_actor::text
     or v_snapshot->>'package_hash' <> v_package_hash
     or v_snapshot->>'package_issued_at' is null
     or v_snapshot->>'package_expires_at' is null then
    raise exception 'Safe finalization snapshot did not preserve exact bindings and numeric text';
  end if;

  select package_issued_at into v_package_issue_at
    from public.w3m_safe_execution_attempts where id = v_attempt;

  v_receipt := jsonb_build_object(
    'chain_id',56,'transaction_hash',v_broadcast_hash,'receipt_status',1,
    'block_timestamp',v_package_issue_at + interval '2 seconds',
    'execution_success',true,'execution_failure',false,
    'safe_address','0x2222222222222222222222222222222222222222',
    'safe_tx_hash',v_safe_hash,
    'token_contract','0x55d398326f99059ff775485246999027b3197955',
    'transfers',jsonb_build_array(
      jsonb_build_object('from_address','0x2222222222222222222222222222222222222222',
        'to_address','0x4444444444444444444444444444444444444444','amount','92.5'),
      jsonb_build_object('from_address','0x2222222222222222222222222222222222222222',
        'to_address','0x2B15cC63eE3b833F502C065767695Fa2B584f8c9','amount','7.5')
    ),
    'acquisition_attestation',jsonb_build_object(
      'authorized',true,'signature_valid',true,
      'report_id',v_report::text,'report_version',1,
      'report_hash',repeat('d',64),'evidence_hash',repeat('c',64),
      'signer_key_id','attempt-test-key',
      'terms_version_id',v_terms_result->>'terms_version_id',
      'terms_version',1,'terms_hash',v_terms_hash,
      'recomputed_evidence_hash',repeat('c',64)
    )
  );
  INSERT INTO public.w3m_test_finalizer_race_fixture (
    fixture_key,attempt_id,deal_id,project_id,buyer_id,seller_id,
    signer_key_id,broadcast_tx_hash,receipt
  ) VALUES (
    'signer-race',v_attempt,v_deal,v_project,v_buyer,v_seller,
    'attempt-test-key',v_broadcast_hash,v_receipt
  );
end;
$test$;
