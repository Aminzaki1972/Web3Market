-- Premium trust-badge approval ledger.
-- Additive only: this migration is committed to the isolated feature branch and is NOT applied here.
-- Writes are intended to come only from a trusted Edge Function after auth.getUser(),
-- admin_users membership, and verified AAL2 claims have all been checked.

create table if not exists public.code_audit_badge_approvals (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.code_audits(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  reason text not null check (char_length(btrim(reason)) between 20 and 2000),
  event_id uuid not null default gen_random_uuid(),
  approval_version integer not null default 1 check (approval_version = 1),
  constraint code_audit_badge_approvals_audit_commit_unique unique (audit_id, commit_sha),
  constraint code_audit_badge_approvals_event_unique unique (event_id)
);

comment on table public.code_audit_badge_approvals is
  'Append-only server-side ledger for manual Premium Verified trust-badge approvals. A record is bound to one completed audit and exact Git commit.';

comment on column public.code_audit_badge_approvals.reason is
  'Required human-readable rationale for the Premium Verified decision; never supplied as an authorization signal.';

create index if not exists code_audit_badge_approvals_project_approved_at_idx
  on public.code_audit_badge_approvals (project_id, approved_at desc);

alter table public.code_audit_badge_approvals enable row level security;

-- No browser role can read or mutate the approval ledger directly.
revoke all privileges on table public.code_audit_badge_approvals from public, anon, authenticated, service_role;
grant select, insert on table public.code_audit_badge_approvals to service_role;

create or replace function public.guard_code_audit_badge_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_status text;
  v_score numeric;
  v_commit_sha text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Premium badge approvals are append-only';
  end if;

  select a.project_id, a.status, a.overall_score, lower(a.commit_sha)
    into v_project_id, v_status, v_score, v_commit_sha
  from public.code_audits as a
  where a.id = new.audit_id
  for share;

  if not found then
    raise exception 'Referenced code audit does not exist';
  end if;

  if v_project_id is null or v_project_id <> new.project_id then
    raise exception 'Approval project does not match the audit project';
  end if;

  if v_status <> 'completed' or v_score is null or v_score < 90 or v_score > 100 then
    raise exception 'Premium approval requires a completed audit score from 90 to 100';
  end if;

  if v_commit_sha is null or v_commit_sha !~ '^[0-9a-f]{40}$' or v_commit_sha <> new.commit_sha then
    raise exception 'Approval commit does not match the audited commit';
  end if;

  if not exists (
    select 1
    from public.admin_users as au
    where au.user_id = new.approved_by
  ) then
    raise exception 'Approver is not an authorized Web3Market administrator';
  end if;

  new.commit_sha := lower(new.commit_sha);
  new.reason := btrim(new.reason);
  return new;
end;
$$;

drop trigger if exists code_audit_badge_approvals_guard on public.code_audit_badge_approvals;
create trigger code_audit_badge_approvals_guard
before insert or update or delete on public.code_audit_badge_approvals
for each row execute function public.guard_code_audit_badge_approval();

-- Keep the trigger function private to the database owner; it is invoked only by the trigger.
revoke all on function public.guard_code_audit_badge_approval() from public, anon, authenticated, service_role;
