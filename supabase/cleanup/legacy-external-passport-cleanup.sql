-- W3M legacy external Passport cleanup.
-- DANGEROUS: destructive production data operation. Do not run until:
-- 1) the marketplace-only UI is reviewed and deployed;
-- 2) a restorable Supabase backup/export has been verified;
-- 3) current counts below are rechecked with a read-only query.
-- This script is intentionally NOT a Supabase migration and is NOT executed by CI/deploy workflows.
-- It preserves every project_identity referenced by projects.w3m_identity_id.
-- It does not touch projects, deals, code_audits, code_audit_files, code_audit_findings,
-- due-diligence, valuation, support, or transaction data.

begin;

do $$
declare
  n_external integer;
  n_snapshots integer;
  n_identities integer;
  n_aliases integer;
  n_linked integer;
  n_searches integer;
  n_auto_posts integer;
begin
  select count(*) into n_external from public.external_passports;
  select count(*) into n_snapshots from public.external_passport_snapshots;
  select count(*) into n_identities from public.project_identities;
  select count(*) into n_aliases from public.project_identity_aliases;
  select count(*) into n_auto_posts from public.passport_x_auto_posts;
  select count(*) into n_linked
    from public.project_identities i
    where exists (select 1 from public.projects p where p.w3m_identity_id = i.id);
  select count(*) into n_searches from public.saved_searches;

  if n_external <> 41
     or n_snapshots <> 52
     or n_identities <> 36
     or n_aliases <> 100
     or n_linked <> 3
     or n_searches <> 0
     or n_auto_posts <> 25 then
    raise exception
      'Passport cleanup stopped: live counts changed (external %, snapshots %, identities %, aliases %, linked identities %, saved searches %, passport search-history rows %). Re-audit before running.',
      n_external, n_snapshots, n_identities, n_aliases, n_linked, n_searches, n_auto_posts;
  end if;
end $$;

-- The 25 passport_x_auto_posts rows are failed research/search attempts with no published X post IDs or URLs.
-- Remove those search traces too; there are no actual X posts to preserve in this table.
delete from public.passport_x_auto_posts;

-- Snapshots and monitors cascade from external_passports. Changes cascade from passports.
delete from public.external_passports;

-- Remove research-only identity records and their aliases, retaining all identities linked
-- to a marketplace project. Parent references from other identities are set NULL by FK rule.
delete from public.project_identities i
where not exists (
  select 1 from public.projects p where p.w3m_identity_id = i.id
);

do $$
declare
  n_external integer;
  n_snapshots integer;
  n_identities integer;
  n_aliases integer;
  n_auto_posts integer;
begin
  select count(*) into n_external from public.external_passports;
  select count(*) into n_snapshots from public.external_passport_snapshots;
  select count(*) into n_identities from public.project_identities;
  select count(*) into n_aliases from public.project_identity_aliases;
  select count(*) into n_auto_posts from public.passport_x_auto_posts;

  if n_external <> 0 or n_snapshots <> 0 or n_identities <> 3 or n_aliases <> 0 or n_auto_posts <> 0 then
    raise exception
      'Passport cleanup verification failed (external %, snapshots %, identities %, aliases %, passport search-history rows %). Transaction will roll back.',
      n_external, n_snapshots, n_identities, n_aliases, n_auto_posts;
  end if;
end $$;

commit;
