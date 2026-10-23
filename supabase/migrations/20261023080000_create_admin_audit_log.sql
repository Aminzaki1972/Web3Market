-- Central admin audit log. Client roles have no direct access; the authenticated admin-review Edge Function reads/writes with service role after checking admin_users.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  category text not null,
  action text not null,
  target_type text,
  target_id text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  outcome text not null default 'success',
  source text not null default 'admin',
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
create index if not exists admin_audit_log_occurred_at_idx on public.admin_audit_log (occurred_at desc);
create index if not exists admin_audit_log_category_idx on public.admin_audit_log (category, occurred_at desc);
