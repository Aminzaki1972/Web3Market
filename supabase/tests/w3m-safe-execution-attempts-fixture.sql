-- Disposable PostgreSQL fixture only; never run against production.
CREATE TABLE public.projects (
  id uuid PRIMARY KEY,
  owner_id uuid,
  status text NOT NULL DEFAULT 'active',
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
CREATE FUNCTION public.validate_deal_release_policy(p_deal_id uuid)
RETURNS jsonb LANGUAGE sql STABLE
AS $fixture$ SELECT jsonb_build_object('valid', true) $fixture$;


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
  status text NOT NULL,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz
);
