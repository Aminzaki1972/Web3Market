-- Disposable PostgreSQL integration tests for atomic W3M PREPARE.
-- The workflow applies only to its ephemeral PostgreSQL service.
do $test$
declare
  v_deal_id constant uuid := '82000000-0000-4000-8000-000000000001';
  buyer_id constant uuid := '82000000-0000-4000-8000-000000000002';
  seller_id constant uuid := '82000000-0000-4000-8000-000000000003';
  actor_id constant uuid := '82000000-0000-4000-8000-000000000002';
  policy jsonb := jsonb_build_object(
    'deal_amount','100','fee_percent','7.5','fee_amount','7.5',
    'seller_net_amount','92.5','seller_wallet','0x2222222222222222222222222222222222222222',
    'platform_wallet','0x2b15cc63ee3b833f502c065767695fa2b584f8c9',
    'safe_address','0x4444444444444444444444444444444444444444',
    'token_contract','0x55d398326f99059ff775485246999027b3197955',
    'token_symbol','USDT','chain_id','56','status','locked'
  );
  safe_facts jsonb := jsonb_build_object(
    'chain_id','56','threshold','2','nonce','7','block_number','90000000',
    'block_hash','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'safe_address','0x4444444444444444444444444444444444444444',
    'owners',jsonb_build_array(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x2b15cc63ee3b833f502c065767695fa2b584f8c9'
    )
  );
  auth jsonb := jsonb_build_object(
    'decision','PASS','deal_id','82000000-0000-4000-8000-000000000001',
    'report_id','w3m-test-report-1','report_version','1',
    'report_hash',repeat('b',64),'deal_terms_hash',repeat('c',64),
    'expires_at','2099-01-01T00:00:00Z'
  );
  result jsonb;
  policy_count integer;
  tx_count integer;
  audit_count integer;
begin
  insert into public.projects(id,owner_id,status)
   values('82000000-0000-4000-8000-000000000004',seller_id,'active');
  insert into public.profiles(id,wallet_address,wallet_verified)
   values(buyer_id,'0x1111111111111111111111111111111111111111',true),
         (seller_id,'0x2222222222222222222222222222222222222222',true);
  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,status,payment_status,
    payment_tx_hash,delivery_status,buyer_approved_at,dispute_status,chain_id,
    safe_address,token_contract,token_symbol,delivery_accepted_at
  ) values(
    v_deal_id,'82000000-0000-4000-8000-000000000004',buyer_id,seller_id,100,'USDT',
    'funded','confirmed','0x' || repeat('d',64),'accepted',now(),'none',56,
    '0x4444444444444444444444444444444444444444',
    '0x55d398326f99059ff775485246999027b3197955','USDT',now()
  );

  -- A deal configured with a non-V1 commission must be rejected before any PREPARE writes.
  update public.deals set platform_fee_percent=8 where id=v_deal_id;
  policy := jsonb_set(policy,'{fee_percent}',to_jsonb('8'::text));
  policy := jsonb_set(policy,'{fee_amount}',to_jsonb('8'::text));
  policy := jsonb_set(policy,'{seller_net_amount}',to_jsonb('92'::text));
  begin
    perform public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
    raise exception 'Non-V1 8% success fee unexpectedly accepted';
  exception when check_violation then null;
  end;
  if exists(select 1 from public.deal_release_policies where deal_id=v_deal_id)
     or exists(select 1 from public.deal_multisig_transactions where deal_id=v_deal_id and action='release_to_seller') then
    raise exception 'Rejected fee policy left partial PREPARE rows';
  end if;
  update public.deals set platform_fee_percent=7.5 where id=v_deal_id;
  policy := jsonb_set(policy,'{fee_percent}',to_jsonb('7.5'::text));
  policy := jsonb_set(policy,'{fee_amount}',to_jsonb('7.5'::text));
  policy := jsonb_set(policy,'{seller_net_amount}',to_jsonb('92.5'::text));

  result := public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
  if result->>'committed' <> 'true' or result->>'idempotent_replay' <> 'false' then
    raise exception 'First PREPARE call did not commit exactly once: %',result;
  end if;
  select count(*) into policy_count from public.deal_release_policies where deal_id=v_deal_id;
  select count(*) into tx_count from public.deal_multisig_transactions
    where deal_id=v_deal_id and action='release_to_seller';
  select count(*) into audit_count from public.deal_audit_logs
    where deal_id=v_deal_id and action='release_policy_locked';
  if policy_count<>1 or tx_count<>1 or audit_count<>1 then
    raise exception 'Atomic PREPARE did not write exactly one policy/transaction/audit row';
  end if;

  result := public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
  if result->>'idempotent_replay' <> 'true' then
    raise exception 'Identical retry must be idempotent: %',result;
  end if;
  select count(*) into audit_count from public.deal_audit_logs
    where deal_id=v_deal_id and action='release_policy_locked';
  if audit_count<>1 then raise exception 'Idempotent retry duplicated audit record'; end if;

  auth := jsonb_set(auth,'{report_hash}',to_jsonb(repeat('9',64)));
  begin
    perform public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
    raise exception 'Changed W3M report binding unexpectedly accepted on replay';
  exception when check_violation then null;
  end;
  auth := jsonb_set(auth,'{report_hash}',to_jsonb(repeat('b',64)));

  policy := jsonb_set(policy,'{token_contract}','"0x5555555555555555555555555555555555555555"'::jsonb);
  begin
    perform public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
    raise exception 'Non-canonical token contract unexpectedly accepted';
  exception when check_violation then null;
  end;
  policy := jsonb_set(policy,'{token_contract}','"0x55d398326f99059ff775485246999027b3197955"'::jsonb);

  update public.deals set dispute_status=null where id=v_deal_id;
  begin
    perform public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
    raise exception 'Null dispute state unexpectedly accepted';
  exception when check_violation then null;
  end;
  update public.deals set dispute_status='none' where id=v_deal_id;

  update public.deal_multisig_transactions set status='signed'
   where deal_id=v_deal_id and action='release_to_seller';
  result := public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
  if result->>'idempotent_replay' <> 'true' or result->>'status' <> 'signed' then
    raise exception 'Signed transaction must be preserved on identical retry';
  end if;

  safe_facts := jsonb_set(safe_facts,'{nonce}','"8"'::jsonb);
  begin
    perform public.w3m_commit_safe_prepare(v_deal_id,actor_id,policy,safe_facts,auth);
    raise exception 'Changed Safe nonce unexpectedly accepted';
  exception when check_violation then null;
  end;
  if (select status from public.deal_multisig_transactions
       where deal_id=v_deal_id and action='release_to_seller') <> 'signed' then
    raise exception 'Changed nonce altered a signed transaction';
  end if;

  if not has_function_privilege('service_role',
       'public.w3m_commit_safe_prepare(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
     or has_function_privilege('anon',
       'public.w3m_commit_safe_prepare(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_commit_safe_prepare(uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE') then
    raise exception 'Atomic PREPARE RPC is not service-role-only';
  end if;
end;
$test$;

-- Force the third write to fail and prove policy + transaction writes roll back.
create or replace function public.w3m_test_reject_prepare_audit()
returns trigger language plpgsql as $trigger$
begin
  if new.action='release_policy_locked' then
    raise exception 'injected audit failure';
  end if;
  return new;
end;
$trigger$;
create trigger w3m_test_reject_prepare_audit
before insert on public.deal_audit_logs
for each row execute function public.w3m_test_reject_prepare_audit();

do $rollback_test$
declare
  v_deal_id constant uuid := '82000000-0000-4000-8000-000000000011';
  buyer_id constant uuid := '82000000-0000-4000-8000-000000000012';
  seller_id constant uuid := '82000000-0000-4000-8000-000000000013';
  policy jsonb := jsonb_build_object(
    'deal_amount','100','fee_percent','7.5','fee_amount','7.5','seller_net_amount','92.5',
    'seller_wallet','0x2222222222222222222222222222222222222222',
    'platform_wallet','0x2b15cc63ee3b833f502c065767695fa2b584f8c9',
    'safe_address','0x4444444444444444444444444444444444444444',
    'token_contract','0x55d398326f99059ff775485246999027b3197955',
    'token_symbol','USDT','chain_id','56','status','locked');
  facts jsonb := jsonb_build_object(
    'chain_id','56','threshold','2','nonce','9','block_number','90000001',
    'block_hash','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'safe_address','0x4444444444444444444444444444444444444444',
    'owners',jsonb_build_array('0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x2b15cc63ee3b833f502c065767695fa2b584f8c9'));
  auth jsonb := jsonb_build_object('decision','PASS','deal_id',v_deal_id::text,
    'report_id','w3m-test-report-rollback','report_version','1',
    'report_hash',repeat('e',64),'deal_terms_hash',repeat('f',64),
    'expires_at','2099-01-01T00:00:00Z');
begin
  insert into public.projects(id,owner_id,status)
   values('82000000-0000-4000-8000-000000000014',seller_id,'active');
  insert into public.profiles(id,wallet_address,wallet_verified)
   values(buyer_id,'0x1111111111111111111111111111111111111111',true),
         (seller_id,'0x2222222222222222222222222222222222222222',true);
  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,status,payment_status,
    payment_tx_hash,delivery_status,buyer_approved_at,dispute_status,chain_id,
    safe_address,token_contract,token_symbol,delivery_accepted_at
  ) values(v_deal_id,'82000000-0000-4000-8000-000000000014',buyer_id,seller_id,100,'USDT',
    'funded','confirmed','0x' || repeat('d',64),'accepted',now(),'none',56,
    '0x4444444444444444444444444444444444444444',
    '0x55d398326f99059ff775485246999027b3197955','USDT',now());

  begin
    perform public.w3m_commit_safe_prepare(v_deal_id,buyer_id,policy,facts,auth);
    raise exception 'Injected audit failure did not abort PREPARE';
  exception when others then
    if sqlerrm='Injected audit failure did not abort PREPARE' then raise; end if;
  end;
  if exists(select 1 from public.deal_release_policies where deal_id=v_deal_id)
     or exists(select 1 from public.deal_multisig_transactions where deal_id=v_deal_id and action='release_to_seller')
     or exists(select 1 from public.deal_audit_logs where deal_id=v_deal_id and action='release_policy_locked') then
    raise exception 'Partial PREPARE writes survived audit failure';
  end if;
end;
$rollback_test$;

drop trigger w3m_test_reject_prepare_audit on public.deal_audit_logs;
drop function public.w3m_test_reject_prepare_audit();
