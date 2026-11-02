-- Apply the audit V2 migration against a minimal isolated PostgreSQL schema.
-- This catches migration syntax/DDL errors without touching any Supabase project.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.projects (id uuid PRIMARY KEY);
CREATE TABLE public.platform_payment_configs (
  chain_id bigint NOT NULL,
  safe_address text,
  token_contract text NOT NULL,
  token_symbol text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.code_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL REFERENCES public.projects(id),
  status text NOT NULL DEFAULT 'pending',
  engine_version text NOT NULL DEFAULT 'w3m-code-audit-2.0'
);

\i supabase/migrations/20261102000100_audit_v2_contracts_and_payment_orders.sql

DO $$
DECLARE
  config public.platform_payment_configs%ROWTYPE;
BEGIN
  SELECT * INTO config
  FROM public.platform_payment_configs
  WHERE chain_id=56
    AND lower(token_contract)=lower('0x55d398326f99059ff775485246999027b3197955');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected BSC-USD payment route was not seeded';
  END IF;
  IF config.token_symbol <> 'BSC-USD' OR config.enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'BSC-USD must be accurately labeled and disabled by default';
  END IF;
  IF config.recipient_address <> '0x2b15cc63ee3b833f502c065767695fa2b584f8c9' THEN
    RAISE EXCEPTION 'Unexpected audit payment recipient';
  END IF;
END $$;
