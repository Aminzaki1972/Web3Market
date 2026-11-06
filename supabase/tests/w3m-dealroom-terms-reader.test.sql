-- Contract test for the server-only exact-text Deal Room snapshot RPC.
do $$
declare
  v record;
begin
  if not has_function_privilege('service_role',
      'public.w3m_read_dealroom_terms_snapshot(uuid)', 'EXECUTE')
     or has_function_privilege('anon',
      'public.w3m_read_dealroom_terms_snapshot(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
      'public.w3m_read_dealroom_terms_snapshot(uuid)', 'EXECUTE') then
    raise exception 'Deal Room snapshot RPC must be service-role-only';
  end if;

  insert into public.projects(id,owner_id,status) values ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','active');
  insert into public.profiles(id,wallet_address,wallet_verified,wallet_verified_at)
  values
    ('30000000-0000-0000-0000-000000000001','0x5555555555555555555555555555555555555555',true,now()),
    ('40000000-0000-0000-0000-000000000001','0x4444444444444444444444444444444444444444',true,now());
  insert into public.deals(
    id, project_id, buyer_id, seller_id, amount, currency, expected_amount, status,
    payment_status, payment_tx_hash, delivery_status, buyer_approved_at,
    dispute_status, chain_id, safe_address, token_contract
  ) values (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    100.000000000000000001, 'USDT', 100.000000000000000001, 'funded',
    'confirmed', repeat('a', 64), 'accepted', now(), 'none', 56,
    '0x2222222222222222222222222222222222222222',
    '0x55d398326f99059ff775485246999027b3197955'
  );
  insert into public.deal_release_policies(
    id, deal_id, status, chain_id, safe_address, token_contract,
    deal_amount, fee_percent, fee_amount, seller_net_amount,
    seller_wallet, platform_wallet, safe_nonce
  ) values (
    '50000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'locked', 56,
    '0x2222222222222222222222222222222222222222',
    '0x55d398326f99059ff775485246999027b3197955',
    100.000000000000000001, 7.5, 7.500000000000000000, 92.500000000000000001,
    '0x4444444444444444444444444444444444444444',
    '0x2B15cC63eE3b833F502C065767695Fa2B584f8c9', 7
  );

  select * into v
  from public.w3m_read_dealroom_terms_snapshot('20000000-0000-0000-0000-000000000001'::uuid);

  if v.deal_status <> 'funded'
     or v.deal_amount <> '100.000000000000000001'
     or v.policy_fee_amount <> '7.500000000000000000'
     or v.policy_seller_net_amount <> '92.500000000000000001'
     or v.deal_chain_id <> '56'
     or v.policy_safe_nonce <> '7'
     or v.buyer_wallet <> '0x5555555555555555555555555555555555555555'
     or v.seller_wallet <> '0x4444444444444444444444444444444444444444'
     or v.project_owner_id <> '40000000-0000-0000-0000-000000000001'
     or v.project_status <> 'active'
     or v.buyer_wallet_verified <> 'true'
     or v.seller_wallet_verified <> 'true'
     or v.buyer_wallet_verified_at is null
     or v.seller_wallet_verified_at is null then
    raise exception 'Exact-text Deal Room snapshot did not preserve canonical values';
  end if;
end;
$$;
