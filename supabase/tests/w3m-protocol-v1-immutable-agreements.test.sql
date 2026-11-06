-- Immutable deal terms and signed acceptance protections. Disposable PostgreSQL CI only.
do $test$
declare
  v_table text;
  v_op text;
  v_blocked boolean;
begin
  foreach v_table in array array[
    'w3m_deal_terms_versions',
    'w3m_deal_agreement_acceptances'
  ]
  loop
    if not exists (
      select 1 from pg_trigger t
      join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table
        and t.tgname=v_table || '_reject_mutation'
        and not t.tgisinternal
        and (t.tgtype & 2) = 2
        and (t.tgtype & 8) = 8
        and (t.tgtype & 16) = 16
        and (t.tgtype & 32) = 32
    ) then
      raise exception 'UPDATE/DELETE/TRUNCATE append-only trigger is missing on %',v_table;
    end if;

    if has_table_privilege('service_role','public.' || v_table,'UPDATE')
       or has_table_privilege('service_role','public.' || v_table,'DELETE')
       or has_table_privilege('service_role','public.' || v_table,'TRUNCATE')
       or has_table_privilege('authenticated','public.' || v_table,'INSERT')
       or has_table_privilege('authenticated','public.' || v_table,'UPDATE')
       or has_table_privilege('authenticated','public.' || v_table,'DELETE') then
      raise exception 'Unexpected direct table privileges on %',v_table;
    end if;

    v_blocked := false;
    begin
      execute format('update public.%I set created_at=created_at where false',v_table);
    exception when sqlstate '55000' then v_blocked := true;
    end;
    if not v_blocked then raise exception 'UPDATE was not blocked on %',v_table; end if;

    v_blocked := false;
    begin
      execute format('delete from public.%I where false',v_table);
    exception when sqlstate '55000' then v_blocked := true;
    end;
    if not v_blocked then raise exception 'DELETE was not blocked on %',v_table; end if;

    v_blocked := false;
    begin
      if v_table = 'w3m_deal_terms_versions' then
        execute 'truncate table public.w3m_deal_agreement_acceptances, public.w3m_deal_terms_versions';
    else
        execute format('truncate table public.%I',v_table);
    end if;
    exception when sqlstate '55000' then v_blocked := true;
    end;
    if not v_blocked then raise exception 'TRUNCATE was not blocked on %',v_table; end if;
  end loop;
end;
$test$;
