-- Isolated SQL contract tests for immutable EIP-712 deal agreement persistence.
-- This file runs only against the disposable PostgreSQL database in CI.
begin;

do $test$
declare
  v_deal uuid := '81000000-0000-4000-8000-000000000001';
  v_project uuid := '82000000-0000-4000-8000-000000000002';
  v_buyer uuid := '83000000-0000-4000-8000-000000000003';
  v_seller uuid := '84000000-0000-4000-8000-000000000004';
  v_hash text := repeat('a',64);
  v_digest_buyer text := '0x' || repeat('b',64);
  v_digest_seller text := '0x' || repeat('c',64);
  v_sig_buyer text := '0x' || repeat('d',130);
  v_sig_seller text := '0x' || repeat('e',130);
  v_canonical jsonb;
  v_version jsonb;
  v_accept jsonb;
  v_version_id uuid;
  v_snapshot jsonb;
begin
  insert into public.projects(id,owner_id,status)
    values (v_project,v_seller,'active');
  insert into public.profiles(id,wallet_address,wallet_verified,wallet_verified_at)
    values
      (v_buyer,'0x5555555555555555555555555555555555555555',true,now()),
      (v_seller,'0x4444444444444444444444444444444444444444',true,now());
  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,expected_amount,
    payment_status,delivery_status,chain_id,safe_address,token_contract,token_symbol
  ) values (
    v_deal,v_project,v_buyer,v_seller,100,'USDT',100,
    'confirmed','accepted',56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333','USDT'
  );
  insert into public.deal_release_policies(
    id,deal_id,status,chain_id,safe_address,token_contract,deal_amount,
    seller_wallet,platform_wallet,seller_net_amount,fee_amount,fee_percent,safe_nonce,token_symbol
  ) values (
    '85000000-0000-4000-8000-000000000005',v_deal,'locked',56,
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',100,
    '0x4444444444444444444444444444444444444444',
    '0x2B15cC63eE3b833F502C065767695Fa2B584f8c9',
    92.5,7.5,7.5,7,'USDT'
  );

  -- One wallet cannot represent both buyer and seller consent.
  update public.profiles
     set wallet_address='0x4444444444444444444444444444444444444444'
   where id=v_buyer;
  begin
    perform public.w3m_register_deal_terms_version(v_deal,v_hash,'{}'::jsonb);
    raise exception 'Terms version was registered with the same buyer and seller wallet';
  exception when check_violation then null;
  end;
  update public.profiles
     set wallet_address='0x5555555555555555555555555555555555555555'
   where id=v_buyer;

  v_canonical := jsonb_build_object(
    'protocol','W3M Protocol V1','dealId',v_deal::text,'projectId',v_project::text,
    'buyerId',v_buyer::text,'sellerId',v_seller::text,'amount','100',
    'currency','USDT','expectedAmount','100','chainId',56,
    'safeAddress','0x2222222222222222222222222222222222222222',
    'tokenContract','0x3333333333333333333333333333333333333333',
    'releasePolicy',jsonb_build_object(
      'dealAmount','100','feePercent','7.5','feeAmount','7.5',
      'sellerNetAmount','92.5','chainId',56,
      'safeAddress','0x2222222222222222222222222222222222222222',
      'tokenContract','0x3333333333333333333333333333333333333333',
      'sellerWallet','0x4444444444444444444444444444444444444444',
      'platformWallet','0x2b15cc63ee3b833f502c065767695fa2b584f8c9',
      'safeNonce','7','status','locked'
    )
  );

  if public.w3m_normalize_numeric_text(100.000000::numeric) <> '100'
     or public.w3m_normalize_numeric_text(7.500000::numeric) <> '7.5' then
    raise exception 'Canonical numeric normalization did not match TypeScript decimal normalization';
  end if;

  v_version := public.w3m_register_deal_terms_version(v_deal,v_hash,v_canonical);
  if v_version->>'terms_version' <> '1'
     or coalesce((v_version->>'idempotent_replay')::boolean,true) then
    raise exception 'First terms version was not created';
  end if;
  v_version_id := (v_version->>'terms_version_id')::uuid;

  v_version := public.w3m_register_deal_terms_version(v_deal,v_hash,v_canonical);
  if v_version->>'terms_version' <> '1'
     or coalesce((v_version->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Identical terms did not reuse the same version';
  end if;

  v_accept := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
    v_hash,v_canonical,v_digest_buyer,v_sig_buyer
  );
  if coalesce((v_accept->>'accepted')::boolean,false) is not true
     or coalesce((v_accept->>'idempotent_replay')::boolean,true) then
    raise exception 'Buyer agreement signature was not inserted';
  end if;

  v_accept := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'seller',v_seller,'0x4444444444444444444444444444444444444444',
    v_hash,v_canonical,v_digest_seller,v_sig_seller
  );
  if coalesce((v_accept->>'accepted')::boolean,false) is not true then
    raise exception 'Seller agreement signature was not inserted';
  end if;

  v_accept := public.w3m_insert_deal_agreement_acceptance(
    v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
    v_hash,v_canonical,v_digest_buyer,v_sig_buyer
  );
  if coalesce((v_accept->>'idempotent_replay')::boolean,false) is not true then
    raise exception 'Exact duplicate signature was not idempotent';
  end if;

  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      v_hash,v_canonical,v_digest_buyer,'0x' || repeat('f',130)
    );
    raise exception 'Conflicting duplicate party signature was accepted';
  exception when unique_violation then null;
  end;

  if (select count(*) from public.w3m_deal_agreement_acceptances
      where deal_id=v_deal and terms_version=1) <> 2 then
    raise exception 'Expected exactly one buyer and one seller acceptance';
  end if;

  v_snapshot := public.w3m_read_deal_agreement_signing_snapshot(v_deal);
  if v_snapshot->'deal'->>'id' <> v_deal::text
     or v_snapshot->'buyer_profile'->>'wallet_address' <> '0x5555555555555555555555555555555555555555'
     or v_snapshot->'policy'->>'safe_nonce' <> '7' then
    raise exception 'Private agreement signing snapshot did not return the exact server-side party and policy facts';
  end if;

  v_snapshot := public.w3m_read_safe_execution_snapshot(v_deal);
  if v_snapshot->>'agreement_binding_supported' <> 'true'
     or v_snapshot->'terms_version'->>'terms_version' <> '1'
     or jsonb_array_length(v_snapshot->'agreement_acceptances') <> 2 then
    raise exception 'Safe execution snapshot did not expose both immutable agreement signatures';
  end if;

  update public.deals set amount=101 where id=v_deal;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,1,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      v_hash,v_canonical,v_digest_buyer,v_sig_buyer
    );
    raise exception 'Old acceptance was replayed after terms changed';
  exception when check_violation then null;
  end;

  update public.deal_release_policies
     set deal_amount=101, fee_amount=7.575, seller_net_amount=93.425
   where deal_id=v_deal;
  v_canonical := jsonb_set(v_canonical,'{amount}',to_jsonb('101'::text));
  v_canonical := jsonb_set(v_canonical,'{expectedAmount}',to_jsonb('100'::text));
  v_canonical := jsonb_set(v_canonical,'{releasePolicy,dealAmount}',to_jsonb('101'::text));
  v_canonical := jsonb_set(v_canonical,'{releasePolicy,feeAmount}',to_jsonb('7.575'::text));
  v_canonical := jsonb_set(v_canonical,'{releasePolicy,sellerNetAmount}',to_jsonb('93.425'::text));
  v_version := public.w3m_register_deal_terms_version(v_deal,repeat('b',64),v_canonical);
  if v_version->>'terms_version' <> '2'
     or coalesce((v_version->>'idempotent_replay')::boolean,true) then
    raise exception 'Changed terms did not create a new immutable version';
  end if;
  if (select count(*) from public.w3m_deal_agreement_acceptances
      where deal_id=v_deal and terms_version=1) <> 2 then
    raise exception 'Prior signed version was not preserved as immutable history';
  end if;

  -- The second version cannot be accepted if project ownership drifts after
  -- its canonical terms were registered.
  update public.projects set owner_id=v_buyer where id=v_project;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed after project ownership changed';
  exception when check_violation then null;
  end;
  update public.projects set owner_id=v_seller where id=v_project;

  -- Even if only one party is signing, both current verified wallets must remain distinct.
  update public.profiles
     set wallet_address='0x5555555555555555555555555555555555555555'
   where id=v_seller;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed with shared buyer and seller wallet';
  exception when insufficient_privilege then null;
  end;
  update public.profiles
     set wallet_address='0x4444444444444444444444444444444444444444'
   where id=v_seller;

  -- A chain or Safe policy change after version creation must also veto acceptance.
  update public.deals set chain_id=97 where id=v_deal;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed after chain changed';
  exception when check_violation then null;
  end;
  update public.deals set chain_id=56 where id=v_deal;

  update public.deal_release_policies
     set safe_address='0x9999999999999999999999999999999999999999'
   where deal_id=v_deal;
  begin
    perform public.w3m_insert_deal_agreement_acceptance(
      v_deal,2,'buyer',v_buyer,'0x5555555555555555555555555555555555555555',
      repeat('b',64),v_canonical,'0x' || repeat('a',64),'0x' || repeat('d',130)
    );
    raise exception 'Agreement acceptance was allowed after Safe policy changed';
  exception when check_violation then null;
  end;

  if has_function_privilege('anon','public.w3m_register_deal_terms_version(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_register_deal_terms_version(uuid,text,jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_register_deal_terms_version(uuid,text,jsonb)','EXECUTE') then
    raise exception 'Terms-version RPC is not service-role-only';
  end if;
  if has_function_privilege('anon','public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)','EXECUTE') then
    raise exception 'Agreement acceptance RPC is not service-role-only';
  end if;
  if has_function_privilege('anon','public.w3m_read_deal_agreement_signing_snapshot(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.w3m_read_deal_agreement_signing_snapshot(uuid)','EXECUTE')
     or not has_function_privilege('service_role','public.w3m_read_deal_agreement_signing_snapshot(uuid)','EXECUTE') then
    raise exception 'Private signing snapshot RPC is not service-role-only';
  end if;
  if has_table_privilege('authenticated','public.w3m_deal_agreement_acceptances','SELECT')
     or has_table_privilege('authenticated','public.w3m_deal_agreement_acceptances','INSERT')
     or has_table_privilege('service_role','public.w3m_deal_agreement_acceptances','INSERT') then
    raise exception 'Direct table access bypasses the restricted agreement RPC';
  end if;
end;
$test$;

rollback;
