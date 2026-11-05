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

  if not has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'SELECT')
     or not has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'INSERT')
     or has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'UPDATE')
     or has_table_privilege('service_role', 'public.w3m_acquisition_reports', 'DELETE') then
    raise exception 'Service role report privileges are not least-privilege';
  end if;

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
    insert into public.w3m_acquisition_reports (
      deal_id, project_id, report_version, status, engine_version,
      evidence_hash, report_hash, report_payload, expires_at
    ) values (
      'test-deal-unsigned', 'test-project-001', 1, 'PASS', 'test-engine',
      repeat('a', 64), repeat('b', 64), '{}'::jsonb, now() + interval '1 day'
    );
    raise exception 'Unsigned PASS report was incorrectly accepted';
  exception
    when check_violation then
      null;
  end;
end;
$$;
