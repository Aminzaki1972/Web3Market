-- Disposable PostgreSQL fixture only; never run against production.
CREATE TABLE public.deals (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  payment_status text NOT NULL,
  payment_tx_hash text,
  delivery_status text NOT NULL,
  buyer_approved_at timestamptz,
  dispute_status text,
  chain_id bigint,
  safe_address text,
  token_contract text
);
CREATE TABLE public.deal_multisig_transactions (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  action text NOT NULL,
  status text NOT NULL,
  safe_tx_hash text,
  chain_id bigint,
  safe_address text
);
CREATE TABLE public.deal_release_policies (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL UNIQUE REFERENCES public.deals(id),
  status text NOT NULL,
  chain_id bigint,
  safe_address text,
  token_contract text
);
CREATE FUNCTION public.validate_deal_release_policy(p_deal_id uuid)
RETURNS jsonb LANGUAGE sql STABLE
AS $fixture$ SELECT jsonb_build_object('valid', true) $fixture$;
