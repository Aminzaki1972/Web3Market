-- Apply the audit V2 migration against a minimal isolated PostgreSQL schema.
-- This catches migration syntax/DDL errors without touching any Supabase project.
BEGIN;
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
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  project_id uuid NULL REFERENCES public.projects(id),
  status text NOT NULL DEFAULT 'pending',
  engine_version text NOT NULL DEFAULT 'w3m-code-audit-2.0'
);

\i supabase/migrations/20261102000100_audit_v2_contracts_and_payment_orders.sql
\i supabase/migrations/20261102000200_audit_v2_guest_checkout.sql

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

DO $$
DECLARE
  nullable_user text;
  nullable_requester text;
  allowed boolean;
  i integer;
  fingerprint text := repeat('a',64);
BEGIN
  SELECT is_nullable INTO nullable_user FROM information_schema.columns
   WHERE table_schema='public' AND table_name='audit_payment_orders' AND column_name='user_id';
  SELECT is_nullable INTO nullable_requester FROM information_schema.columns
   WHERE table_schema='public' AND table_name='code_audits' AND column_name='requested_by';
  IF nullable_user <> 'YES' OR nullable_requester <> 'YES' THEN
    RAISE EXCEPTION 'Guest checkout requires nullable user_id and requested_by';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='guest_audit_access' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'Guest access table must enforce RLS';
  END IF;
  IF has_table_privilege('anon','public.guest_audit_access','SELECT')
     OR has_table_privilege('authenticated','public.guest_audit_access','SELECT')
     OR has_table_privilege('anon','public.guest_audit_access','INSERT')
     OR has_table_privilege('authenticated','public.guest_audit_access','UPDATE') THEN
    RAISE EXCEPTION 'Guest access table must not be directly accessible to client roles';
  END IF;
  IF NOT has_table_privilege('service_role','public.guest_audit_access','SELECT,INSERT,UPDATE') THEN
    RAISE EXCEPTION 'Service role must have the required guest access table privileges';
  END IF;
  IF has_function_privilege('anon','public.consume_guest_audit_order_rate_limit(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.consume_guest_audit_order_rate_limit(text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.consume_guest_audit_order_rate_limit(text)','EXECUTE') THEN
    RAISE EXCEPTION 'Guest rate-limit RPC execute privileges are not restricted to service_role';
  END IF;
  FOR i IN 1..5 LOOP
    SELECT public.consume_guest_audit_order_rate_limit(fingerprint) INTO allowed;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Rate limit rejected request % too early', i; END IF;
  END LOOP;
  SELECT public.consume_guest_audit_order_rate_limit(fingerprint) INTO allowed;
  IF allowed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Rate limit must reject request six'; END IF;
END $$;

ROLLBACK;
