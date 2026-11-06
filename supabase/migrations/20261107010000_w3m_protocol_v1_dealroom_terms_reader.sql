-- W3M Protocol V1: server-only, read-only exact-text Deal Room snapshot.
-- This RPC exists only in the isolated branch until separately reviewed/approved.
create or replace function public.w3m_read_dealroom_terms_snapshot(p_deal_id uuid)
returns table (
  deal_id text,
  project_id text,
  buyer_id text,
  seller_id text,
  buyer_wallet text,
  seller_wallet text,
  deal_amount text,
  currency text,
  expected_amount text,
  deal_chain_id text,
  deal_safe_address text,
  deal_token_contract text,
  payment_status text,
  payment_tx_hash text,
  delivery_status text,
  buyer_approved_at text,
  dispute_status text,
  release_tx_hash text,
  policy_deal_id text,
  policy_deal_amount text,
  policy_fee_percent text,
  policy_fee_amount text,
  policy_seller_net_amount text,
  policy_chain_id text,
  policy_safe_address text,
  policy_token_contract text,
  policy_seller_wallet text,
  policy_platform_wallet text,
  policy_safe_nonce text,
  policy_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id::text,
    d.project_id::text,
    d.buyer_id::text,
    d.seller_id::text,
    buyer_profile.wallet_address,
    seller_profile.wallet_address,
    d.amount::text,
    d.currency,
    d.expected_amount::text,
    d.chain_id::text,
    d.safe_address,
    d.token_contract,
    d.payment_status,
    d.payment_tx_hash,
    d.delivery_status,
    d.buyer_approved_at::text,
    d.dispute_status,
    d.release_tx_hash,
    p.deal_id::text,
    p.deal_amount::text,
    p.fee_percent::text,
    p.fee_amount::text,
    p.seller_net_amount::text,
    p.chain_id::text,
    p.safe_address,
    p.token_contract,
    p.seller_wallet,
    p.platform_wallet,
    p.safe_nonce::text,
    p.status
  from public.deals d
  left join public.deal_release_policies p on p.deal_id = d.id
  left join public.profiles buyer_profile on buyer_profile.id = d.buyer_id
  left join public.profiles seller_profile on seller_profile.id = d.seller_id
  where d.id = p_deal_id;
$$;

revoke all on function public.w3m_read_dealroom_terms_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.w3m_read_dealroom_terms_snapshot(uuid) to service_role;
