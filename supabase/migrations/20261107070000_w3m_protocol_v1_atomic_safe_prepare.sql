-- W3M Protocol V1 atomic PREPARE persistence boundary.
-- Isolated draft only. Do not deploy before handler wiring/review.
-- Caller must first complete cryptographic W3M PASS and canonical BNB Safe reads.
begin;

create or replace function public.w3m_commit_safe_prepare(
  p_deal_id uuid, p_actor_id uuid, p_policy jsonb,
  p_safe_facts jsonb, p_w3m_authorization jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
#variable_conflict use_variable
declare
  d public.deals%rowtype;
  pol public.deal_release_policies%rowtype;
  tx public.deal_multisig_transactions%rowtype;
  n_policy integer;
  n_tx integer;
  n_audit integer;
  buyer_wallet text;
  seller_wallet text;
  platform_wallet constant text := '0x2B15cC63eE3b833F502C065767695Fa2B584f8c9';
  bnb_usdt constant text := '0x55d398326f99059ff775485246999027b3197955';
  safe_addr text;
  token_addr text;
  nonce_value bigint;
  amount_value numeric;
  fee_percent_value numeric;
  fee_value numeric;
  seller_net_value numeric;
  audit_metadata jsonb;
  existing_audit jsonb;
  now_value timestamptz := clock_timestamp();
begin
  if p_deal_id is null or p_actor_id is null
     or jsonb_typeof(p_policy) is distinct from 'object'
     or jsonb_typeof(p_safe_facts) is distinct from 'object'
     or jsonb_typeof(p_w3m_authorization) is distinct from 'object' then
    raise exception 'Complete PREPARE arguments are required' using errcode='22023';
  end if;

  if p_w3m_authorization->>'decision' is distinct from 'PASS'
     or p_w3m_authorization->>'deal_id' is distinct from p_deal_id::text
     or coalesce(p_w3m_authorization->>'report_id','') = ''
     or coalesce(p_w3m_authorization->>'report_hash','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_w3m_authorization->>'deal_terms_hash','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_w3m_authorization->>'report_version','') !~ '^[1-9][0-9]*$'
     or coalesce(p_w3m_authorization->>'expires_at','') = ''
     or (p_w3m_authorization->>'expires_at')::timestamptz <= now_value then
    raise exception 'Current deal-bound W3M PASS authorization required' using errcode='23514';
  end if;

  if coalesce(p_safe_facts->>'chain_id','') <> '56' or coalesce(p_safe_facts->>'threshold','') <> '2'
     or coalesce(p_safe_facts->>'nonce','') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_safe_facts->>'block_number','') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_safe_facts->>'block_hash','') !~ '^0x[0-9a-fA-F]{64}$'
     or jsonb_typeof(p_safe_facts->'owners') is distinct from 'array'
     or jsonb_array_length(p_safe_facts->'owners') <> 3 then
    raise exception 'Malformed canonical BNB Safe facts' using errcode='23514';
  end if;

  nonce_value := (p_safe_facts->>'nonce')::bigint;
  safe_addr := lower(coalesce(p_safe_facts->>'safe_address',''));
  token_addr := lower(coalesce(p_policy->>'token_contract',''));
  if safe_addr !~ '^0x[0-9a-f]{40}$' or token_addr <> lower(bnb_usdt)
     or lower(coalesce(p_policy->>'safe_address','')) <> safe_addr then
    raise exception 'Safe/token address malformed or inconsistent' using errcode='23514';
  end if;

  if coalesce(p_policy->>'chain_id','') <> '56' or coalesce(p_policy->>'token_symbol','') <> 'USDT'
     or coalesce(p_policy->>'status','') <> 'locked'
     or coalesce(p_policy->>'deal_amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
     or coalesce(p_policy->>'fee_percent','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
     or coalesce(p_policy->>'fee_amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
     or coalesce(p_policy->>'seller_net_amount','') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' then
    raise exception 'Malformed canonical USDT release policy' using errcode='23514';
  end if;
  amount_value := (p_policy->>'deal_amount')::numeric;
  fee_percent_value := (p_policy->>'fee_percent')::numeric;
  fee_value := (p_policy->>'fee_amount')::numeric;
  seller_net_value := (p_policy->>'seller_net_amount')::numeric;
  if amount_value <= 0 or fee_percent_value <> 7.5
     or fee_value <> round(amount_value * fee_percent_value / 100,18)
     or seller_net_value <> amount_value - fee_value then
    raise exception 'Exact 18-decimal fee arithmetic mismatch' using errcode='23514';
  end if;

  -- Parent-row lock serializes PREPARE without firing UPDATE triggers on deals.
  select * into d from public.deals where id=p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;
  if p_actor_id not in (d.buyer_id,d.seller_id) then
    raise exception 'Actor is not a deal participant' using errcode='42501';
  end if;
  if d.status not in ('funded','in_progress') or d.payment_status <> 'confirmed'
     or d.payment_tx_hash is null or d.payment_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or d.chain_id is distinct from 56 or lower(coalesce(d.safe_address,'')) <> safe_addr
     or lower(coalesce(d.token_contract,'')) <> token_addr
     or upper(coalesce(d.token_symbol,d.currency,'')) <> 'USDT'
     or coalesce(d.dispute_status,'') not in ('none','closed')
     or d.delivery_status <> 'accepted' or d.buyer_approved_at is null
     or d.amount is distinct from amount_value or d.platform_fee_percent is distinct from fee_percent_value then
    raise exception 'Current deal/payment/delivery/dispute/amount state is not eligible' using errcode='23514';
  end if;
  if exists(select 1 from public.deal_disputes x where x.deal_id=p_deal_id
      and lower(coalesce(x.status,'open')) not in
      ('','none','resolved','closed','dismissed','rejected','cancelled','canceled','withdrawn')) then
    raise exception 'Unresolved dispute blocks PREPARE' using errcode='23514';
  end if;

  select lower(wallet_address) into buyer_wallet from public.profiles
   where id=d.buyer_id and wallet_verified=true;
  select lower(wallet_address) into seller_wallet from public.profiles
   where id=d.seller_id and wallet_verified=true;
  if buyer_wallet is null or seller_wallet is null
     or buyer_wallet !~ '^0x[0-9a-f]{40}$' or seller_wallet !~ '^0x[0-9a-f]{40}$'
     or buyer_wallet=seller_wallet or buyer_wallet=lower(platform_wallet)
     or seller_wallet=lower(platform_wallet)
     or lower(p_policy->>'seller_wallet') is distinct from seller_wallet
     or lower(p_policy->>'platform_wallet') is distinct from lower(platform_wallet) then
    raise exception 'Verified party wallet binding failed' using errcode='23514';
  end if;
  if (select count(distinct lower(value)) from jsonb_array_elements_text(p_safe_facts->'owners')) <> 3
     or not (p_safe_facts->'owners' @> jsonb_build_array(buyer_wallet))
     or not (p_safe_facts->'owners' @> jsonb_build_array(seller_wallet))
     or not (p_safe_facts->'owners' @> jsonb_build_array(lower(platform_wallet))) then
    raise exception 'Safe owners do not match verified deal parties' using errcode='23514';
  end if;

  select count(*) into n_policy from public.deal_release_policies where deal_id=p_deal_id;
  select count(*) into n_tx from public.deal_multisig_transactions
   where deal_id=p_deal_id and action='release_to_seller';
  if n_tx > 1 then raise exception 'Duplicate release transaction rows require reconciliation' using errcode='23505'; end if;

  if n_policy=1 then
    select * into pol from public.deal_release_policies where deal_id=p_deal_id for update;
    if pol.status in ('locked','ready','released') then
      if pol.status in ('locked','ready') and pol.deal_amount=amount_value
         and pol.fee_percent=fee_percent_value and pol.fee_amount=fee_value
         and pol.seller_net_amount=seller_net_value
         and lower(pol.seller_wallet)=seller_wallet
         and lower(pol.platform_wallet)=lower(platform_wallet)
         and lower(pol.safe_address)=safe_addr and lower(pol.token_contract)=token_addr
         and pol.token_symbol='USDT' and pol.chain_id=56 and pol.safe_nonce=nonce_value
         and n_tx=1 then
        select count(*) into n_audit from public.deal_audit_logs
         where deal_id=p_deal_id and action='release_policy_locked';
        if n_audit <> 1 then
          raise exception 'Locked policy audit binding is missing or duplicated' using errcode='23514';
        end if;
        select metadata into existing_audit from public.deal_audit_logs
         where deal_id=p_deal_id and action='release_policy_locked';
        if existing_audit->>'w3m_report_id' is distinct from p_w3m_authorization->>'report_id'
           or existing_audit->>'w3m_report_version' is distinct from p_w3m_authorization->>'report_version'
           or existing_audit->>'w3m_report_hash' is distinct from p_w3m_authorization->>'report_hash'
           or existing_audit->>'w3m_deal_terms_hash' is distinct from p_w3m_authorization->>'deal_terms_hash' then
          raise exception 'Locked policy W3M report binding changed; reconciliation required' using errcode='23514';
        end if;
        select * into tx from public.deal_multisig_transactions
         where deal_id=p_deal_id and action='release_to_seller' for update;
        if tx.amount=seller_net_value and tx.token_symbol='USDT'
           and tx.chain_id=56 and lower(tx.safe_address)=safe_addr and tx.safe_nonce=nonce_value then
          return jsonb_build_object('committed',true,'idempotent_replay',true,
            'policy_id',pol.id,'transaction_id',tx.id,'status',tx.status);
        end if;
      end if;
      raise exception 'Locked policy is immutable; changed binding requires recovery' using errcode='23514';
    end if;
    if pol.status <> 'pending' then raise exception 'Policy status is not PREPARE eligible' using errcode='23514'; end if;
  end if;

  if n_tx=1 then
    select * into tx from public.deal_multisig_transactions
     where deal_id=p_deal_id and action='release_to_seller' for update;
    if tx.safe_tx_hash is not null or tx.tx_hash is not null
       or tx.status in ('signed','submitted','confirmed','cancelled')
       or tx.confirmations_count <> 0 or tx.signatures <> '[]'::jsonb then
      raise exception 'Existing signed/terminal transaction is immutable' using errcode='23514';
    end if;
  end if;

  audit_metadata := jsonb_build_object(
    'fee_percent',fee_percent_value,'fee_amount',fee_value,'seller_net_amount',seller_net_value,
    'seller_wallet',seller_wallet,'platform_wallet',lower(platform_wallet),
    'safe_address',safe_addr,'token_contract',token_addr,'token_symbol','USDT',
    'chain_id',56,'safe_nonce',nonce_value,
    'safe_block_number',(p_safe_facts->>'block_number')::bigint,
    'safe_block_hash',lower(p_safe_facts->>'block_hash'),
    'safe_owners',p_safe_facts->'owners','safe_threshold',2,
    'w3m_report_id',p_w3m_authorization->>'report_id',
    'w3m_report_version',(p_w3m_authorization->>'report_version')::integer,
    'w3m_report_hash',p_w3m_authorization->>'report_hash',
    'w3m_deal_terms_hash',p_w3m_authorization->>'deal_terms_hash'
  );

  if n_policy=0 then
    insert into public.deal_release_policies(
      id,deal_id,deal_amount,fee_percent,fee_amount,seller_net_amount,seller_wallet,
      platform_wallet,safe_address,token_contract,token_symbol,chain_id,safe_nonce,
      status,locked_at,updated_at
    ) values(gen_random_uuid(),p_deal_id,amount_value,fee_percent_value,fee_value,seller_net_value,
      seller_wallet,lower(platform_wallet),safe_addr,token_addr,'USDT',56,nonce_value,
      'locked',now_value,now_value) returning * into pol;
  else
    update public.deal_release_policies set deal_amount=amount_value,
      fee_percent=fee_percent_value,fee_amount=fee_value,seller_net_amount=seller_net_value,
      seller_wallet=seller_wallet,platform_wallet=lower(platform_wallet),safe_address=safe_addr,
      token_contract=token_addr,token_symbol='USDT',chain_id=56,safe_nonce=nonce_value,
      status='locked',locked_at=now_value,updated_at=now_value
     where deal_id=p_deal_id returning * into pol;
  end if;

  if n_tx=0 then
    insert into public.deal_multisig_transactions(
      id,deal_id,action,amount,token_symbol,chain_id,safe_address,required_signatures,status,safe_nonce
    ) values(gen_random_uuid(),p_deal_id,'release_to_seller',seller_net_value,'USDT',56,safe_addr,2,
      'awaiting_signatures',nonce_value) returning * into tx;
  else
    update public.deal_multisig_transactions set amount=seller_net_value,token_symbol='USDT',
      chain_id=56,safe_address=safe_addr,required_signatures=2,
      status='awaiting_signatures',safe_nonce=nonce_value,updated_at=now_value
     where id=tx.id returning * into tx;
  end if;

  insert into public.deal_audit_logs(deal_id,actor_id,action,old_status,new_status,metadata)
   values(p_deal_id,p_actor_id,'release_policy_locked',d.status,d.status,audit_metadata);

  return jsonb_build_object('committed',true,'idempotent_replay',false,
    'policy_id',pol.id,'transaction_id',tx.id,'status',tx.status);
end;
$fn$;

revoke all on function public.w3m_commit_safe_prepare(uuid,uuid,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.w3m_commit_safe_prepare(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
comment on function public.w3m_commit_safe_prepare(uuid,uuid,jsonb,jsonb,jsonb) is
 'Atomic service-role-only W3M PREPARE persistence. Caller must verify signed W3M PASS and live canonical BNB Safe facts. Isolated draft; not deployed.';

-- Enforce the V1 success-fee rule for all newly inserted or updated release policies.
-- NOT VALID preserves legacy rows for explicit reconciliation while blocking new deviations.
alter table public.deal_release_policies
  add constraint deal_release_policies_w3m_v1_fee_percent_check
  check (fee_percent = 7.5) not valid;
commit;