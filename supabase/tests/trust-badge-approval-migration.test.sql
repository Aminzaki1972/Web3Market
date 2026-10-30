-- Disposable PostgreSQL integration test for the Premium approval ledger migration.
-- Runs only in GitHub Actions against an ephemeral PostgreSQL service, never production.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key);
create table public.projects (id uuid primary key, status text, github_url text);
create table public.admin_users (user_id uuid primary key);
create table public.code_audits (
  id uuid primary key,
  project_id uuid references public.projects(id),
  status text,
  overall_score numeric,
  commit_sha text,
  repo_owner text,
  repo_name text,
  branch text
);

\i supabase/migrations/20261031000100_code_audit_badge_approvals.sql

insert into public.projects(id,status,github_url)
values ('10000000-0000-4000-8000-000000000001','active','https://github.com/acme/project');
insert into auth.users(id) values ('20000000-0000-4000-8000-000000000001');
insert into public.admin_users(user_id) values ('20000000-0000-4000-8000-000000000001');
insert into public.code_audits(id,project_id,status,overall_score,commit_sha,repo_owner,repo_name,branch)
values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','completed',95,repeat('a',40),'acme','project','main'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','completed',89,repeat('b',40),'acme','project','main');

-- The intended server role can create a valid approval.
set role service_role;
insert into public.code_audit_badge_approvals(audit_id,project_id,commit_sha,approved_by,reason)
values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',repeat('a',40),'20000000-0000-4000-8000-000000000001','Manual review confirmed the audit evidence and project controls.');
reset role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.code_audit_badge_approvals'::regclass) then
    raise exception 'RLS is not enabled';
  end if;
  if has_table_privilege('anon','public.code_audit_badge_approvals','SELECT')
     or has_table_privilege('authenticated','public.code_audit_badge_approvals','SELECT') then
    raise exception 'Browser roles unexpectedly have SELECT';
  end if;
  if not has_table_privilege('service_role','public.code_audit_badge_approvals','SELECT')
     or not has_table_privilege('service_role','public.code_audit_badge_approvals','INSERT') then
    raise exception 'service_role is missing intended privileges';
  end if;
  if has_table_privilege('service_role','public.code_audit_badge_approvals','UPDATE')
     or has_table_privilege('service_role','public.code_audit_badge_approvals','DELETE') then
    raise exception 'service_role unexpectedly has UPDATE or DELETE';
  end if;
  if (select count(*) from public.code_audit_badge_approvals) <> 1 then
    raise exception 'Valid approval was not recorded';
  end if;
end $$;

-- Trigger must reject approvals for scores below 90, even when inserted by service_role.
do $$
begin
  begin
    insert into public.code_audit_badge_approvals(audit_id,project_id,commit_sha,approved_by,reason)
    values ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',repeat('b',40),'20000000-0000-4000-8000-000000000001','This should fail because the score is below ninety.');
    raise exception 'Invalid score approval unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Invalid score approval unexpectedly succeeded' then raise; end if;
  end;
end $$;

-- Append-only trigger must reject mutation and deletion.
do $$
begin
  begin
    update public.code_audit_badge_approvals set reason='Attempted mutation of an approval record.' where audit_id='30000000-0000-4000-8000-000000000001';
    raise exception 'Approval update unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Approval update unexpectedly succeeded' then raise; end if;
  end;
  begin
    delete from public.code_audit_badge_approvals where audit_id='30000000-0000-4000-8000-000000000001';
    raise exception 'Approval delete unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Approval delete unexpectedly succeeded' then raise; end if;
  end;
end $$;

select 'Premium approval migration integration tests passed' as result;
