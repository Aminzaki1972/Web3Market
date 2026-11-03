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
  IF config.recipient_address IS NOT NULL THEN
    RAISE EXCEPTION 'Audit payment recipient must remain unset until a dedicated wallet is explicitly approved';
  END IF;
  IF config.enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Audit payment route must remain disabled until recipient configuration is approved';
  END IF;
END $$;

DO $$
DECLARE
  nullable_user text;
  nullable_requester text;
  allowed boolean;
  i integer;
  fingerprint text := repeat('a',64);
  test_order_id uuid;
  test_access_id uuid;
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
  IF NOT has_table_privilege('service_role','public.guest_audit_access','SELECT')
     OR NOT has_table_privilege('service_role','public.guest_audit_access','INSERT')
     OR NOT has_table_privilege('service_role','public.guest_audit_access','UPDATE') THEN
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

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guest_audit_access' AND column_name='report_token_ciphertext')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guest_audit_access' AND column_name='report_token_iv') THEN
    RAISE EXCEPTION 'Guest report token must be stored encrypted for safe email retries';
  END IF;

  IF has_function_privilege('anon','public.claim_guest_audit_email_delivery(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.claim_guest_audit_email_delivery(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.claim_guest_audit_email_delivery(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Guest email claim RPC must be restricted to service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('consume_guest_audit_order_rate_limit','claim_guest_audit_email_delivery')
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Guest RPCs must run as invoker, not SECURITY DEFINER';
  END IF;

  INSERT INTO public.audit_payment_orders
    (user_id,audit_type,repo_url,price_usd,chain_id,token_contract,token_symbol,
     token_decimals,recipient_address,amount_atomic)
  VALUES
    (NULL,'code','https://github.com/example/repo',9.00,56,
     '0x55d398326f99059ff775485246999027b3197955','BSC-USD',18,
     '0x1111111111111111111111111111111111111111',9000000000000000000)
  RETURNING id INTO test_order_id;

  INSERT INTO public.guest_audit_access
    (payment_order_id,email,order_token_hash)
  VALUES
    (test_order_id,'buyer@example.com',repeat('b',64))
  RETURNING id INTO test_access_id;

  SELECT public.claim_guest_audit_email_delivery(test_access_id) INTO allowed;
  IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'First guest email claim must succeed'; END IF;
  SELECT public.claim_guest_audit_email_delivery(test_access_id) INTO allowed;
  IF allowed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Concurrent guest email claim must be rejected'; END IF;

  UPDATE public.guest_audit_access
     SET email_claimed_at = now() - interval '11 minutes'
   WHERE id = test_access_id;
  SELECT public.claim_guest_audit_email_delivery(test_access_id) INTO allowed;
  IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Expired guest email claim must be recoverable'; END IF;

  UPDATE public.guest_audit_access
     SET email_sent_at = now(),
         email_claimed_at = NULL,
         report_token_hash = repeat('c',64),
         report_token_expires_at = now() + interval '1 day',
         report_token_used_at = NULL
   WHERE id = test_access_id;
  SELECT public.claim_guest_audit_email_delivery(test_access_id) INTO allowed;
  IF allowed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Active guest report link must not be reissued'; END IF;

  UPDATE public.guest_audit_access
     SET report_token_expires_at = now() - interval '1 minute'
   WHERE id = test_access_id;
  SELECT public.claim_guest_audit_email_delivery(test_access_id) INTO allowed;
  IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Expired guest report link must be eligible for secure reissue'; END IF;
END $$;

ROLLBACK;
