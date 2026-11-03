-- Additive audit V2 metadata and payment-order foundation.
-- This migration is review-only in this PR and has not been applied to production.

ALTER TABLE public.platform_payment_configs
  ADD COLUMN IF NOT EXISTS recipient_address text NULL;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='platform_payment_configs_recipient_address_check'
      AND conrelid='public.platform_payment_configs'::regclass
  ) THEN
    ALTER TABLE public.platform_payment_configs
      ADD CONSTRAINT platform_payment_configs_recipient_address_check
      CHECK (recipient_address IS NULL OR recipient_address ~* '^0x[a-f0-9]{40}$');
  END IF;
END $$;

COMMENT ON COLUMN public.platform_payment_configs.recipient_address IS
  'Platform fee/audit-payment receiving wallet; distinct from the Safe escrow address.';

-- Dedicated audit-fee recipient supplied by the platform owner for review.
-- Keep this Binance-Peg BSC-USD route DISABLED until independent address/network checks and explicit activation approval.
UPDATE public.platform_payment_configs
   SET recipient_address = '0xEE3157C2DeC61AFA7f2fbe86CD0427BedEAcBe85',
       enabled = false,
       updated_at = now()
 WHERE chain_id = 56
   AND lower(token_contract) = lower('0x55d398326f99059ff775485246999027b3197955');

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_payment_configs
    WHERE chain_id=56
      AND lower(token_contract)=lower('0x55d398326f99059ff775485246999027b3197955')
  ) THEN
    INSERT INTO public.platform_payment_configs
      (chain_id,safe_address,recipient_address,token_contract,token_symbol,enabled)
    VALUES
      (56,
       '0xe1851d2aadc3d24175acaa22298c0418c830bf3f',
       '0xEE3157C2DeC61AFA7f2fbe86CD0427BedEAcBe85',
       '0x55d398326f99059ff775485246999027b3197955',
       'BSC-USD',
       false);
  END IF;
END $$;

COMMENT ON COLUMN public.platform_payment_configs.token_contract IS
  'For BNB Smart Chain, configure the exact approved BEP-20 token contract; verify token representation and decimals before enabling payments.';

ALTER TABLE public.code_audits
  ADD COLUMN IF NOT EXISTS audit_type text NOT NULL DEFAULT 'code';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='code_audits_audit_type_check'
      AND conrelid='public.code_audits'::regclass
  ) THEN
    ALTER TABLE public.code_audits
      ADD CONSTRAINT code_audits_audit_type_check
      CHECK (audit_type IN ('code','smart_contract','complete'));
  END IF;
END $$;

COMMENT ON COLUMN public.code_audits.audit_type IS
  'Audit scope: repository code, Solidity-focused smart_contract, or combined complete. None is independent certification.';

CREATE TABLE IF NOT EXISTS public.audit_payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  audit_id uuid NULL REFERENCES public.code_audits(id) ON DELETE SET NULL,
  audit_type text NOT NULL CHECK (audit_type IN ('code','smart_contract','complete')),
  repo_url text NOT NULL,
  price_usd numeric(10,2) NOT NULL CHECK (price_usd IN (9.00,29.00,79.00)),
  chain_id bigint NOT NULL CHECK (chain_id=56),
  token_contract text NOT NULL CHECK (lower(token_contract)='0x55d398326f99059ff775485246999027b3197955'),
  token_symbol text NOT NULL CHECK (token_symbol='BSC-USD'),
  token_decimals smallint NOT NULL CHECK (token_decimals=18),
  recipient_address text NOT NULL CHECK (recipient_address ~* '^0x[a-f0-9]{40}$'),
  amount_atomic numeric(78,0) NOT NULL CHECK (amount_atomic>0),
  payer_address text NULL CHECK (payer_address IS NULL OR payer_address ~* '^0x[a-f0-9]{40}$'),
  tx_hash text NULL CHECK (tx_hash IS NULL OR tx_hash ~* '^0x[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','expired','failed')),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NULL
);

ALTER TABLE public.audit_payment_orders
  ADD COLUMN IF NOT EXISTS transfer_log_index integer NULL,
  ADD COLUMN IF NOT EXISTS transfer_block_number bigint NULL,
  ADD COLUMN IF NOT EXISTS transfer_block_hash text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_payment_orders_transfer_log_index_nonnegative' AND conrelid='public.audit_payment_orders'::regclass) THEN
    ALTER TABLE public.audit_payment_orders ADD CONSTRAINT audit_payment_orders_transfer_log_index_nonnegative
      CHECK (transfer_log_index IS NULL OR transfer_log_index >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_payment_orders_transfer_block_number_nonnegative' AND conrelid='public.audit_payment_orders'::regclass) THEN
    ALTER TABLE public.audit_payment_orders ADD CONSTRAINT audit_payment_orders_transfer_block_number_nonnegative
      CHECK (transfer_block_number IS NULL OR transfer_block_number >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='audit_payment_orders_transfer_block_hash_format' AND conrelid='public.audit_payment_orders'::regclass) THEN
    ALTER TABLE public.audit_payment_orders ADD CONSTRAINT audit_payment_orders_transfer_block_hash_format
      CHECK (transfer_block_hash IS NULL OR transfer_block_hash ~* '^0x[a-f0-9]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS audit_payment_orders_tx_hash_unique
  ON public.audit_payment_orders(lower(tx_hash))
  WHERE tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_payment_orders_user_created_idx
  ON public.audit_payment_orders(user_id,created_at DESC);

ALTER TABLE public.audit_payment_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.audit_payment_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.audit_payment_orders TO service_role;

ALTER TABLE public.code_audits
  ADD COLUMN IF NOT EXISTS payment_order_id uuid NULL
  REFERENCES public.audit_payment_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS code_audits_payment_order_unique
  ON public.code_audits(payment_order_id)
  WHERE payment_order_id IS NOT NULL;

-- Atomic one-free-audit entitlement per listed project for the V2 engine.
-- Failed audits release the entitlement; active and completed audits reserve it.
-- Paid audits are excluded by payment_order_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS code_audits_one_free_v2_per_project_unique
  ON public.code_audits(project_id)
  WHERE project_id IS NOT NULL
    AND payment_order_id IS NULL
    AND engine_version = 'w3m-code-audit-2.0'
    AND status IN ('pending','processing','queued','scanning','analyzing','retrying','paused','completed');

COMMENT ON TABLE public.audit_payment_orders IS
  'Server-only Binance-Peg BSC-USD audit orders. This is a Binance-pegged BEP-20 representation, not direct Tether-issued USD₮. The server verifies chain ID, exact approved token contract, recipient, amount, confirmations and unique transaction hash before confirmation.';

CREATE TABLE IF NOT EXISTS public.code_audit_autofix_prs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.code_audits(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  source_commit_sha text NOT NULL CHECK (source_commit_sha ~ '^[0-9a-f]{40}$'),
  branch_name text NOT NULL,
  pr_number integer NOT NULL,
  pr_url text NOT NULL,
  files_changed integer NOT NULL DEFAULT 0 CHECK (files_changed BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, source_commit_sha),
  UNIQUE (pr_number)
);

ALTER TABLE public.code_audit_autofix_prs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.code_audit_autofix_prs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE public.code_audit_autofix_prs TO service_role;

COMMENT ON TABLE public.code_audit_autofix_prs IS
  'Audit-linked AI-proposed GitHub fix PRs. Never auto-merges; users must review changes in GitHub.';
