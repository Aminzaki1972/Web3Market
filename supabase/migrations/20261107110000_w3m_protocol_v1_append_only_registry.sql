-- W3M Protocol V1 — database-enforced append-only protection.
-- Isolated draft only. Applied only by disposable PostgreSQL CI; never production.
begin;

create or replace function public.w3m_reject_registry_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $guard$
begin
  raise exception 'W3M registry rows are append-only; % is forbidden on %.%',
    tg_op, tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$guard$;

revoke all on function public.w3m_reject_registry_mutation()
  from public, anon, authenticated, service_role;

do $install$
declare
  v_table text;
begin
  foreach v_table in array array[
    'w3m_acquisition_reports',
    'w3m_acquisition_evidence',
    'w3m_acquisition_report_events',
    'w3m_trusted_signer_keys',
    'w3m_trusted_signer_key_events'
  ]
  loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Required W3M append-only registry table is missing: %', v_table
        using errcode = '42P01';
    end if;
    execute format(
      'drop trigger if exists %I on public.%I',
      v_table || '_reject_mutation', v_table
    );
    execute format(
      'create trigger %I before update or delete or truncate on public.%I
       for each statement execute function public.w3m_reject_registry_mutation()',
      v_table || '_reject_mutation', v_table
    );
  end loop;
end;
$install$;

comment on function public.w3m_reject_registry_mutation() is
  'Rejects UPDATE, DELETE, and TRUNCATE on W3M report, evidence, event, and signer registries.';

commit;
