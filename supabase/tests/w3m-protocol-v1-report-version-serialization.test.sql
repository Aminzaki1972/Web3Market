-- Disposable PostgreSQL CI only: report-version insert/finalization lock share one key.
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

  select pg_get_functiondef(
    'public.w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb)'::regprocedure
  ) into v_finalizer;
  if position('PG_ADVISORY_XACT_LOCK' in upper(v_finalizer))=0
     or position('HASH TEXTE XTENDED' in upper(v_finalizer))>0 then
    raise exception 'W3M finalizer does not acquire the report append serialization lock';
  end if;

  if position('V_ATTEMPT.DEAL_ID::TEXT' in upper(v_finalizer))=0 then
    raise exception 'W3M finalizer advisory lock is not keyed by the attempt deal ID';
  end if;
end;
$test$;
