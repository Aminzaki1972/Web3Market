-- Disposable PostgreSQL fixture only; never run against production.
CREATE TABLE public.projects (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  updated_at timestamptz
);
CREATE TABLE public.deals (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  buyer_id uuid NOT NULL,
  seller_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 100,
  payment_status text NOT NULL,
  payment_tx_hash text,
  delivery_status text NOT NULL,
  buyer_approved_at timestamptz,
  dispute_status text,
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
  released_at timestamptz,
  release_tx_hash text
);
CREATE TABLE public.deal_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.validate_deal_release_policy(p_deal_id uuid)
RETURNS jsonb LANGUAGE sql STABLE
AS $fixture$ SELECT jsonb_build_object('valid', true) $fixture$;
