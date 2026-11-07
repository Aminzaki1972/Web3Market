-- Runs only against a disposable PostgreSQL service in GitHub Actions.
-- The migration is applied before this file. No Supabase project is contacted.

do $$
declare
  v_report_id uuid;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'w3m_acquisition_reports' and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on w3m_acquisition_reports';
  end if;

  if not has_table_privilege('anon', 'public.w3m_acquisition_reports', 'SELECT')
     and not has_table_privilege('authenticated', 'public.w3m_acquisition_reports', 'SELECT')
     and not has_table_privilege('anon', 'public.w3m_acquisition_reports', 'INSERT')
     and not has_table_privilege('authenticated', 'public.w3m_acquisition_reports', 'INSERT') then
    null;
  else
    raise exception 'Browser roles unexpectedly have report table privileges';
  end if;

  if not has_function_privilege('service_role',
      'public.w3m_insert_acquisition_registry_batch(jsonb,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.w3m_insert_acquisition_registry_batch(jsonb,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.w3m_insert_acquisition_registry_batch(jsonb,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'Atomic registry RPC execute privileges are not service-role-only';
  end if;

  if not has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'SELECT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'INSERT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'UPDATE')
     or has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'DELETE')
     or not has_table_privilege('service_role', 'public.w3m_acquisition_evidence', 'SELECT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_evidence', 'INSERT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_evidence', 'UPDATE')
     or has_table_privilege('service_role', 'public.w3m_acquisition_evidence', 'DELETE')
     or not has_table_privilege('service_role', 'public.w3m_acquisition_report_events', 'SELECT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_report_events', 'INSERT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_report_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.w3m_acquisition_report_events', 'DELETE') then
    raise exception 'Service role must have read-only table access and write only through the atomic RPC';
  end if;

  -- PASS report inserts now require an active signer in the registry.
  -- Seed one deterministic public test key for the legacy schema and RPC cases.
  perform public.w3m_register_trusted_signer_key(
    jsonb_build_object(
      'key_id', 'test-key-v1',
      'algorithm', 'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
      'public_address', '0x1111111111111111111111111111111111111111',
      'valid_from', (now() - interval '1 hour')::text,
      'valid_until', (now() + interval '1 day')::text,
      'created_by', 'ci-test'
    ),
    jsonb_build_object(
      'key_id', 'test-key-v1',
      'event_type', 'ACTIVATED',
      'actor_type', 'SYSTEM',
      'actor_ref', 'ci-test',
      'reason', 'active signer fixture for schema regression tests',
      'event_hash', repeat('f', 64)
    )
  );

  insert into public.w3m_acquisition_reports (
    deal_id, project_id, report_version, status, engine_version,
    evidence_hash, report_hash, report_payload, signer_key_id,
    report_signature, expires_at
  ) values (
    'test-deal-001', 'test-project-001', 1, 'PASS', 'test-engine',
    repeat('a', 64), repeat('b', 64), '{}'::jsonb, 'test-key-v1',
    '0x' || repeat('c', 130), now() + interval '1 day'
  ) returning id into v_report_id;

  insert into public.w3m_acquisition_evidence (
    report_id, evidence_type, evidence_hash, result, details
  ) values (
    v_report_id, 'PROJECT_IDENTITY', repeat('d', 64), 'PASS', '{}'::jsonb
  );

  insert into public.w3m_acquisition_report_events (
    report_id, deal_id, event_type, actor_type, event_hash
  ) values (
    v_report_id, 'test-deal-001', 'REPORT_CREATED', 'SYSTEM', repeat('e', 64)
  );

  begin
    execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms immediate';
    insert into public.w3m_acquisition_reports (
      deal_id, project_id, report_version, status, engine_version,
      evidence_hash, report_hash, report_payload, expires_at
    ) values (
      '71000000-0000-4000-8000-000000000001', 'test-project-001', 1, 'PASS', 'test-engine',
      repeat('a', 64), repeat('b', 64), '{}'::jsonb, now() + interval '1 day'
    );
    raise exception 'Orphaned W3M PASS report was incorrectly accepted';
  exception
    when check_violation then
      null;
  end;
  execute 'set constraints w3m_acquisition_report_requires_signed_deal_terms deferred';
end;
$$;

-- The atomic RPC inserts one report, its evidence, and its events as a batch.
do $$
declare
  v_report_id uuid := gen_random_uuid();
  v_rollback_id uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
begin
  v_payload := jsonb_build_object(
    'reportId', v_report_id::text,
    'reportVersion', 1,
    'dealId', 'atomic-test-deal',
    'projectId', 'atomic-test-project',
    'status', 'PASS',
    'evidenceHash', repeat('a', 64)
  );

  v_result := public.w3m_insert_acquisition_registry_batch(
    jsonb_build_object(
      'id', v_report_id,
      'deal_id', 'atomic-test-deal',
      'project_id', 'atomic-test-project',
      'report_version', 1,
      'supersedes_report_id', null,
      'buyer_id', 'atomic-buyer',
      'seller_id', 'atomic-seller',
      'status', 'PASS',
      'engine_version', 'test-engine',
      'evidence_hash', repeat('a', 64),
      'report_hash', repeat('b', 64),
      'report_payload', v_payload,
      'signer_key_id', 'test-key-v1',
      'report_signature', '0x' || repeat('c', 130),
      'issued_at', now(),
      'expires_at', now() + interval '1 day'
    ),
    jsonb_build_array(jsonb_build_object(
      'id', v_evidence_id,
      'report_id', v_report_id,
      'evidence_type', 'PROJECT_IDENTITY',
      'source_table', null,
      'source_record_id', 'project-1',
      'source_version', 'v1',
      'evidence_hash', repeat('d', 64),
      'result', 'PASS',
      'mandatory', true,
      'observed_at', now(),
      'valid_until', now() + interval '1 day',
      'details', '{}'::jsonb
    )),
    jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid(),
        'report_id', v_report_id,
        'deal_id', 'atomic-test-deal',
        'event_type', 'REPORT_CREATED',
        'actor_type', 'SYSTEM',
        'actor_ref', null,
        'event_hash', repeat('e', 64),
        'metadata', jsonb_build_object(
          'status', 'PASS',
          'reportHash', repeat('b', 64),
          'reportVersion', 1
        ),
        'created_at', now()
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'report_id', v_report_id,
        'deal_id', 'atomic-test-deal',
        'event_type', 'EVIDENCE_ATTACHED',
        'actor_type', 'SYSTEM',
        'actor_ref', null,
        'event_hash', repeat('f', 64),
        'metadata', jsonb_build_object(
          'evidenceRowId', v_evidence_id::text,
          'evidenceType', 'PROJECT_IDENTITY',
          'evidenceHash', repeat('d', 64)
        ),
        'created_at', now()
      )
    )
  );

  if v_result->>'atomic' <> 'true'
     or (v_result->>'evidence_rows')::integer <> 1
     or (v_result->>'event_rows')::integer <> 2 then
    raise exception 'Atomic registry RPC returned incorrect row counts';
  end if;

  if (select count(*) from public.w3m_acquisition_reports where id = v_report_id) <> 1
     or (select count(*) from public.w3m_acquisition_evidence where report_id = v_report_id) <> 1
     or (select count(*) from public.w3m_acquisition_report_events where report_id = v_report_id) <> 2 then
    raise exception 'Atomic registry RPC did not persist the complete batch';
  end if;

  v_payload := jsonb_build_object(
    'reportId', v_rollback_id::text,
    'reportVersion', 1,
    'dealId', 'atomic-rollback-deal',
    'projectId', 'atomic-test-project',
    'status', 'INCOMPLETE',
    'evidenceHash', repeat('a', 64)
  );

  begin
    perform public.w3m_insert_acquisition_registry_batch(
      jsonb_build_object(
        'id', v_rollback_id,
        'deal_id', 'atomic-rollback-deal',
        'project_id', 'atomic-test-project',
        'report_version', 1,
        'supersedes_report_id', null,
        'buyer_id', 'atomic-buyer',
        'seller_id', 'atomic-seller',
        'status', 'INCOMPLETE',
        'engine_version', 'test-engine',
        'evidence_hash', repeat('a', 64),
        'report_hash', repeat('b', 64),
        'report_payload', v_payload,
        'signer_key_id', 'test-key-v1',
        'report_signature', '0x' || repeat('c', 130),
        'issued_at', now(),
        'expires_at', now() + interval '1 day'
      ),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'report_id', v_rollback_id,
        'deal_id', 'atomic-rollback-deal',
        'event_type', 'REPORT_CREATED',
        'actor_type', 'SYSTEM',
        'actor_ref', null,
        'event_hash', 'invalid-hash',
        'metadata', '{}'::jsonb,
        'created_at', now()
      ))
    );
    raise exception 'Invalid event unexpectedly passed atomic batch insert';
  exception
    when check_violation then
      null;
  end;

  if exists (select 1 from public.w3m_acquisition_reports where id = v_rollback_id) then
    raise exception 'Failed batch left a partial report row behind';
  end if;
end;
$$;


-- Reject an event batch whose EVIDENCE_ATTACHED metadata points at another evidence row.
do $$
declare
  v_report_id uuid := gen_random_uuid();
  v_evidence_id uuid := gen_random_uuid();
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'reportId', v_report_id::text,
    'reportVersion', 1,
    'dealId', 'atomic-evidence-link-deal',
    'projectId', 'atomic-test-project',
    'status', 'INCOMPLETE',
    'evidenceHash', repeat('a', 64)
  );

  begin
    perform public.w3m_insert_acquisition_registry_batch(
      jsonb_build_object(
        'id', v_report_id,
        'deal_id', 'atomic-evidence-link-deal',
        'project_id', 'atomic-test-project',
        'report_version', 1,
        'supersedes_report_id', null,
        'buyer_id', 'atomic-buyer',
        'seller_id', 'atomic-seller',
        'status', 'INCOMPLETE',
        'engine_version', 'test-engine',
        'evidence_hash', repeat('a', 64),
        'report_hash', repeat('b', 64),
        'report_payload', v_payload,
        'signer_key_id', null,
        'report_signature', null,
        'issued_at', now(),
        'expires_at', now() + interval '1 day'
      ),
      jsonb_build_array(jsonb_build_object(
        'id', v_evidence_id,
        'report_id', v_report_id,
        'evidence_type', 'PROJECT_IDENTITY',
        'source_table', null,
        'source_record_id', 'project-1',
        'source_version', 'v1',
        'evidence_hash', repeat('d', 64),
        'result', 'PASS',
        'mandatory', true,
        'observed_at', now(),
        'valid_until', now() + interval '1 day',
        'details', '{}'::jsonb
      )),
      jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid(),
          'report_id', v_report_id,
          'deal_id', 'atomic-evidence-link-deal',
          'event_type', 'REPORT_CREATED',
          'actor_type', 'SYSTEM',
          'actor_ref', null,
          'event_hash', repeat('e', 64),
          'metadata', jsonb_build_object(
            'status', 'INCOMPLETE',
            'reportHash', repeat('b', 64),
            'reportVersion', 1
          ),
          'created_at', now()
        ),
        jsonb_build_object(
          'id', gen_random_uuid(),
          'report_id', v_report_id,
          'deal_id', 'atomic-evidence-link-deal',
          'event_type', 'EVIDENCE_ATTACHED',
          'actor_type', 'SYSTEM',
          'actor_ref', null,
          'event_hash', repeat('f', 64),
          'metadata', jsonb_build_object(
            'evidenceRowId', gen_random_uuid()::text,
            'evidenceType', 'PROJECT_IDENTITY',
            'evidenceHash', repeat('d', 64)
          ),
          'created_at', now()
        )
      )
    );
    raise exception 'Mismatched evidence event reference unexpectedly passed';
  exception
    when check_violation then
      null;
  end;

  if exists (select 1 from public.w3m_acquisition_reports where id = v_report_id)
     or exists (select 1 from public.w3m_acquisition_evidence where report_id = v_report_id)
     or exists (select 1 from public.w3m_acquisition_report_events where report_id = v_report_id) then
    raise exception 'Mismatched evidence event batch left partial registry rows';
  end if;
end;
$$;

-- Reject a count-balanced batch whose event types are composed incorrectly.
do $$
declare
  v_report_id uuid := gen_random_uuid();
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'reportId', v_report_id::text,
    'reportVersion', 1,
    'dealId', 'atomic-event-type-deal',
    'projectId', 'atomic-test-project',
    'status', 'INCOMPLETE',
    'evidenceHash', repeat('a', 64)
  );

  begin
    perform public.w3m_insert_acquisition_registry_batch(
      jsonb_build_object(
        'id', v_report_id,
        'deal_id', 'atomic-event-type-deal',
        'project_id', 'atomic-test-project',
        'report_version', 1,
        'supersedes_report_id', null,
        'buyer_id', 'atomic-buyer',
        'seller_id', 'atomic-seller',
        'status', 'INCOMPLETE',
        'engine_version', 'test-engine',
        'evidence_hash', repeat('a', 64),
        'report_hash', repeat('b', 64),
        'report_payload', v_payload,
        'signer_key_id', null,
        'report_signature', null,
        'issued_at', now(),
        'expires_at', now() + interval '1 day'
      ),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'report_id', v_report_id,
        'deal_id', 'atomic-event-type-deal',
        'event_type', 'EVIDENCE_ATTACHED',
        'actor_type', 'SYSTEM',
        'actor_ref', null,
        'event_hash', repeat('e', 64),
        'metadata', '{}'::jsonb,
        'created_at', now()
      ))
    );
    raise exception 'Incorrect event composition unexpectedly passed';
  exception
    when check_violation then
      null;
  end;

  if exists (select 1 from public.w3m_acquisition_reports where id = v_report_id) then
    raise exception 'Incorrect event composition left a partial report row';
  end if;
end;
$$;
