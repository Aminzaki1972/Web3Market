-- Additional columns required by the exact-text Deal Room reader RPC.
alter table public.deals
  add column currency text not null default 'USDT',
  add column expected_amount numeric;
alter table public.deal_release_policies
  add column fee_percent numeric not null default 7.5,
  add column safe_nonce bigint,
  add column token_symbol text,
  add column locked_at timestamptz;
