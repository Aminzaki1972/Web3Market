-- Disposable PostgreSQL tests for W3M atomic Safe SIGN persistence only.
\set ON_ERROR_STOP on
begin;

insert into public.projects(id,owner_id,status) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','active');
insert into public.profiles(id,wallet_address,wallet_verified,wallet_verified_at) values
('11111111-1111-4111-8111-111111111111','0x1111111111111111111111111111111111111111',true,now()),
('33333333-3333-4333-8333-333333333333','0x3333333333333333333333333333333333333333',true,now());
insert into public.deals(
 id,project_id,buyer_id,seller_id,amount,currency,token_symbol,
 payment_status,payment_tx_hash,delivery_status,buyer_approved_at,
 dispute_status,chain_id,safe_address,token_contract,status
) values (
 '22222222-2222-4222-8222-222222222222',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333',
 100,'USDT','USDT','confirmed','0x' || repeat('a',64),
 'accepted',now(),'none',56,
 '0x4444444444444444444444444444444444444444',
 '0x5555555555555555555555555555555555555555','funded'
);
insert into public.deal_multisig_transactions(
 id,deal_id,action,status,safe_tx_hash,chain_id,safe_address,safe_nonce,
 required_signatures,confirmations_count,signatures
) values (
 '66666666-6666-4666-8666-666666666666',
 '22222222-2222-4222-8222-222222222222',
 'release_to_seller','awaiting_signatures','0x' || repeat('b',64),56,
 '0x4444444444444444444444444444444444444444',7,2,0,'[]'::jsonb
);

-- RPC privilege is restricted to service_role.
do $privileges$
begin
 if has_function_privilege('anon',
   'public.w3m_record_safe_release_signature(uuid,uuid,text,text,text,text,jsonb)','EXECUTE')
 then raise exception 'anon unexpectedly has SIGN RPC execute'; end if;
 if has_function_privilege('authenticated',
   'public.w3m_record_safe_release_signature(uuid,uuid,text,text,text,text,jsonb)','EXECUTE')
 then raise exception 'authenticated unexpectedly has SIGN RPC execute'; end if;
 if not has_function_privilege('service_role',
   'public.w3m_record_safe_release_signature(uuid,uuid,text,text,text,text,jsonb)','EXECUTE')
 then raise exception 'service_role lacks SIGN RPC execute'; end if;
end;
$privileges$;

-- Valid first signature: one signer, one transaction update, one audit row.
do $first$
declare r jsonb;
begin
 r := public.w3m_record_safe_release_signature(
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '0x' || repeat('b',64),
  '0x' || repeat('c',130),
  '0x1111111111111111111111111111111111111111',
  'buyer',
  jsonb_build_object('authorized',true,'phase','SIGN',
   'deal_id','22222222-2222-4222-8222-222222222222',
   'safe_tx_hash','0x' || repeat('b',64),'issues','[]'::jsonb,
   'report_id','77777777-7777-4777-8777-777777777777',
   'report_version',1,'report_hash',repeat('d',64))
 );
 if r->>'recorded' <> 'true' or r->>'idempotent_replay' <> 'false'
    or r->>'confirmations_count' <> '1' or r->>'status' <> 'awaiting_signatures'
 then raise exception 'Unexpected first SIGN result: %',r; end if;
 if (select count(*) from public.deal_multisig_signers where deal_id='22222222-2222-4222-8222-222222222222') <> 1
 then raise exception 'First signer row was not persisted exactly once'; end if;
 if (select confirmations_count from public.deal_multisig_transactions where id='66666666-6666-4666-8666-666666666666') <> 1
 then raise exception 'Transaction confirmation count was not updated'; end if;
end;
$first$;

-- Exact replay is idempotent and does not duplicate audit.
do $replay$
declare r jsonb; n integer;
begin
 select count(*) into n from public.deal_audit_logs where action='w3m_safe_signature_recorded';
 r := public.w3m_record_safe_release_signature(
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '0x' || repeat('b',64),
  '0x' || repeat('c',130),
  '0x1111111111111111111111111111111111111111',
  'buyer',
  jsonb_build_object('authorized',true,'phase','SIGN',
   'deal_id','22222222-2222-4222-8222-222222222222',
   'safe_tx_hash','0x' || repeat('b',64),'issues','[]'::jsonb,
   'report_id','77777777-7777-4777-8777-777777777777',
   'report_version',1,'report_hash',repeat('d',64))
 );
 if r->>'idempotent_replay' <> 'true' or r->>'confirmations_count' <> '1'
 then raise exception 'Exact replay was not idempotent: %',r; end if;
 if (select count(*) from public.deal_audit_logs where action='w3m_safe_signature_recorded') <> n
 then raise exception 'Idempotent replay created a duplicate audit event'; end if;
end;
$replay$;

-- Second participant reaches threshold atomically.
do $second$
declare r jsonb;
begin
 r := public.w3m_record_safe_release_signature(
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '0x' || repeat('b',64),
  '0x' || repeat('e',130),
  '0x3333333333333333333333333333333333333333',
  'seller',
  jsonb_build_object('authorized',true,'phase','SIGN',
   'deal_id','22222222-2222-4222-8222-222222222222',
   'safe_tx_hash','0x' || repeat('b',64),'issues','[]'::jsonb,
   'report_id','77777777-7777-4777-8777-777777777777',
   'report_version',1,'report_hash',repeat('d',64))
 );
 if r->>'confirmations_count' <> '2' or r->>'status' <> 'signed'
 then raise exception 'Second signature did not reach threshold: %',r; end if;
 if (select status from public.deal_multisig_transactions where id='66666666-6666-4666-8666-666666666666') <> 'signed'
 then raise exception 'Safe transaction status did not become signed'; end if;
end;
$second$;

-- A stale W3M hash cannot persist a signature.
do $blocked$
begin
 begin
  perform public.w3m_record_safe_release_signature(
   '22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111',
   '0x' || repeat('b',64),
   '0x' || repeat('f',130),
   '0x1111111111111111111111111111111111111111',
   'buyer',
   jsonb_build_object('authorized',false,'phase','SIGN',
    'deal_id','22222222-2222-4222-8222-222222222222',
    'safe_tx_hash','0x' || repeat('b',64),'issues',jsonb_build_array('REPORT_STALE'),
    'report_id','77777777-7777-4777-8777-777777777777',
    'report_version',1,'report_hash',repeat('d',64))
  );
  raise exception 'Expected stale authorization to be rejected';
 exception when insufficient_privilege then null;
 end;
end;
$blocked$;

rollback;
