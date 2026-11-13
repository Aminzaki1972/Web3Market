-- Disposable PostgreSQL fixture only; never run against production.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $auth_uid$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$auth_uid$;

CREATE TABLE public.projects (
  id uuid PRIMARY KEY,
  owner_id uuid,
  status text NOT NULL DEFAULT 'active',
  github_url text,
  updated_at timestamptz
);
CREATE TABLE public.deals (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 100,
  currency text NOT NULL DEFAULT 'USDT',
  token_symbol text,
  platform_fee numeric NOT NULL DEFAULT 0,
  platform_fee_percent numeric NOT NULL DEFAULT 7.5,
  seller_net_amount numeric,
  platform_fee_amount numeric,
  buyer_agreed_at timestamptz,
  seller_agreed_at timestamptz,
  delivery_accepted_at timestamptz,
  payment_status text NOT NULL,
  payment_tx_hash text,
  delivery_status text NOT NULL,
  buyer_approved_at timestamptz,
  dispute_status text,
  disputed_at timestamptz,
  chain_id bigint,
  safe_address text,
  token_contract text,
  release_tx_hash text,
  status text NOT NULL DEFAULT 'funded',
  completed_at timestamptz,
  updated_at timestamptz
);
CREATE TABLE public.deal_multisig_transactions (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  action text NOT NULL,
  status text NOT NULL,
  safe_tx_hash text,
  chain_id bigint,
  safe_address text,
  tx_hash text,
  safe_nonce bigint,
  amount numeric NOT NULL DEFAULT 100,
  token_symbol text NOT NULL DEFAULT 'USDT',
  confirmations_count integer NOT NULL DEFAULT 0,
  required_signatures integer NOT NULL DEFAULT 2,
  to_address text,
  data text,
  value_wei numeric NOT NULL DEFAULT 0,
  operation integer NOT NULL DEFAULT 0,
  safe_tx_gas numeric NOT NULL DEFAULT 0,
  base_gas numeric NOT NULL DEFAULT 0,
  gas_price numeric NOT NULL DEFAULT 0,
  gas_token text,
  refund_receiver text,
  signatures jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE TABLE public.deal_release_policies (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL UNIQUE REFERENCES public.deals(id),
  status text NOT NULL,
  chain_id bigint,
  safe_address text,
  token_contract text,
  deal_amount numeric NOT NULL DEFAULT 100,
  seller_wallet text,
  platform_wallet text,
  seller_net_amount numeric NOT NULL DEFAULT 92.5,
  fee_amount numeric NOT NULL DEFAULT 7.5,
  fee_percent numeric NOT NULL DEFAULT 7.5,
  token_symbol text,
  locked_at timestamptz,
  updated_at timestamptz,
  released_at timestamptz,
  release_tx_hash text
);
CREATE TABLE public.deal_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  old_status text,
  new_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.code_audits (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  repo_url text NOT NULL,
  repo_owner text NOT NULL,
  repo_name text NOT NULL,
  audit_type text NOT NULL DEFAULT 'code',
  overall_score numeric,
  risk_level text,
  analysis_method text,
  commit_sha text NOT NULL,
  status text NOT NULL,
  completed_at timestamptz,
  engine_version text NOT NULL,
  analysis_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  files_scanned integer NOT NULL DEFAULT 0,
  critical_count integer NOT NULL DEFAULT 0,
  high_count integer NOT NULL DEFAULT 0,
  medium_count integer NOT NULL DEFAULT 0,
  low_count integer NOT NULL DEFAULT 0,
  info_count integer NOT NULL DEFAULT 0
);
CREATE TABLE public.code_audit_files (
  id uuid PRIMARY KEY,
  audit_id uuid NOT NULL REFERENCES public.code_audits(id) ON DELETE CASCADE,
  path text NOT NULL
);
CREATE TABLE public.code_audit_findings (
  id uuid PRIMARY KEY,
  audit_id uuid NOT NULL REFERENCES public.code_audits(id) ON DELETE CASCADE,
  severity text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  file_path text,
  line_start integer,
  line_end integer,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.validate_deal_release_policy(p_deal_id uuid)
RETURNS jsonb LANGUAGE sql STABLE
AS $fixture$ SELECT jsonb_build_object('valid', false) $fixture$;


CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  wallet_address text,
  wallet_verified boolean NOT NULL DEFAULT false,
  wallet_verified_at timestamptz
);

CREATE TABLE public.deal_multisig_signers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  signer_role text NOT NULL,
  signer_id uuid,
  wallet_address text,
  signature_status text NOT NULL DEFAULT 'pending',
  signed_at timestamptz,
  safe_tx_hash text,
  signature text,
  UNIQUE (deal_id, signer_role)
);

CREATE TABLE public.deal_party_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  party_role text NOT NULL,
  party_id uuid NOT NULL,
  agreed_at timestamptz,
  UNIQUE (deal_id, party_role)
);

CREATE TABLE public.deal_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','resolved','cancelled')),
  resolution text,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Narrow test double for the live projects owner-protection trigger.
-- Mirrors the production rule: ordinary authenticated updates cannot change
-- owner_id; trusted service-role workflows may do so inside atomic finalization.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE
AS $auth_role$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$auth_role$;

CREATE OR REPLACE FUNCTION public.w3m_test_protect_project_owner()
RETURNS trigger LANGUAGE plpgsql
AS $owner_guard$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Project owner cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$owner_guard$;

CREATE TRIGGER trg_test_protect_project_owner
BEFORE UPDATE OF owner_id ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.w3m_test_protect_project_owner();
