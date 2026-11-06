-- Disposable PostgreSQL CI only: persisted acquisition and agreement are pinned and revalidated at finalization.
do $test$
declare
  v_finalizer text;
  v_pin text;
  v_evidence_lock text;
  v_attempt_trigger boolean;
  v_evidence_trigger boolean;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='w3m_safe_execution_attempts'
       and column_name='pinned_report_hash'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='w3m_safe_execution_attempts'
       and column_name='pinned_terms_version_id'
  ) then
    raise exception 'W3M execution attempt is missing immutable report/terms pins';
  end if;

  select exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='w3m_safe_execution_attempts'
      and t.tgname='w3m_safe_attempt_pin_acquisition_terms'
      and not t.tgisinternal and (t.tgtype & 2)=2 and (t.tgtype & 4)=4
  ) into v_attempt_trigger;
  if not v_attempt_trigger then
    raise exception 'W3M attempt insert does not pin report and accepted terms';
  end if;

  select exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='w3m_acquisition_evidence'
      and t.tgname='w3m_acquisition_evidence_serialize_append'
      and not t.tgisinternal and (t.tgtype & 2)=2 and (t.tgtype & 4)=4
  ) into v_evidence_trigger;
  if not v_evidence_trigger then
    raise exception 'W3M evidence append does not share the per-deal serialization lock';
  end if;

  select pg_get_functiondef('public.w3m_pin_acquisition_and_terms_on_attempt()'::regprocedure)
    into v_pin;
  if position('PG_ADVISORY_XACT_LOCK' in upper(v_pin))=0
     or position('REPORT_HASH' in upper(v_pin))=0
     or position('EVIDENCE_HASH' in upper(v_pin))=0
     or position('SIGNER_KEY_ID' in upper(v_pin))=0
     or position('W3M_DEAL_AGREEMENT_ACCEPTANCES' in upper(v_pin))=0
     or position('ACTIVATED' in upper(v_pin))=0 then
    raise exception 'W3M attempt pinning does not bind report, signer, and both party acceptances';
  end if;

  select pg_get_functiondef('public.w3m_lock_evidence_append()'::regprocedure)
    into v_evidence_lock;
  if position('PG_ADVISORY_XACT_LOCK' in upper(v_evidence_lock))=0
     or position('NEW.REPORT_ID' in upper(v_evidence_lock))=0 then
    raise exception 'W3M evidence append lock is not keyed through its report deal';
  end if;

  if position('W3M_SAFE_EXECUTION_ATTEMPTS' in upper(v_evidence_lock))=0
     or position('EVIDENCE MANIFEST IS FROZEN' in upper(v_evidence_lock))=0 then
    raise exception 'W3M evidence manifest can still be appended after an attempt pins it';
  end if;

  select pg_get_functiondef(
    'public.w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb)'::regprocedure
  ) into v_finalizer;
  if position('V_ATTEMPT.PINNED_REPORT_HASH' in upper(v_finalizer))=0
     or position('V_ATTEMPT.PINNED_EVIDENCE_HASH' in upper(v_finalizer))=0
     or position('V_ATTEMPT.PINNED_SIGNER_KEY_ID' in upper(v_finalizer))=0
     or position('V_ATTEMPT.PINNED_TERMS_VERSION_ID' in upper(v_finalizer))=0
     or position('W3M_ACQUISITION_EVIDENCE' in upper(v_finalizer))=0
     or position('W3M_TRUSTED_SIGNER_KEY_EVENTS' in upper(v_finalizer))=0
     or position('W3M_DEAL_AGREEMENT_ACCEPTANCES' in upper(v_finalizer))=0
     or position('W3M_CURRENT_DEAL_TERMS_JSON' in upper(v_finalizer))=0 then
    raise exception 'W3M finalizer is missing persisted report/evidence/signer/agreement revalidation';
  end if;
  if position('V_ATTEMPT.PINNED_REPORT_HASH' in upper(v_finalizer)) >
     position('UPDATE PUBLIC.DEAL_MULTISIG_TRANSACTIONS' in upper(v_finalizer)) then
    raise exception 'W3M acquisition revalidation must precede all settlement state changes';
  end if;
end;
$test$;
