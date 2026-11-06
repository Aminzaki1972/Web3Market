-- Read-only Safe EXECUTE snapshot RPC contract tests.
-- Runs only in the disposable PostgreSQL workflow fixture.
begin;

do $test$
declare
  v_deal uuid := '71000000-0000-4000-8000-000000000001';
  v_project uuid := '72000000-0000-4000-8000-000000000002';
  v_buyer uuid := '73000000-0000-4000-8000-000000000003';
  v_seller uuid := '74000000-0000-4000-8000-000000000004';
  v_tx uuid := '75000000-0000-4000-8000-000000000005';
  v_snapshot jsonb;
  v_tx_rows jsonb;
  v_agreements jsonb;
begin
  if not has_function_privilege('service_role',
       'public.w3m_read_safe_execution_snapshot(uuid)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.w3m_read_safe_execution_snapshot(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_read_safe_execution_snapshot(uuid)', 'EXECUTE') then
    raise exception 'Safe execution snapshot RPC must be service-role-only';
  end if;

  insert into public.projects(id,owner_id,status,updated_at)
  values(v_project,v_seller,'active',now());
  insert into public.profiles(id,wallet_address,wallet_verified,wallet_verified_at)
  values
    (v_buyer,'0x5555555555555555555555555555555555555555',true,now()),
    (v_seller,'0x4444444444444444444444444444444444444444',true,now());

  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,expected_amount,
    token_symbol,platform_fee,platform_fee_percent,seller_net_amount,platform_fee_amount,
    payment_status,payment_tx_hash,delivery_status,buyer_approved_at,delivery_accepted_at,
    dispute_status,chain_id,safe_address,token_contract,buyer_agreed_at,seller_agreed_at
  ) values (
    v_deal,v_project,v_buyer,v_seller,100.000000000000000001,'USDT',
    100.000000000000000001,'USDT',7.500000000000000000,7.5,
    92.500000000000000001,7.500000000000000000,
    'confirmed','0x' || repeat('a',64),'accepted',now(),now(),'none',56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',now(),now()
  );

  insert into public.deal_release_policies(
    id,deal_id,status,chain_id,safe_address,token_contract,deal_amount,
    fee_percent,fee_amount,seller_net_amount,seller_wallet,platform_wallet,
    token_symbol,safe_nonce,locked_at,updated_at
  ) values (
    '76000000-0000-4000-8000-000000000006',v_deal,'locked',56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    100.000000000000000001,7.5,7.500000000000000000,92.500000000000000001,
    '0x4444444444444444444444444444444444444444',
    '0x2B15cC63eE3b833F502C065767695Fa2B584f8c9',
    'USDT',7,now(),now()
  );

  insert into public.deal_multisig_transactions(
    id,deal_id,action,status,safe_tx_hash,chain_id,safe_address,safe_nonce,
    amount,token_symbol,required_signatures,confirmations_count,to_address,data,
    value_wei,operation,safe_tx_gas,base_gas,gas_price,gas_token,refund_receiver,signatures
  ) values (
    v_tx,v_deal,'release_to_seller','signed','0x' || repeat('b',64),56,
    '0x2222222222222222222222222222222222222222',7,
    100,'USDT',2,2,
    '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
    '0x' || repeat('0',64),0,1,0,0,0,
    '0x0000000000000000000000000000000000000000',
    '0x0000000000000000000000000000000000000000','[]'::jsonb
  );

  insert into public.deal_multisig_signers(
    deal_id,signer_role,signer_id,wallet_address,signature_status,signed_at,
    safe_tx_hash,signature
  ) values
    (v_deal,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
     'signed',now(),'0x' || repeat('b',64),'0x' || repeat('c',130)),
    (v_deal,'seller',v_seller,'0x4444444444444444444444444444444444444444',
     'signed',now(),'0x' || repeat('b',64),'0x' || repeat('d',130));

  insert into public.deal_party_agreements(deal_id,party_role,party_id,agreed_at)
  values
    (v_deal,'buyer',v_buyer,now()),
    (v_deal,'seller',v_seller,now());

  v_snapshot := public.w3m_read_safe_execution_snapshot(v_deal);
  if v_snapshot is null
     or v_snapshot->'deal'->>'amount' <> '100.000000000000000001'
     or v_snapshot->'deal'->>'expected_amount' <> '100.000000000000000001'
     or v_snapshot->'policy'->>'seller_net_amount' <> '92.500000000000000001'
     or v_snapshot->'policy'->>'fee_amount' <> '7.500000000000000000'
     or v_snapshot->'policy'->>'safe_nonce' <> '7'
     or v_snapshot->'buyer_profile'->>'wallet_verified' <> 'true'
     or v_snapshot->'seller_profile'->>'wallet_address' <> '0x4444444444444444444444444444444444444444'
     or v_snapshot->>'agreement_binding_supported' <> 'false' then
    raise exception 'Safe execution snapshot did not preserve expected deal/policy/profile fields';
  end if;

  v_tx_rows := v_snapshot->'release_transactions';
  if jsonb_typeof(v_tx_rows) <> 'array'
     or jsonb_array_length(v_tx_rows) <> 1
     or v_tx_rows->0->>'id' <> v_tx::text
     or v_tx_rows->0->>'safe_tx_hash' <> '0x' || repeat('b',64)
     or v_tx_rows->0->>'value_wei' <> '0'
     or v_tx_rows->0->>'safe_nonce' <> '7' then
    raise exception 'Safe release transaction snapshot is incomplete or inexact';
  end if;

  if jsonb_array_length(v_snapshot->'signers') <> 2 then
    raise exception 'Safe signer rows were not included in the snapshot';
  end if;

  v_agreements := v_snapshot->'party_agreements';
  if jsonb_array_length(v_agreements) <> 2
     or v_agreements->0 ? 'terms_hash'
     or v_snapshot->>'agreement_binding_supported' <> 'false' then
    raise exception 'Legacy timestamp-only agreement records were misrepresented as immutable terms evidence';
  end if;

  -- A current immutable EIP-712 terms version and both party acceptances
  -- must be exposed by the upgraded reader; legacy timestamps remain separate.
  insert into public.w3m_deal_terms_versions(
    id,deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,
    safe_address,terms_hash,canonical_terms
  ) values (
    '79000000-0000-4000-8000-000000000009',v_deal,1,v_project,v_buyer,v_seller,56,
    '0x2222222222222222222222222222222222222222',repeat('a',64),
    jsonb_build_object('dealId',v_deal::text,'termsHash',repeat('a',64))
  );
  insert into public.w3m_deal_agreement_acceptances(
    id,terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values
    ('79100000-0000-4000-8000-000000000001',
     '79000000-0000-4000-8000-000000000009',v_deal,1,'buyer',v_buyer,
     '0x5555555555555555555555555555555555555555',56,
     '0x2222222222222222222222222222222222222222',repeat('a',64),
     '0x' || repeat('b',64),'0x' || repeat('c',130)),
    ('79200000-0000-4000-8000-000000000002',
     '79000000-0000-4000-8000-000000000009',v_deal,1,'seller',v_seller,
     '0x4444444444444444444444444444444444444444',56,
     '0x2222222222222222222222222222222222222222',repeat('a',64),
     '0x' || repeat('d',64),'0x' || repeat('e',130));

  v_snapshot := public.w3m_read_safe_execution_snapshot(v_deal);
  if v_snapshot->>'agreement_binding_supported' <> 'true'
     or v_snapshot->'terms_version'->>'id' <> '79000000-0000-4000-8000-000000000009'
     or v_snapshot->'terms_version'->>'terms_version' <> '1'
     or jsonb_array_length(v_snapshot->'agreement_acceptances') <> 2
     or v_snapshot->'agreement_acceptances'->0->>'terms_hash' <> repeat('a',64)
     or v_snapshot->'agreement_acceptances'->1->>'chain_id' <> '56' then
    raise exception 'Safe execution snapshot did not expose exact immutable EIP-712 agreement records';
  end if;

  -- The legacy transaction table permits multiple release rows. The reader
  -- must return both; the trusted adapter must reject the ambiguous snapshot.
  insert into public.deal_multisig_transactions(
    id,deal_id,action,status,safe_tx_hash,chain_id,safe_address,safe_nonce,
    amount,token_symbol
  ) values (
    '77000000-0000-4000-8000-000000000007',v_deal,'release_to_seller','cancelled',
    '0x' || repeat('e',64),56,'0x2222222222222222222222222222222222222222',8,100,'USDT'
  );

  v_snapshot := public.w3m_read_safe_execution_snapshot(v_deal);
  if jsonb_array_length(v_snapshot->'release_transactions') <> 2 then
    raise exception 'Reader hid duplicate legacy release rows instead of exposing ambiguity';
  end if;

  if public.w3m_read_safe_execution_snapshot(
      '78000000-0000-4000-8000-000000000008'::uuid) is not null then
    raise exception 'Missing deal unexpectedly returned an execution snapshot';
  end if;
end;
$test$;

rollback;
