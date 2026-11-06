-- W3M Protocol V1 — immutable deal agreement history.
-- Isolated draft only. Applied only to disposable PostgreSQL CI; never production.
begin;

do $install$
declare
  v_table text;
begin
  if to_regprocedure('public.w3m_reject_registry_mutation()') is null then
    raise exception 'W3M append-only guard function must be installed first';
  end if;
  foreach v_table in array array[
    'w3m_deal_terms_versions',
    'w3m_deal_agreement_acceptances'
  ]
  loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Required immutable agreement table is missing: %', v_table
        using errcode = '42P01';
    end if;
    execute format('drop trigger if exists %I on public.%I',
      v_table || '_reject_mutation', v_table);
    execute format(
      'create trigger %I before update or delete or truncate on public.%I
       for each statement execute function public.w3m_reject_registry_mutation()',
      v_table || '_reject_mutation', v_table
    );
  end loop;
end;
$install$;

commit;
