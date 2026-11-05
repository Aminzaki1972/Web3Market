-- Additional columns required by the exact-text Deal Room reader RPC.
alter table public.deals
  add column currency text not null default 'USDT',
  add column expected_amount numeric,
  add column amount numeric not null default 100,
  add column buyer_approved_at timestamptz;
alter table public.deal_release_policies
  add column fee_percent numeric not null default 7.5,
  add column fee_amount numeric not null default 7.5,
  add column seller_wallet text,
  add column safe_nonce bigint;
