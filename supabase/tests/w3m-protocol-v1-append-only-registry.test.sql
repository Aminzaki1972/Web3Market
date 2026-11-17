-- Append-only registry protections. Disposable PostgreSQL CI only.
do $test$
declare
  v_report_id uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_key_id text := 'append-only-test-key';
  v_payload jsonb;
  v_blocked boolean;
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='w3m_acquisition_reports'
      and t.tgname='w3m_acquisition_reports_reject_mutation' and not t.tgisinternal
  ) then raise exception 'Report append-only trigger is missing'; end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='w3m_acquisition_evidence'
      and t.tgname='w3m_acquisition_evidence_reject_mutation' and not t.tgisinternal
  ) then raise exception 'Evidence append-only trigger is missing'; end if;

  if has_table_privilege('service_role','public.w3m_acquisition_reports','UPDATE')
     or has_table_privilege('service_role','public.w3m_acquisition_reports','DELETE')
     or has_table_privilege('service_role','public.w3m_acquisition_evidence','UPDATE')
     or has_table_privilege('service_role','public.w3m_acquisition_evidence','DELETE')
     or has_table_privilege('service_role','public.w3m_trusted_signer_keys','UPDATE')
     or has_table_privilege('service_role','public.w3m_trusted_signer_key_events','DELETE') then
    raise exception 'service_role unexpectedly has direct mutation privileges';
  end if;

  v_payload := jsonb_build_object(
    'reportId',v_report_id::text,'reportVersion',1,'dealId','append-only-test-deal',
    'projectId','append-only-test-project','status','INCOMPLETE','evidenceHash',repeat('a',64)
  );

  perform public.w3m_insert_acquisition_registry_batch(
    jsonb_build_object(
      'id',v_report_id,'deal_id','append-only-test-deal','project_id','append-only-test-project',
      'report_version',1,'supersedes_report_id',null,'buyer_id',null,'seller_id',null,
      'status','INCOMPLETE','engine_version','test','evidence_hash',repeat('a',64),
      'report_hash',repeat('b',64),'report_payload',v_payload,'signer_key_id',null,
      'report_signature',null,'issued_at',now(),'expires_at',now()+interval '1 day'
    ),
    jsonb_build_array(jsonb_build_object(
      'id',v_evidence_id,'report_id',v_report_id,'evidence_type','PROJECT_IDENTITY',
      'source_table',null,'source_record_id','fixture','source_version','1',
      'evidence_hash',repeat('c',64),'result','PASS','mandatory',true,
      'observed_at',now(),'valid_until',now()+interval '1 day','details',jsonb_build_object(
        'evidenceId','append-only-fixture','evidenceObservedAt',now()::text,
        'evidenceValidUntil',(now()+interval '1 day')::text
      )
    )),
    jsonb_build_array(
      jsonb_build_object('id',gen_random_uuid(),'report_id',v_report_id,
        'deal_id','append-only-test-deal','event_type','REPORT_CREATED',
        'actor_type','SYSTEM','actor_ref',null,'event_hash',repeat('d',64),
        'metadata',jsonb_build_object('reportHash',repeat('b',64),'reportVersion',1,'status','INCOMPLETE'),
        'created_at',now()),
      jsonb_build_object('id',gen_random_uuid(),'report_id',v_report_id,
        'deal_id','append-only-test-deal','event_type','EVIDENCE_ATTACHED',
        'actor_type','SYSTEM','actor_ref',null,'event_hash',repeat('e',64),
        'metadata',jsonb_build_object('evidenceRowId',v_evidence_id::text,
          'evidenceType','PROJECT_IDENTITY','evidenceHash',repeat('c',64)),
        'created_at',now())
    )
  );

  v_blocked := false;
  begin
    update public.w3m_acquisition_reports set status='PASS' where id=v_report_id;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Report UPDATE was not blocked'; end if;

  v_blocked := false;
  begin
    delete from public.w3m_acquisition_evidence where id=v_evidence_id;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Evidence DELETE was not blocked'; end if;

  v_blocked := false;
  begin
    delete from public.w3m_acquisition_report_events where report_id=v_report_id;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Report event DELETE was not blocked'; end if;

  insert into public.w3m_trusted_signer_keys(
    key_id,algorithm,public_address,valid_from,created_by
  ) values (
    v_key_id,'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
    '0x1111111111111111111111111111111111111111',now(),'append-only-test'
  );
  insert into public.w3m_trusted_signer_key_events(
    key_id,event_type,actor_type,reason,event_hash
  ) values (
    v_key_id,'ACTIVATED','SYSTEM','append-only fixture',repeat('f',64)
  );

  v_blocked := false;
  begin
    update public.w3m_trusted_signer_keys set valid_until=now() where key_id=v_key_id;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Trusted signer key UPDATE was not blocked'; end if;

  v_blocked := false;
  begin
    delete from public.w3m_trusted_signer_key_events where key_id=v_key_id;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Trusted signer event DELETE was not blocked'; end if;
end;
$test$;
