-- Disposable PostgreSQL fixture for the atomic deal payment migration.
-- This file is used only by isolated CI databases; never run against production.
-- Roles used by Supabase grants in this isolated PostgreSQL database.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
end;
$roles$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

create table if not exists public.profiles (
  id uuid primary key,
  wallet_address text,
  wallet_verified boolean not null default false
);

alter table public.deals
  add column if not exists expected_amount numeric,
  add column if not exists payment_tx_hash text,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists funded_at timestamptz,
  add column if not exists platform_fee_percent numeric not null default 7.5,
  add column if not exists platform_fee_amount numeric,
  add column if not exists seller_net_amount numeric,
  add column if not exists platform_fee numeric not null default 0,
  add column if not exists fee_locked_at timestamptz,
  add column if not exists token_contract text,
  add column if not exists token_symbol text,
  add column if not exists chain_id bigint,
  add column if not exists safe_address text;

create table if not exists public.blockchain_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid,
  chain_id bigint not null,
  tx_hash text,
  transaction_type text not null,
  token_symbol text,
  amount numeric,
  to_address text,
  from_address text,
  status text not null,
  block_number bigint,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  deal_id uuid references public.deals(id),
  constraint blockchain_transactions_fixture_status_check
    check (status in ('pending','submitted','confirming','confirmed','failed','cancelled','refunded'))
);

create table if not exists public.deal_audit_logs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  old_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
