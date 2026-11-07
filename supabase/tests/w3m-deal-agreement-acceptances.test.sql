-- Isolated SQL contract tests for immutable EIP-712 deal agreement persistence.
-- This file runs only against the disposable PostgreSQL database in CI.
begin;

-- PASS reports require a registered active signer, including in this SQL contract test.
-- This is a public test key fixture only; no private key or secret is stored.
select public.w3m_register_trusted_signer_key(
  jsonb_build_object(
    'key_id','test-signer-v1',
    'algorithm','ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
    'public_address','0x1111111111111111111111111111111111111111',
    'valid_from',(clock_timestamp()-interval '1 day')::text,
    'valid_until',(clock_timestamp()+interval '1 day')::text,
    'created_by','ci-test'
  ),
  jsonb_build_object(
    'key_id','test-signer-v1',
    'event_type','ACTIVATED',
    'actor_type','SYSTEM',
    'actor_ref','ci-test',
    'reason','agreement acceptance fixture',
    'event_hash',repeat('f',64)
  )
);

do $test$
declare
  v_deal uuid := '81000000-0000-4000-8000-000000000001';
  v_project uuid := '82000000-0000-4000-8000-000000000002';
  v_buyer uuid := '83000000-0000-4000-8000-000000000003';
  v_seller uuid := '84000000-0000-4000-8000-000000000004';
  v_hash text := repeat('a',64);
  v_digest_buyer text := '0x' || repeat('b',64);
  v_digest_seller text := '0x' || repeat('c',64);
  v_sig_buyer text := '0x' || repeat('d',130);
  v_sig_seller text := '0x' || repeat('e',130);
  v_canonical jsonb;
  v_version jsonb;
  v_accept jsonb;
  v_version_id uuid;
  v_snapshot jsonb;
  v_context jsonb;
begin
  insert into public.projects(id,owner_id,status,github_url)
    values (v_project,v_seller,'active','https://github.com/Aminzaki1972/Web3Market');
  insert into public.profiles(id,wallet_address,wallet_verified,wallet_verified_at)
    values
      (v_buyer,'0x5555555555555555555555555555555555555555',true,now()),
      (v_seller,'0x4444444444444444444444444444444444444444',true,now());
  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,expected_amount,
    payment_status,delivery_status,chain_id,safe_address,token_contract,token_symbol
  ) values (
    v_deal,v_project,v_buyer,v_seller,100,'USDT',100,
    'confirmed','accepted',56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333','USDT'
  );
  insert into public.deal_release_policies(
    id,deal_id,status,chain_id,safe_address,token_contract,deal_amount,
    seller_wallet,platform_wallet,seller_net_amount,fee_amount,fee_percent,safe_nonce,token_symbol
  ) values (
    '85000000-0000-4000-8000-000000000005',v_deal,'locked',56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',100,
    '0x4444444444444444444444444444444444444444',
    '0x2B15cC63eE3b833F502C065767695Fa2B584f8c9',
    92.5,7.5,7.5,7,'USDT'
  );

  -- The first deal starts with no acquisition report. Its completed source
  -- audit is snapshotted independently before agreement terms are registered.
  insert into public.code_audits(
    id,project_id,repo_url,repo_owner,repo_name,audit_type,overall_score,risk_level,analysis_method,commit_sha,status,completed_at,
    engine_version,analysis_progress,files_scanned,
    critical_count,high_count,medium_count,low_count,info_count
  ) values (
    '87000000-0000-4000-8000-000000000007',v_project,
    'https://github.com/Aminzaki1972/Web3Market','Aminzaki1972','Web3Market',
    'code',90,'low','gemini',repeat('a',40),'running',null,
    'w3m-code-audit-1.0',
    '{"evidence_version":"w3m-audit-evidence-v1","tree_truncated":false,"persisted_file_count":1}'::jsonb,
    1,0,0,0,0,0
  );
  insert into public.code_audit_files(id,audit_id,path)
    values ('87100000-0000-4000-8000-000000000007','87000000-0000-4000-8000-000000000007','README.md');
  update public.code_audits
     set status='completed',completed_at='2026-11-01T10:00:00Z'
   where id='87000000-0000-4000-8000-000000000007';
  v_snapshot := public.w3m_create_deal_code_audit_snapshot(
    v_deal,'87000000-0000-4000-8000-000000000007',
    'w3m-audit-manifest-v1',repeat('c',64),1,0
  );
  if v_snapshot->>'audit_id' <> '87000000-0000-4000-8000-000000000007'
     or coalesce((v_snapshot->>'idempotent_replay')::boolean,true) then
    raise exception 'Independent first-deal Code Audit snapshot was not created';
  end if;
  v_context := public.w3m_read_deal_audit_snapshot_context(v_deal,v_buyer);
  if v_context->>'deal_id' <> v_deal::text
     or v_context->>'project_id' <> v_project::text
     or v_context->>'buyer_id' <> v_buyer::text
     or v_context->>'seller_id' <> v_seller::text
     or v_context->>'audit_id' <> '87000000-0000-4000-8000-000000000007' then
    raise exception 'Pre-agreement audit context did not select the exact project audit';
  end if;
  begin
    perform public.w3m_read_deal_audit_snapshot_context(
      v_deal,'75000000-0000-4000-8000-000000000005'
    );
    raise exception 'Non-party actor was allowed to read the deal audit snapshot context';
  exception when insufficient_privilege then null;
  end;
  v_snapshot := public.w3m_create_deal_code_audit_snapshot(
    v_deal,'87000000-0000-4000-8000-000000000007',
    'w3m-audit-manifest-v1',repeat('c',64),1,0
  );
  if coalesce((v_snapshot->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Exact duplicate snapshot request was not idempotent';
  end if;
  begin
    update public.w3m_deal_code_audit_snapshots
       set manifest_hash=repeat('d',64)
     where id=(v_snapshot->>'id')::uuid;
    raise exception 'Immutable Deal Code Audit snapshot accepted an update';
  exception when sqlstate '55000' then null;
  end;
  if (select count(*) from public.w3m_acquisition_reports where deal_id=v_deal::text) <> 0 then
    raise exception 'First-deal test must begin without an acquisition report';
  end if;

  -- A PASS report is rejected before both parties have signed, even though
  -- the independent audit snapshot already exists.
  begin
    execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms immediate';
    insert into public.w3m_acquisition_reports(
      id,deal_id,project_id,report_version,buyer_id,seller_id,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,report_signature,issued_at,expires_at
    ) values (
      '86000000-0000-4000-8000-000000000006',v_deal::text,v_project::text,1,
      v_buyer::text,v_seller::text,'PASS','w3m-acquisition-verification-1.0.0',
      repeat('b',64),repeat('d',64),
      jsonb_build_object('dealId',v_deal::text,'projectId',v_project::text,
        'buyerId',v_buyer::text,'sellerId',v_seller::text,'dealTermsHash',v_hash,
        'auditId','87000000-0000-4000-8000-000000000007','expectedCommitSha',repeat('a',40)),
      'test-signer-v1','0x' || repeat('d',130),now(),now()+interval '1 day'
    );
    raise exception 'PASS report was accepted before both agreement signatures';
  exception when check_violation then null;
  end;
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms deferred';
  begin
    execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms immediate';
    insert into public.w3m_acquisition_reports(
      id,deal_id,project_id,report_version,buyer_id,seller_id,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,report_signature,issued_at,expires_at
    ) values (
      '86200000-0000-4000-8000-000000000006',v_deal::text,v_project::text,1,
      v_buyer::text,v_seller::text,'BLOCKED','w3m-acquisition-verification-1.0.0',
      repeat('b',64),repeat('e',64),
      jsonb_build_object('dealId',v_deal::text,'projectId',v_project::text,
        'buyerId',v_buyer::text,'sellerId',v_seller::text,'dealTermsHash',v_hash,
        'auditId','87000000-0000-4000-8000-000000000007','expectedCommitSha',repeat('a',40)),
      'test-signer-v1','0x' || repeat('e',130),now(),now()+interval '1 day'
    );
    raise exception 'BLOCKED report was accepted before both agreement signatures';
  exception when check_violation then null;
  end;
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms deferred';

  -- One wallet cannot represent both buyer and seller consent.
  update public.profiles
     set wallet_address='0x4444444444444444444444444444444444444444'
   where id=v_buyer;
  begin
    perform public.w3m_register_deal_terms_version(v_deal,v_hash,'{}'::jsonb);
    raise exception 'Terms version was registered with the same buyer and seller wallet';
  exception when check_violation then null;
  end;
  update public.profiles
     set wallet_address='0x5555555555555555555555555555555555555555'
   where id=v_buyer;

  v_canonical := jsonb_build_object(
    'protocol','W3M Protocol V1','dealId',v_deal::text,'projectId',v_project::text,
    'buyerId',v_buyer::text,'sellerId',v_seller::text,'amount','100',
    'currency','USDT','expectedAmount','100','chainId',56,
    'safeAddress','0x2222222222222222222222222222222222222222',
    'tokenContract','0x3333333333333333333333333333333333333333',
    'codeAudit',jsonb_build_object(
      'auditId','87000000-0000-4000-8000-000000000007',
      'repositoryOwner','Aminzaki1972',
      'repositoryName','Web3Market',
      'repositoryUrl','https://github.com/Aminzaki1972/Web3Market',
      'commitSha',repeat('a',40),
      'auditType','code',
      'completedAt','2026-11-01T10:00:00.000Z',
      'auditEvidenceHash',repeat('c',64)
    ),
    'releasePolicy',jsonb_build_object(
      'dealAmount','100','feePercent','7.5','feeAmount','7.5',
      'sellerNetAmount','92.5','chainId',56,
      'safeAddress','0x2222222222222222222222222222222222222222',
      'tokenContract','0x3333333333333333333333333333333333333333',
      'sellerWallet','0x4444444444444444444444444444444444444444',
      'platformWallet','0x2b15cc63ee3b833f502c065767695fa2b584f8c9',
      'safeNonce','7','status','locked'
    )
  );

  if public.w3m_normalize_numeric_text(100.000000::numeric) <> '100'
     or public.w3m_normalize_numeric_text(7.500000::numeric) <> '7.5' then
    raise exception 'Canonical numeric normalization did not match TypeScript decimal normalization';
  end if;

  v_version := public.w3m_register_deal_terms_version(v_deal,v_hash,v_canonical);
  if v_version->>'terms_version' <> '1'
     or coalesce((v_version->>'idempotent_replay')::boolean,true) then
    raise exception 'First terms version was not created';
  end if;
  v_version_id := (v_version->>'terms_version_id')::uuid;

  v_version := public.w3m_register_deal_terms_version(v_deal,v_hash,v_canonical);
  if v_version->>'terms_version' <> '1'
     or coalesce((v_version->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Identical terms did not reuse the same version';
  end if;

  v_accept := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
    v_hash,v_canonical,v_digest_buyer,v_sig_buyer
  );
  if coalesce((v_accept->>'accepted')::boolean,false) is not true
     or coalesce((v_accept->>'idempotent_replay')::boolean,true) then
    raise exception 'Buyer agreement signature was not inserted';
  end if;

  v_accept := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'seller',v_seller,'0x4444444444444444444444444444444444444444',
    v_hash,v_canonical,v_digest_seller,v_sig_seller
  );
  if coalesce((v_accept->>'accepted')::boolean,false) is not true then
    raise exception 'Seller agreement signature was not inserted';
  end if;

  v_accept := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
    v_hash,v_canonical,v_digest_buyer,v_sig_buyer
  );
  if coalesce((v_accept->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Exact duplicate signature was not idempotent';
  end if;

  -- Once both signatures exist, a PASS report may be persisted only when its
  -- CODE_AUDIT evidence matches the exact independent snapshot.
  insert into public.w3m_acquisition_reports(
    id,deal_id,project_id,report_version,buyer_id,seller_id,status,engine_version,
    evidence_hash,report_hash,report_payload,signer_key_id,report_signature,issued_at,expires_at
  ) values (
    '86000000-0000-4000-8000-000000000006',v_deal::text,v_project::text,1,
    v_buyer::text,v_seller::text,'PASS','w3m-acquisition-verification-1.0.0',
    repeat('b',64),repeat('d',64),
    jsonb_build_object('dealId',v_deal::text,'projectId',v_project::text,
      'buyerId',v_buyer::text,'sellerId',v_seller::text,'dealTermsHash',v_hash,
      'auditId','87000000-0000-4000-8000-000000000007','expectedCommitSha',repeat('a',40)),
    'test-signer-v1','0x' || repeat('d',130),now(),now()+interval '1 day'
  );
  insert into public.w3m_acquisition_evidence(
    report_id,evidence_type,source_table,source_record_id,source_version,evidence_hash,
    result,mandatory,observed_at,valid_until,details
  ) values (
    '86000000-0000-4000-8000-000000000006','CODE_AUDIT','code_audits',
    '87000000-0000-4000-8000-000000000007',repeat('a',40),repeat('c',64),
    'PASS',true,now(),now()+interval '1 day',
    jsonb_build_object(
      'auditStatus','completed','auditType','code','commitSha',repeat('a',40),
      'overallScore',90,'riskLevel','low','analysisMethod','gemini',
      'repositoryOwner','Aminzaki1972','repositoryName','Web3Market',
      'completedAt','2026-11-01T10:00:00.000Z',
      'auditManifestVersion','w3m-audit-manifest-v1','auditManifestHash',repeat('c',64),
      'auditFileCount',1,'auditFindingCount',0
    )
  );
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms immediate';
  if (select count(*) from public.w3m_acquisition_reports where id='86000000-0000-4000-8000-000000000006') <> 1 then
    raise exception 'PASS report was not accepted after both agreement signatures';
  end if;
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms deferred';

  -- A report with a valid pair of signatures but a mismatched manifest digest
  -- must still be rejected; consent alone cannot bless altered audit evidence.
  begin
    insert into public.w3m_acquisition_reports(
      id,deal_id,project_id,report_version,buyer_id,seller_id,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,report_signature,issued_at,expires_at
    ) values (
      '86300000-0000-4000-8000-000000000006',v_deal::text,v_project::text,2,
      v_buyer::text,v_seller::text,'PASS','w3m-acquisition-verification-1.0.0',
      repeat('b',64),repeat('9',64),
      jsonb_build_object('dealId',v_deal::text,'projectId',v_project::text,
        'buyerId',v_buyer::text,'sellerId',v_seller::text,'dealTermsHash',v_hash,
        'auditId','87000000-0000-4000-8000-000000000007','expectedCommitSha',repeat('a',40)),
      'test-signer-v1','0x' || repeat('9',130),now(),now()+interval '1 day'
    );
    insert into public.w3m_acquisition_evidence(
      report_id,evidence_type,source_table,source_record_id,source_version,evidence_hash,
      result,mandatory,observed_at,valid_until,details
    ) values (
      '86300000-0000-4000-8000-000000000006','CODE_AUDIT','code_audits',
      '87000000-0000-4000-8000-000000000007',repeat('a',40),repeat('9',64),
      'PASS',true,now(),now()+interval '1 day',
      jsonb_build_object(
        'auditStatus','completed','auditType','code','commitSha',repeat('a',40),
        'overallScore',90,'riskLevel','low','analysisMethod','gemini',
        'repositoryOwner','Aminzaki1972','repositoryName','Web3Market',
        'completedAt','2026-11-01T10:00:00.000Z',
        'auditManifestVersion','w3m-audit-manifest-v1','auditManifestHash',repeat('9',64),
        'auditFileCount',1,'auditFindingCount',0
      )
    );
    execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms immediate';
    raise exception 'Report with a mismatched audit manifest digest was accepted';
  exception when check_violation then null;
  end;
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms deferred';

  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      v_hash,v_canonical,v_digest_buyer,'0x' || repeat('f',130)
    );
    raise exception 'Conflicting duplicate party signature was accepted';
  exception when unique_violation then null;
  end;

  if (select count(*) from public.w3m_deal_agreement_acceptances
      where deal_id=v_deal and terms_version=1) <> 2 then
    raise exception 'Expected exactly one buyer and one seller acceptance';
  end if;

  v_snapshot := public.w3m_read_deal_agreement_signing_snapshot(v_deal);
  if v_snapshot->'deal'->>'id' <> v_deal::text
     or v_snapshot->'buyer_profile'->>'wallet_address' <> '0x5555555555555555555555555555555555555555'
     or v_snapshot->'policy'->>'safe_nonce' <> '7'
     or v_snapshot->'code_audit'->>'auditEvidenceHash' <> repeat('c',64) then
    raise exception 'Private agreement signing snapshot did not return the exact server-side party and policy facts';
  end if;

  v_snapshot := public.w3m_read_safe_execution_snapshot(v_deal);
  if v_snapshot->>'agreement_binding_supported' <> 'true'
     or v_snapshot->'terms_version'->>'terms_version' <> '1'
     or jsonb_array_length(v_snapshot->'agreement_acceptances') <> 2 then
    raise exception 'Safe execution snapshot did not expose both immutable agreement signatures';
  end if;

  -- A newer completed source audit and independent snapshot change the
  -- agreement terms. No report exists yet; old signatures must still be stale.
  insert into public.code_audits(
    id,project_id,repo_url,repo_owner,repo_name,audit_type,overall_score,risk_level,analysis_method,commit_sha,status,completed_at,
    engine_version,analysis_progress,files_scanned,
    critical_count,high_count,medium_count,low_count,info_count
  ) values (
    '89100000-0000-4000-8000-000000000009',v_project,
    'https://github.com/Aminzaki1972/Web3Market','Aminzaki1972','Web3Market',
    'code',90,'low','gemini',repeat('f',40),'running',null,
    'w3m-code-audit-1.0',
    '{"evidence_version":"w3m-audit-evidence-v1","tree_truncated":false,"persisted_file_count":1}'::jsonb,
    1,0,0,0,0,0
  );
  insert into public.code_audit_files(id,audit_id,path)
    values ('89200000-0000-4000-8000-000000000009','89100000-0000-4000-8000-000000000009','README.md');
  update public.code_audits
     set status='completed',completed_at='2026-11-06T18:00:00Z'
   where id='89100000-0000-4000-8000-000000000009';
  v_snapshot := public.w3m_create_deal_code_audit_snapshot(
    v_deal,'89100000-0000-4000-8000-000000000009',
    'w3m-audit-manifest-v1',repeat('f',64),1,0
  );
  if v_snapshot->>'audit_id' <> '89100000-0000-4000-8000-000000000009'
     or coalesce((v_snapshot->>'idempotent_replay')::boolean,true) then
    raise exception 'Updated source audit snapshot was not created';
  end if;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      v_hash,v_canonical,v_digest_buyer,v_sig_buyer
    );
    raise exception 'Old agreement signature was accepted after Audit Manifest changed';
  exception when check_violation then null;
  end;
  v_canonical := jsonb_set(v_canonical,'{codeAudit,auditId}',to_jsonb('89100000-0000-4000-8000-000000000009'::text));
  v_canonical := jsonb_set(v_canonical,'{codeAudit,completedAt}',to_jsonb('2026-11-06T18:00:00.000Z'::text));
  v_canonical := jsonb_set(v_canonical,'{codeAudit,commitSha}',to_jsonb(repeat('f',40)));
  v_canonical := jsonb_set(v_canonical,'{codeAudit,auditEvidenceHash}',to_jsonb(repeat('f',64)));

  update public.deals set amount=101 where id=v_deal;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      v_hash,v_canonical,v_digest_buyer,v_sig_buyer
    );
    raise exception 'Old acceptance was replayed after terms changed';
  exception when check_violation then null;
  end;

  update public.deal_release_policies
     set deal_amount=101, fee_amount=7.575, seller_net_amount=93.425
   where deal_id=v_deal;
  v_canonical := jsonb_set(v_canonical,'{amount}',to_jsonb('101'::text));
  v_canonical := jsonb_set(v_canonical,'{expectedAmount}',to_jsonb('100'::text));
  v_canonical := jsonb_set(v_canonical,'{releasePolicy,dealAmount}',to_jsonb('101'::text));
  v_canonical := jsonb_set(v_canonical,'{releasePolicy,feeAmount}',to_jsonb('7.575'::text));
  v_canonical := jsonb_set(v_canonical,'{releasePolicy,sellerNetAmount}',to_jsonb('93.425'::text));
  v_version := public.w3m_register_deal_terms_version(v_deal,repeat('b',64),v_canonical);
  if v_version->>'terms_version' <> '2'
     or coalesce((v_version->>'idempotent_replay')::boolean,true) then
    raise exception 'Changed terms did not create a new immutable version';
  end if;
  if (select count(*) from public.w3m_deal_agreement_acceptances
      where deal_id=v_deal and terms_version=1) <> 2 then
    raise exception 'Prior signed version was not preserved as immutable history';
  end if;

  -- The second version cannot be accepted if project ownership drifts after
  -- its canonical terms were registered.
  update public.projects set owner_id=v_buyer where id=v_project;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed after project ownership changed';
  exception when check_violation then null;
  end;
  update public.projects set owner_id=v_seller where id=v_project;

  -- Even if only one party is signing, both current verified wallets must remain distinct.
  update public.profiles
     set wallet_address='0x5555555555555555555555555555555555555555'
   where id=v_seller;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed with shared buyer and seller wallet';
  exception when insufficient_privilege then null;
  end;
  update public.profiles
     set wallet_address='0x4444444444444444444444444444444444444444'
   where id=v_seller;

  -- A chain or Safe policy change after version creation must also veto acceptance.
  update public.deals set chain_id=97 where id=v_deal;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed after chain changed';
  exception when check_violation then null;
  end;
  update public.deals set chain_id=56 where id=v_deal;

  update public.deal_release_policies
     set safe_address='0x9999999999999999999999999999999999999999'
   where deal_id=v_deal;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed after Safe policy changed';
  exception when check_violation then null;
  end;

  -- The current binding is independent of report issuance: a first-deal
  -- agreement can be signed against its persisted snapshot before any report.
  if public.w3m_current_deal_code_audit_json(v_deal) is null then
    raise exception 'Independent Code Audit snapshot unexpectedly depends on current report status';
  end if;

  if has_function_privilege('anon','public.w3m_register_deal_terms_version(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_register_deal_terms_version(uuid,text,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_register_deal_terms_version(uuid,text,jsonb)','EXECUTE') then
    raise exception 'Terms-version RPC is not service-role-only';
  end if;
  if has_function_privilege('anon','public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)','EXECUTE') then
    raise exception 'Agreement acceptance RPC is not service-role-only';
  end if;
  if has_function_privilege('anon','public.w3m_read_deal_agreement_signing_snapshot(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_read_deal_agreement_signing_snapshot(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_read_deal_agreement_signing_snapshot(uuid)','EXECUTE') then
    raise exception 'Private signing snapshot RPC is not service-role-only';
  end if;
  if has_function_privilege('anon','public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)','EXECUTE')
     or has_function_privilege('anon','public.w3m_read_deal_audit_snapshot_context(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_read_deal_audit_snapshot_context(uuid,uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_read_deal_audit_snapshot_context(uuid,uuid)','EXECUTE') then
    raise exception 'Independent Deal Code Audit snapshot RPCs are not service-role-only';
  end if;
  if has_table_privilege('authenticated','public.w3m_deal_code_audit_snapshots','SELECT')
     or has_table_privilege('authenticated','public.w3m_deal_code_audit_snapshots','INSERT')
     or has_table_privilege('service_role','public.w3m_deal_code_audit_snapshots','INSERT') then
    raise exception 'Direct access bypasses the immutable Deal Code Audit snapshot RPC';
  end if;
  if has_table_privilege('authenticated','public.w3m_deal_agreement_acceptances','SELECT')
     or has_table_privilege('authenticated','public.w3m_deal_agreement_acceptances','INSERT')
     or has_table_privilege('service_role','public.w3m_deal_agreement_acceptances','INSERT') then
    raise exception 'Direct table access bypasses the restricted agreement RPC';
  end if;
end;
$test$;

rollback;
