-- Admin email notifications for listing lifecycle events.
-- RLS is enabled with no client policies; only the service-role Edge Function may access this table.
create table if not exists public.admin_project_email_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null check (event_type in ('created','submitted')),
  event_key text not null unique,
  recipient text not null,
  delivery_status text not null default 'sending' check (delivery_status in ('sending','sent','failed')),
  provider_message_id text,
  error_message text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists admin_project_email_events_project_id_idx
  on public.admin_project_email_events(project_id);
alter table public.admin_project_email_events enable row level security;
