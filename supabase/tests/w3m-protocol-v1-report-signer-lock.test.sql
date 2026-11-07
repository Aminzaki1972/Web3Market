-- Disposable PostgreSQL CI only: PASS report insertion must serialize
-- against signer activation/revocation and reject unknown or expired keys.
do $test$
declare
  v_now timestamptz := clock_timestamp();
  v_active_key text := 'w3m-report-active-signer-test';
  v_revoked_key text := 'w3m-report-revoked-signer-test';
  v_expired_key text := 'w3m-report-expired-signer-test';
  v_not_yet_valid_key text := 'w3m-report-future-signer-test';
  v_blocked boolean;
  v_report_id uuid;
  v_deal_id text;
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='w3m_acquisition_reports'
      and t.tgname='w3m_acquisition_reports_require_active_signer'
      and not t.tgisinternal
      and (t.tgtype & 2)=2
      and (t.tgtype & 4)=4
  ) then
    raise exception 'PASS report active-signer trigger is missing';
  end if;

  if position('FOR SHARE' in upper(pg_get_functiondef(
       'public.w3m_require_active_report_signer()'::regprocedure
     ))) = 0
     or position('W3M_TRUSTED_SIGNER_KEY_EVENTS' in upper(pg_get_functiondef(
       'public.w3m_require_active_report_signer()'::regprocedure
     ))) = 0 then
    raise exception 'PASS report signer guard does not lock and inspect signer lifecycle events';
  end if;

  -- Unknown signer must fail before a PASS report can enter the registry.
  v_report_id := gen_random_uuid();
  v_deal_id := 'w3m-unknown-signer-' || v_report_id::text;
  v_blocked := false;
  begin
    insert into public.w3m_acquisition_reports (
      id,deal_id,project_id,report_version,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,
      report_signature,issued_at,expires_at
    ) values (
      v_report_id,v_deal_id,'project-signer-test',1,'PASS','test-engine',
      repeat('a',64),repeat('b',64),
      jsonb_build_object('reportId',v_report_id::text,'dealId',v_deal_id,
        'projectId','project-signer-test','reportVersion',1,'status','PASS',
        'evidenceHash',repeat('a',64)),
      'w3m-unknown-signer-key','0x'||repeat('1',130),v_now,v_now+interval '1 day'
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Unknown signer key was accepted for a PASS report'; end if;

  -- Register one active key; its PASS report must be accepted.
  perform public.w3m_register_trusted_signer_key(
    jsonb_build_object('key_id',v_active_key,
      'algorithm','ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
      'public_address','0x1111111111111111111111111111111111111111',
      'valid_from',(v_now-interval '1 hour')::text,
      'valid_until',(v_now+interval '1 day')::text,'created_by','ci-test'),
    jsonb_build_object('key_id',v_active_key,'event_type','ACTIVATED',
      'actor_type','SYSTEM','actor_ref','ci-test','reason','active signer fixture',
      'event_hash',repeat('a',64))
  );

  v_report_id := gen_random_uuid();
  v_deal_id := 'w3m-active-signer-' || v_report_id::text;
  insert into public.w3m_acquisition_reports (
    id,deal_id,project_id,report_version,status,engine_version,
    evidence_hash,report_hash,report_payload,signer_key_id,
    report_signature,issued_at,expires_at
  ) values (
    v_report_id,v_deal_id,'project-signer-test',1,'PASS','test-engine',
    repeat('a',64),repeat('b',64),
    jsonb_build_object('reportId',v_report_id::text,'dealId',v_deal_id,
      'projectId','project-signer-test','reportVersion',1,'status','PASS',
      'evidenceHash',repeat('a',64)),
    v_active_key,'0x'||repeat('1',130),v_now,v_now+interval '1 day'
  );

  -- A revoked key must fail even though its activation event remains immutable.
  perform public.w3m_register_trusted_signer_key(
    jsonb_build_object('key_id',v_revoked_key,
      'algorithm','ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
      'public_address','0x2222222222222222222222222222222222222222',
      'valid_from',(v_now-interval '1 hour')::text,
      'valid_until',(v_now+interval '1 day')::text,'created_by','ci-test'),
    jsonb_build_object('key_id',v_revoked_key,'event_type','ACTIVATED',
      'actor_type','SYSTEM','actor_ref','ci-test','reason','revoked signer fixture',
      'event_hash',repeat('b',64))
  );
  perform public.w3m_revoke_trusted_signer_key(
    v_revoked_key,
    jsonb_build_object('key_id',v_revoked_key,'event_type','REVOKED',
      'actor_type','SYSTEM','actor_ref','ci-test','reason','revoked for guard test',
      'event_hash',repeat('c',64))
  );

  v_report_id := gen_random_uuid();
  v_deal_id := 'w3m-revoked-signer-' || v_report_id::text;
  v_blocked := false;
  begin
    insert into public.w3m_acquisition_reports (
      id,deal_id,project_id,report_version,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,
      report_signature,issued_at,expires_at
    ) values (
      v_report_id,v_deal_id,'project-signer-test',1,'PASS','test-engine',
      repeat('a',64),repeat('b',64),
      jsonb_build_object('reportId',v_report_id::text,'dealId',v_deal_id,
        'projectId','project-signer-test','reportVersion',1,'status','PASS',
        'evidenceHash',repeat('a',64)),
      v_revoked_key,'0x'||repeat('1',130),v_now,v_now+interval '1 day'
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Revoked signer key was accepted for a PASS report'; end if;

  -- Time validity is checked against the report's immutable issued_at.
  perform public.w3m_register_trusted_signer_key(
    jsonb_build_object('key_id',v_expired_key,
      'algorithm','ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
      'public_address','0x3333333333333333333333333333333333333333',
      'valid_from',(v_now-interval '2 days')::text,
      'valid_until',(v_now-interval '1 day')::text,'created_by','ci-test'),
    jsonb_build_object('key_id',v_expired_key,'event_type','ACTIVATED',
      'actor_type','SYSTEM','actor_ref','ci-test','reason','expired signer fixture',
      'event_hash',repeat('d',64))
  );

  v_report_id := gen_random_uuid();
  v_deal_id := 'w3m-expired-signer-' || v_report_id::text;
  v_blocked := false;
  begin
    insert into public.w3m_acquisition_reports (
      id,deal_id,project_id,report_version,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,
      report_signature,issued_at,expires_at
    ) values (
      v_report_id,v_deal_id,'project-signer-test',1,'PASS','test-engine',
      repeat('a',64),repeat('b',64),
      jsonb_build_object('reportId',v_report_id::text,'dealId',v_deal_id,
        'projectId','project-signer-test','reportVersion',1,'status','PASS',
        'evidenceHash',repeat('a',64)),
      v_expired_key,'0x'||repeat('1',130),v_now,v_now+interval '1 day'
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Expired signer key was accepted for a PASS report'; end if;

  perform public.w3m_register_trusted_signer_key(
    jsonb_build_object('key_id',v_not_yet_valid_key,
      'algorithm','ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
      'public_address','0x4444444444444444444444444444444444444444',
      'valid_from',(v_now+interval '1 day')::text,
      'valid_until',(v_now+interval '2 days')::text,'created_by','ci-test'),
    jsonb_build_object('key_id',v_not_yet_valid_key,'event_type','ACTIVATED',
      'actor_type','SYSTEM','actor_ref','ci-test','reason','future signer fixture',
      'event_hash',repeat('e',64))
  );

  v_report_id := gen_random_uuid();
  v_deal_id := 'w3m-future-signer-' || v_report_id::text;
  v_blocked := false;
  begin
    insert into public.w3m_acquisition_reports (
      id,deal_id,project_id,report_version,status,engine_version,
      evidence_hash,report_hash,report_payload,signer_key_id,
      report_signature,issued_at,expires_at
    ) values (
      v_report_id,v_deal_id,'project-signer-test',1,'PASS','test-engine',
      repeat('a',64),repeat('b',64),
      jsonb_build_object('reportId',v_report_id::text,'dealId',v_deal_id,
        'projectId','project-signer-test','reportVersion',1,'status','PASS',
        'evidenceHash',repeat('a',64)),
      v_not_yet_valid_key,'0x'||repeat('1',130),v_now,v_now+interval '1 day'
    );
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then raise exception 'Not-yet-valid signer key was accepted for a PASS report'; end if;
end;
$test$;
