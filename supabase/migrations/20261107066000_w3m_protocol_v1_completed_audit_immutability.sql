-- W3M Protocol V1 — completed Code Audit evidence is immutable.
-- Prevents a race between manifest recomputation and Safe settlement.
-- Review-only isolated migration; never apply to production without approval.
begin;

create or replace function public.w3m_guard_completed_code_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $guard$
declare
  v_audit_id uuid;
  v_status text;
begin
  if tg_table_name = 'code_audits' then
    if old.status = 'completed' then
      raise exception 'Completed Code Audit records are immutable'
        using errcode = '55000';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    v_audit_id := old.audit_id;
    select a.status into v_status
      from public.code_audits a
     where a.id = v_audit_id
     for update;
    if v_status = 'completed' then
      raise exception 'Files and findings of a completed Code Audit are immutable'
        using errcode = '55000';
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    v_audit_id := new.audit_id;
    select a.status into v_status
      from public.code_audits a
     where a.id = v_audit_id
     for update;
    if v_status = 'completed' then
      raise exception 'Files and findings of a completed Code Audit are immutable'
        using errcode = '55000';
    end if;
    return new;
  end if;

  return old;
end;
$guard$;

revoke all on function public.w3m_guard_completed_code_audit_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists w3m_code_audits_completed_immutable on public.code_audits;
create trigger w3m_code_audits_completed_immutable
before update or delete on public.code_audits
for each row execute function public.w3m_guard_completed_code_audit_mutation();

drop trigger if exists w3m_code_audit_files_completed_immutable on public.code_audit_files;
create trigger w3m_code_audit_files_completed_immutable
before insert or update or delete on public.code_audit_files
for each row execute function public.w3m_guard_completed_code_audit_mutation();

drop trigger if exists w3m_code_audit_findings_completed_immutable on public.code_audit_findings;
create trigger w3m_code_audit_findings_completed_immutable
before insert or update or delete on public.code_audit_findings
for each row execute function public.w3m_guard_completed_code_audit_mutation();

comment on function public.w3m_guard_completed_code_audit_mutation() is
  'Serializes audit completion against file/finding writes and freezes completed audit source rows so signed Audit Manifest V1 digests remain stable.';

commit;
