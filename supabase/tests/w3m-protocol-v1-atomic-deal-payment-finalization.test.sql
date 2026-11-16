begin;

do $$
declare
  v_proc regprocedure := to_regprocedure('public.w3m_finalize_deal_payment(uuid,uuid,text,jsonb)');
  v_definition text;
  v_hash_index text;
  v_deal_index text;
begin
  if v_proc is null then
    raise exception 'atomic deal payment finalization RPC is missing';
  end if;

  v_definition := pg_get_functiondef(v_proc);
  if v_definition not ilike '%request.jwt.claim.role%'
     or v_definition not ilike '%service_role%'
     or v_definition not ilike '%for update%'
     or v_definition not ilike '%insert into public.blockchain_transactions%'
     or v_definition not ilike '%update public.deals%'
     or v_definition not ilike '%insert into public.deal_audit_logs%'
     or v_definition not ilike '%W3M_PAYMENT_TRANSACTION_HASH_ALREADY_BOUND%' then
    raise exception 'atomic deal payment finalization RPC is missing a required trust or atomicity guard';
  end if;

  select pg_get_indexdef(indexrelid) into v_hash_index
  from pg_index
  where indexrelid = to_regclass('public.blockchain_transactions_tx_hash_lower_uq');
  if v_hash_index is null or v_hash_index not ilike '%lower(tx_hash)%' then
    raise exception 'case-insensitive transaction hash unique index is missing';
  end if;

  select pg_get_indexdef(indexrelid) into v_deal_index
  from pg_index
  where indexrelid = to_regclass('public.deals_payment_tx_hash_lower_uq');
  if v_deal_index is null or v_deal_index not ilike '%lower(payment_tx_hash)%' then
    raise exception 'case-insensitive deal payment hash unique index is missing';
  end if;

  if has_function_privilege('anon', v_proc, 'EXECUTE')
     or has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or not has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception 'atomic deal payment RPC grants are not service-role-only';
  end if;
end;
$$;


do $$
declare
  v_result jsonb;
  v_status text;
  v_payment_status text;
  v_fee numeric;
  v_seller_net numeric;
  v_count integer;
  v_tx text := '0x' || repeat('a', 64);
  v_receipt jsonb := jsonb_build_object(
    'chainId', 56,
    'transactionHash', '0x' || repeat('a', 64),
    'blockHash', '0x' || repeat('b', 64),
    'blockNumber', '123456',
    'confirmations', 5,
    'buyerWallet', '0x1111111111111111111111111111111111111111',
    'safeAddress', '0x2222222222222222222222222222222222222222',
    'tokenContract', '0x55d398326f99059ff775485246999027b3197955',
    'amountBaseUnits', '10750000000000000000',
    'logIndex', '7'
  );
begin
  insert into auth.users(id) values
    ('91000000-0000-4000-8000-000000000001'),
    ('91000000-0000-4000-8000-000000000002'),
    ('91000000-0000-4000-8000-000000000003'),
    ('91000000-0000-4000-8000-000000000004')
  on conflict do nothing;

  insert into public.profiles(id,wallet_address,wallet_verified) values
    ('91000000-0000-4000-8000-000000000001','0x1111111111111111111111111111111111111111',true),
    ('91000000-0000-4000-8000-000000000002','0x3333333333333333333333333333333333333333',true),
    ('91000000-0000-4000-8000-000000000003','0x4444444444444444444444444444444444444444',true),
    ('91000000-0000-4000-8000-000000000004','0x5555555555555555555555555555555555555555',true)
  on conflict (id) do update set wallet_address=excluded.wallet_address,wallet_verified=excluded.wallet_verified;

  insert into public.projects(id) values
    ('92000000-0000-4000-8000-000000000001'),
    ('92000000-0000-4000-8000-000000000002'),
    ('92000000-0000-4000-8000-000000000003')
  on conflict do nothing;

  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,status,payment_status,
    delivery_status,chain_id,safe_address,token_contract,token_symbol,
    expected_amount,platform_fee_percent,platform_fee
  ) values
    ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
     '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
     10,'USDT','accepted','pending','pending',56,
     '0x2222222222222222222222222222222222222222',
     '0x55d398326f99059ff775485246999027b3197955','USDT',10.75,7.5,0),
    ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002',
     '91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000004',
     10,'USDT','accepted','pending','pending',56,
     '0x6666666666666666666666666666666666666666',
     '0x55d398326f99059ff775485246999027b3197955','USDT',10.75,7.5,0),
    ('93000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000003',
     '91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
     10,'USDT','accepted','pending','pending',56,
     '0x7777777777777777777777777777777777777777',
     '0x55d398326f99059ff775485246999027b3197955','USDT',10.75,7.5,0);

  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.w3m_finalize_deal_payment(
      '93000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',v_tx,v_receipt
    );
    raise exception 'RPC unexpectedly accepted a non-service role';
  exception when others then
    if sqlerrm not like '%W3M_PAYMENT_SERVICE_ROLE_REQUIRED%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.role','service_role',true);
  v_result := public.w3m_finalize_deal_payment(
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',v_tx,v_receipt
  );
  if v_result->>'ok' <> 'true' or v_result->>'verified' <> 'true'
     or v_result->>'idempotent' <> 'false' then
    raise exception 'first payment finalization did not return success';
  end if;

  select status,payment_status,platform_fee_amount,seller_net_amount
  into v_status,v_payment_status,v_fee,v_seller_net
  from public.deals where id='93000000-0000-4000-8000-000000000001';
  if v_status <> 'funded' or v_payment_status <> 'confirmed'
     or v_fee <> 0.75 or v_seller_net <> 9.25 then
    raise exception 'deal funding or exact fee split was not committed atomically';
  end if;

  select count(*) into v_count from public.blockchain_transactions
  where lower(tx_hash)=lower(v_tx) and deal_id='93000000-0000-4000-8000-000000000001'
    and status='confirmed';
  if v_count <> 1 then raise exception 'confirmed payment transaction row missing'; end if;

  select count(*) into v_count from public.deal_audit_logs
  where deal_id='93000000-0000-4000-8000-000000000001' and action='payment_verified';
  if v_count <> 1 then raise exception 'payment audit record missing'; end if;

  v_result := public.w3m_finalize_deal_payment(
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',v_tx,v_receipt
  );
  if v_result->>'idempotent' <> 'true' then
    raise exception 'same confirmed payment retry was not idempotent';
  end if;

  begin
    perform public.w3m_finalize_deal_payment(
      '93000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',v_tx,
      jsonb_set(v_receipt,'{amountBaseUnits}','"1"')
    );
    raise exception 'idempotent retry bypassed receipt amount validation';
  exception when others then
    if sqlerrm not like '%W3M_PAYMENT_AMOUNT_MISMATCH%' then raise; end if;
  end;

  begin
    perform public.w3m_finalize_deal_payment(
      '93000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000003','0x' || repeat('A',64),
      jsonb_set(jsonb_set(jsonb_set(v_receipt,'{transactionHash}',to_jsonb('0x' || repeat('A',64))),'{buyerWallet}','"0x4444444444444444444444444444444444444444"'),'{safeAddress}','"0x6666666666666666666666666666666666666666"')
    );
    raise exception 'RPC unexpectedly accepted a transaction hash already bound to another deal';
  exception when others then
    if sqlerrm not like '%W3M_PAYMENT_TRANSACTION_HASH_ALREADY_BOUND%' then raise; end if;
  end;

  begin
    perform public.w3m_finalize_deal_payment(
      '93000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001','0x' || repeat('d',64),
      (jsonb_set(jsonb_set(v_receipt,'{transactionHash}',to_jsonb('0x' || repeat('d',64))),'{safeAddress}','"0x7777777777777777777777777777777777777777"') - 'chainId')
    );
    raise exception 'RPC unexpectedly accepted a receipt without a chain ID';
  exception when others then
    if sqlerrm not like '%W3M_PAYMENT_VERIFIED_RECEIPT_MALFORMED%' then raise; end if;
  end;

  begin
    perform public.w3m_finalize_deal_payment(
      '93000000-0000-4000-8000-000000000003',
      '91000000-0000-4000-8000-000000000001','0x' || repeat('c',64),
      jsonb_set(jsonb_set(jsonb_set(v_receipt,'{transactionHash}',to_jsonb('0x' || repeat('c',64))),'{safeAddress}','"0x7777777777777777777777777777777777777777"'),'{amountBaseUnits}','"999"')
    );
    raise exception 'RPC unexpectedly accepted a mismatched payment amount';
  exception when others then
    if sqlerrm not like '%W3M_PAYMENT_AMOUNT_MISMATCH%' then raise; end if;
  end;

  select count(*) into v_count from public.blockchain_transactions
  where tx_hash='0x' || repeat('c',64);
  if v_count <> 0 then raise exception 'failed payment attempt left a transaction row behind'; end if;

  select count(*) into v_count from public.deals
  where id='93000000-0000-4000-8000-000000000003'
    and (payment_status <> 'pending' or payment_tx_hash is not null or status <> 'accepted');
  if v_count <> 0 then raise exception 'failed payment attempt partially updated the deal'; end if;
end;
$$;

rollback;
