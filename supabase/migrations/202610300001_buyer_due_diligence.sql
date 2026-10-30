-- Buyer-only Due Diligence storage. Additive migration; does not alter existing marketplace/audit tables.
create table if not exists public.buyer_due_diligence_reports (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','available','missing','incomplete','failed')),
  audit_source_status text not null default 'missing' check (audit_source_status in ('available','missing','incomplete')),
  audit_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists buyer_due_diligence_reports_owner_created_idx
  on public.buyer_due_diligence_reports (buyer_id, created_at desc);
create table if not exists public.buyer_due_diligence_private_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.buyer_due_diligence_reports(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '' check (char_length(note) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(report_id, buyer_id)
);
create index if not exists buyer_due_diligence_notes_owner_idx
  on public.buyer_due_diligence_private_notes (buyer_id, report_id);
alter table public.buyer_due_diligence_reports enable row level security;
alter table public.buyer_due_diligence_private_notes enable row level security;
revoke all on public.buyer_due_diligence_reports from anon, authenticated;
revoke all on public.buyer_due_diligence_private_notes from anon, authenticated;
grant select on public.buyer_due_diligence_reports to authenticated;
grant select, insert, update, delete on public.buyer_due_diligence_private_notes to authenticated;
drop policy if exists buyer_dd_reports_select_own on public.buyer_due_diligence_reports;
create policy buyer_dd_reports_select_own on public.buyer_due_diligence_reports
for select to authenticated using (buyer_id = (select auth.uid()));
drop policy if exists buyer_dd_notes_select_own on public.buyer_due_diligence_private_notes;
create policy buyer_dd_notes_select_own on public.buyer_due_diligence_private_notes
for select to authenticated using (
  buyer_id = (select auth.uid()) and exists (
    select 1 from public.buyer_due_diligence_reports r
    where r.id = report_id and r.buyer_id = (select auth.uid())
  )
);
drop policy if exists buyer_dd_notes_insert_own on public.buyer_due_diligence_private_notes;
create policy buyer_dd_notes_insert_own on public.buyer_due_diligence_private_notes
for insert to authenticated with check (
  buyer_id = (select auth.uid()) and exists (
    select 1 from public.buyer_due_diligence_reports r
    where r.id = report_id and r.buyer_id = (select auth.uid())
  )
);
drop policy if exists buyer_dd_notes_update_own on public.buyer_due_diligence_private_notes;
create policy buyer_dd_notes_update_own on public.buyer_due_diligence_private_notes
for update to authenticated using (
  buyer_id = (select auth.uid()) and exists (
    select 1 from public.buyer_due_diligence_reports r
    where r.id = report_id and r.buyer_id = (select auth.uid())
  )
) with check (
  buyer_id = (select auth.uid()) and exists (
    select 1 from public.buyer_due_diligence_reports r
    where r.id = report_id and r.buyer_id = (select auth.uid())
  )
);
drop policy if exists buyer_dd_notes_delete_own on public.buyer_due_diligence_private_notes;
create policy buyer_dd_notes_delete_own on public.buyer_due_diligence_private_notes
for delete to authenticated using (
  buyer_id = (select auth.uid()) and exists (
    select 1 from public.buyer_due_diligence_reports r
    where r.id = report_id and r.buyer_id = (select auth.uid())
  )
);
