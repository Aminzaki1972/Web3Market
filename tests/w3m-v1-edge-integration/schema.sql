-- Disposable local Supabase fixture only. Never run against hosted projects.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists w3m_private;

create table public.profiles (
  id uuid primary key,
  wallet_address text,
  wallet_verified boolean not null default false
);

create table public.projects (
  id uuid primary key,
  owner_id uuid not null
);

create table public.deals (
  id uuid primary key,
  project_id uuid not null,
  buyer_id uuid not null,
  seller_id uuid not null,
  status text not null default 'pending',
  dispute_status text not null default 'none',
  release_tx_hash text,
  chain_id bigint,
  safe_address text,
  safe_deployment_tx_hash text
);

create table public.deal_release_policies (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  seller_wallet text not null,
  platform_wallet text not null,
  safe_address text not null,
  chain_id bigint not null
);

create table public.deal_disputes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  opened_by uuid not null,
  reason text not null,
  status text not null default 'open'
);

create table public.admin_users (
  user_id uuid primary key
);

create table public.code_audits (
  id uuid primary key,
  project_id uuid not null,
  status text not null,
  repo_owner text not null,
  repo_name text not null,
  commit_sha text not null,
  engine_version text,
  audit_type text,
  files_scanned integer not null,
  lines_scanned integer,
  overall_score numeric,
  security_score numeric,
  architecture_score numeric,
  code_quality_score numeric,
  dependency_score numeric,
  testing_score numeric,
  documentation_score numeric,
  web3_score numeric,
  scalability_score numeric,
  ai_fit_score numeric,
  risk_level text,
  summary text
);

create table public.code_audit_files (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  path text not null,
  sha text,
  language text,
  size_bytes bigint,
  line_count integer,
  selected_tier integer,
  scanned boolean not null default false
);

create table public.code_audit_findings (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null,
  severity text,
  category text,
  title text,
  status text,
  file_path text,
  line_start integer,
  line_end integer,
  evidence text,
  description text,
  recommendation text,
  confidence numeric
);

create table public.deal_assets (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  asset_name text not null,
  status text not null default 'pending'
    check (status in ('pending','delivered','accepted','rejected')),
  delivery_url text,
  evidence text,
  delivered_by uuid,
  delivered_at timestamptz,
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, asset_name)
);

-- The asset migration's Safe claim guard requires this table to exist.
-- The complete Safe claim lifecycle is separately covered by its own migration tests.
create table w3m_private.w3m_safe_release_claims (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  safe_tx_hash text not null,
  safe_nonce bigint not null,
  status text not null,
  transaction_hash text,
  created_at timestamptz not null default now(),
  unique (deal_id, safe_tx_hash, safe_nonce)
);

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant usage on schema w3m_private to service_role;
