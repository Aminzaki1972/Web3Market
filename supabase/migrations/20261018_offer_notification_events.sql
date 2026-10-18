-- Offer notification idempotency ledger. Apply only after reviewing this branch.
create table if not exists public.marketplace_notification_events (
  event_key text primary key,
  deal_id uuid not null references public.deals(id) on delete cascade,
  event_type text not null check (event_type in ('offer_created','offer_accepted')),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text,
  delivery_status text not null default 'sending' check (delivery_status in ('sending','sent','failed','skipped')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketplace_notification_events enable row level security;
revoke all on public.marketplace_notification_events from anon, authenticated;
grant all on public.marketplace_notification_events to service_role;

create index if not exists marketplace_notification_events_deal_idx
  on public.marketplace_notification_events (deal_id, event_type);
