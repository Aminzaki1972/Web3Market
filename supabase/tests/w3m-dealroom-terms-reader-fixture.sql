-- Additional columns required by the exact-text Deal Room reader RPC.
alter table public.deals
  add column if not exists currency text not null default 'USDT',
  add column if not exists expected_amount numeric;
alter table public.deal_release_policies
  add column if not exists fee_percent numeric not null default 7.5,
  add column if not exists safe_nonce bigint;
