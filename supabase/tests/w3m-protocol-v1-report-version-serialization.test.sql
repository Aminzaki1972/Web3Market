-- Disposable PostgreSQL CI only: report-version insert/finalization lock share one key.
begin;
do $test$
declare
  v_trigger boolean;
  v_finalizer text;
begin
  select exists(
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='w3m_acquisition_reports'
      and t.tgname='w3m_acquisition_reports_serialize_version_append'
      and not t.tgisinternal
      and (t.tgtype & 2)=2
      and (t.tgtype & 4)=4
  ) into v_trigger;
  if not v_trigger then
    raise exception 'W3M report INSERT serialization trigger is missing';
  end if;

  declare
    v_writer text;
  begin
    select pg_get_functiondef(
      'public.w3m_lock_report_version_append()'::regprocedure
    ) into v_writer;
    if position('PG_ADVISORY_XACT_LOCK' in upper(v_writer))=0
       or position('NEW.DEAL_ID' in upper(v_writer))=0 then
      raise exception 'W3M report writer does not lock by NEW.deal_id';
    end if;
  end;

  select pg_get_functiondef(
    'public.w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb)'::regprocedure
  ) into v_finalizer;
  if position('PG_ADVISORY_XACT_LOCK' in upper(v_finalizer))=0
  then
    raise exception 'W3M finalizer does not acquire the report append serialization lock';
  end if;

  if position('V_ATTEMPT.DEAL_ID::TEXT' in upper(v_finalizer))=0 then
    raise exception 'W3M finalizer advisory lock is not keyed by the attempt deal ID';
  end if;
  if position('PG_ADVISORY_XACT_LOCK' in upper(v_finalizer)) >
     position('SELECT * INTO V_DEAL' in upper(v_finalizer)) then
    raise exception 'W3M finalizer must acquire the shared lock before reading the deal';
  end if;
end;
$test$;

-- Behavioral checks: enforce a gap-free version chain and exact supersession.
do $behavior$
declare
  v_deal text := 'w3m-report-version-test-20261106';
  v_first uuid := '10000000-0000-4000-8000-000000000001';
  v_second uuid := '10000000-0000-4000-8000-000000000002';
begin
  insert into public.w3m_acquisition_reports (
    id, deal_id, project_id, report_version, status, engine_version,
    evidence_hash, report_hash, report_payload, issued_at, expires_at
  ) values (
    v_first, v_deal, 'project-version-test', 1, 'BLOCKED', 'test-engine',
    repeat('a',64), repeat('b',64),
    jsonb_build_object(
      'reportId', v_first::text, 'dealId', v_deal,
      'projectId', 'project-version-test', 'reportVersion', 1,
      'status', 'BLOCKED', 'evidenceHash', repeat('a',64)
    ),
    now(), now() + interval '1 day'
  );

  insert into public.w3m_acquisition_reports (
    id, deal_id, project_id, report_version, supersedes_report_id,
    status, engine_version, evidence_hash, report_hash, report_payload,
    issued_at, expires_at
  ) values (
    v_second, v_deal, 'project-version-test', 2, v_first,
    'BLOCKED', 'test-engine', repeat('c',64), repeat('d',64),
    jsonb_build_object(
      'reportId', v_second::text, 'dealId', v_deal,
      'projectId', 'project-version-test', 'reportVersion', 2,
      'status', 'BLOCKED', 'evidenceHash', repeat('c',64)
    ),
    now(), now() + interval '1 day'
  );

  begin
    insert into public.w3m_acquisition_reports (
      id, deal_id, project_id, report_version, supersedes_report_id,
      status, engine_version, evidence_hash, report_hash, report_payload,
      issued_at, expires_at
    ) values (
      '10000000-0000-4000-8000-000000000003', v_deal, 'project-version-test', 4, v_second,
      'BLOCKED', 'test-engine', repeat('e',64), repeat('f',64),
      jsonb_build_object(
        'reportId', '10000000-0000-4000-8000-000000000003', 'dealId', v_deal,
        'projectId', 'project-version-test', 'reportVersion', 4,
        'status', 'BLOCKED', 'evidenceHash', repeat('e',64)
      ),
      now(), now() + interval '1 day'
    );
    raise exception 'W3M accepted a report-version gap';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.w3m_acquisition_reports (
      id, deal_id, project_id, report_version, supersedes_report_id,
      status, engine_version, evidence_hash, report_hash, report_payload,
      issued_at, expires_at
    ) values (
      '10000000-0000-4000-8000-000000000004', v_deal, 'project-version-test', 3, v_first,
      'BLOCKED', 'test-engine', repeat('1',64), repeat('2',64),
      jsonb_build_object(
        'reportId', '10000000-0000-4000-8000-000000000004', 'dealId', v_deal,
        'projectId', 'project-version-test', 'reportVersion', 3,
        'status', 'BLOCKED', 'evidenceHash', repeat('1',64)
      ),
      now(), now() + interval '1 day'
    );
    raise exception 'W3M accepted a non-latest superseded report';
  exception when check_violation then
    null;
  end;
end;
$behavior$;

rollback;
