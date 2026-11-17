-- W3M Protocol V1 — atomic buyer-win Safe refund request creation.
-- Isolated disposable-CI migration only. No production application.
-- The trusted Edge Function must authenticate the administrator, independently
-- verify canonical BNB funding/Safe facts, decode the exact MultiSend payload,
-- and obtain safeTxHash from the live Safe contract before calling this RPC.
begin;

create or replace function public.w3m_create_buyer_refund_request(
  p_deal_id uuid,
  p_actor_id uuid,
  p_intent jsonb,
  p_safe_transaction jsonb,
  p_safe_facts jsonb,
  p_funding_facts jsonb,
  p_server_authorization jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $create_refund$
declare
  v_deal public.deals%rowtype;
  v_dispute public.deal_disputes%rowtype;
  v_decision public.w3m_deal_dispute_decisions%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_existing public.w3m_buyer_refund_requests%rowtype;
  v_request_id uuid := gen_random_uuid();
  v_tx_id uuid := gen_random_uuid();
  v_safe text;
  v_buyer_wallet text;
  v_seller_wallet text;
  v_platform constant text := lower('0x2B15cC63eE3b833F502C065767695Fa2B584f8c9');
  v_token constant text := lower('0x55d398326f99059ff775485246999027b3197955');
  v_nonce bigint;
  v_block_number bigint;
  v_original numeric(38,18);
  v_refund numeric(38,18);
  v_fee numeric(38,18);
  v_funded numeric(38,18);
  v_balance numeric(38,18);
  v_now timestamptz := clock_timestamp();
  v_owners jsonb;
  v_hash text;
  v_acceptance_count integer;
  v_acceptance_role_count integer;
  v_buyer_acceptance public.w3m_deal_agreement_acceptances%rowtype;
  v_seller_acceptance public.w3m_deal_agreement_acceptances%rowtype;
begin
  if p_deal_id is null or p_actor_id is null
     or jsonb_typeof(p_intent) is distinct from 'object'
     or jsonb_typeof(p_safe_transaction) is distinct from 'object'
     or jsonb_typeof(p_safe_facts) is distinct from 'object'
     or jsonb_typeof(p_funding_facts) is distinct from 'object'
     or jsonb_typeof(p_server_authorization) is distinct from 'object' then
    raise exception 'Complete buyer refund request arguments are required' using errcode='22023';
  end if;

  if p_server_authorization->>'authorized' is distinct from 'true'
     or p_server_authorization->>'phase' is distinct from 'CREATE_REFUND_REQUEST'
     or p_server_authorization->>'deal_id' is distinct from p_deal_id::text
     or p_server_authorization->>'safe_hash_verified' is distinct from 'true'
     or p_server_authorization->>'safe_block_canonical' is distinct from 'true'
     or p_server_authorization->>'funding_receipt_verified' is distinct from 'true'
     or p_server_authorization->>'funding_block_canonical' is distinct from 'true'
     or p_server_authorization->>'payload_verified' is distinct from 'true'
     or p_server_authorization->>'agreement_acceptances_verified' is distinct from 'true'
     or lower(coalesce(p_server_authorization->>'buyer_acceptance_digest','')) !~ '^0x[0-9a-f]{64}$'
     or lower(coalesce(p_server_authorization->>'seller_acceptance_digest','')) !~ '^0x[0-9a-f]{64}$'
     or lower(coalesce(p_server_authorization->>'safe_block_hash','')) is distinct from lower(p_safe_facts->>'block_hash')
     or lower(coalesce(p_server_authorization->>'funding_block_hash','')) is distinct from lower(p_funding_facts->>'block_hash')
     or lower(coalesce(p_server_authorization->>'safe_tx_hash','')) !~ '^0x[0-9a-f]{64}$'
     or jsonb_typeof(p_server_authorization->'issues') is distinct from 'array'
     or jsonb_array_length(p_server_authorization->'issues') <> 0 then
    raise exception 'Verified canonical refund request authorization is required' using errcode='42501';
  end if;

  if p_safe_facts->>'chain_id' is distinct from '56'
     or p_safe_facts->>'threshold' is distinct from '2'
     or coalesce(p_safe_facts->>'nonce','') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_safe_facts->>'block_number','') !~ '^(0|[1-9][0-9]*)$'
     or lower(coalesce(p_safe_facts->>'block_hash','')) !~ '^0x[0-9a-f]{64}$'
     or jsonb_typeof(p_safe_facts->'owners') is distinct from 'array'
     or jsonb_array_length(p_safe_facts->'owners') <> 3
     or lower(coalesce(p_safe_facts->>'safe_address','')) !~ '^0x[0-9a-f]{40}$'
     or lower(coalesce(p_safe_facts->>'safe_tx_hash','')) is distinct from lower(p_server_authorization->>'safe_tx_hash')
     or coalesce(p_safe_facts->>'balance','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$' then
    raise exception 'Malformed canonical BNB Safe facts' using errcode='23514';
  end if;

  if p_funding_facts->>'chain_id' is distinct from '56'
     or lower(coalesce(p_funding_facts->>'token_address','')) is distinct from v_token
     or lower(coalesce(p_funding_facts->>'safe_address','')) is distinct from lower(p_safe_facts->>'safe_address')
     or coalesce(p_funding_facts->>'confirmed','') is distinct from 'true'
     or coalesce(p_funding_facts->>'confirmations','') !~ '^[1-9][0-9]*$'
     or coalesce(p_funding_facts->>'amount','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
     or lower(coalesce(p_funding_facts->>'tx_hash','')) !~ '^0x[0-9a-f]{64}$'
     or lower(coalesce(p_funding_facts->>'block_hash','')) !~ '^0x[0-9a-f]{64}$'
     or lower(coalesce(p_server_authorization->>'funding_block_hash','')) is distinct from lower(p_funding_facts->>'block_hash') then
    raise exception 'Confirmed canonical BNB funding facts are required' using errcode='23514';
  end if;

  if lower(coalesce(p_intent->>'action','')) <> 'refund_to_buyer'
     or p_intent->>'chainId' is distinct from '56'
     or coalesce(p_intent->>'decisionId','') !~ '^[0-9a-fA-F-]{36}$'
     or coalesce(p_intent->>'disputeId','') !~ '^[0-9a-fA-F-]{36}$'
     or coalesce(p_intent->>'termsHash','') !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_intent->>'decisionHash','')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_intent->>'safeAddress','')) is distinct from lower(p_safe_facts->>'safe_address')
     or coalesce(p_intent->>'safeNonce','') is distinct from p_safe_facts->>'nonce'
     or lower(coalesce(p_intent->>'tokenAddress','')) is distinct from v_token
     or lower(coalesce(p_intent->>'buyerRecipient','')) !~ '^0x[0-9a-f]{40}$'
     or coalesce(p_intent->>'originalDealAmount','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
     or coalesce(p_intent->>'buyerRefundAmount','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
     or coalesce(p_intent->>'platformFeeAmount','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
     or coalesce(p_intent->>'confirmedFundedAmount','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
     or coalesce(p_intent->>'confirmedSafeBalance','') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
     or jsonb_typeof(p_intent->'transfers') is distinct from 'array'
     or jsonb_array_length(p_intent->'transfers') <> 2 then
    raise exception 'Malformed buyer refund intent' using errcode='22023';
  end if;

  if p_safe_transaction->>'operation' is distinct from '1'
     or p_safe_transaction->>'value' is distinct from '0'
     or lower(coalesce(p_safe_transaction->>'to','')) <> '0x9641d764fc13c8b624c04430c7356c1c7c8102e2'
     or coalesce(p_safe_transaction->>'data','') !~ '^0x([0-9a-fA-F]{2})+$'
     or p_safe_transaction->>'nonce' is distinct from p_safe_facts->>'nonce'
     or p_safe_transaction->>'safeTxGas' is distinct from '0'
     or p_safe_transaction->>'baseGas' is distinct from '0'
     or p_safe_transaction->>'gasPrice' is distinct from '0'
     or lower(coalesce(p_safe_transaction->>'gasToken','')) <> '0x0000000000000000000000000000000000000000'
     or lower(coalesce(p_safe_transaction->>'refundReceiver','')) <> '0x0000000000000000000000000000000000000000' then
    raise exception 'Unsigned Safe refund transaction fields are not canonical' using errcode='23514';
  end if;

  v_safe := lower(p_safe_facts->>'safe_address');
  v_nonce := (p_safe_facts->>'nonce')::bigint;
  v_block_number := (p_safe_facts->>'block_number')::bigint;
  v_hash := lower(p_server_authorization->>'safe_tx_hash');
  v_original := (p_intent->>'originalDealAmount')::numeric;
  v_refund := (p_intent->>'buyerRefundAmount')::numeric;
  v_fee := (p_intent->>'platformFeeAmount')::numeric;
  v_funded := (p_funding_facts->>'amount')::numeric;
  v_balance := (p_safe_facts->>'balance')::numeric;
  v_owners := p_safe_facts->'owners';

  if v_original <= 0 or v_refund <= 0 or v_funded <= 0 or v_balance <= 0
     or v_refund > v_funded
     or v_funded is distinct from v_original
     or v_fee <> round(v_original * 0.075,18)
     or v_refund + v_fee <> v_funded
     or v_refund + v_fee > v_balance
     or (p_intent->>'confirmedFundedAmount')::numeric <> v_funded
     or (p_intent->>'confirmedSafeBalance')::numeric <> v_balance
     or lower(p_intent->'safeSnapshot'->>'blockHash') is distinct from lower(p_safe_facts->>'block_hash')
     or p_intent->'safeSnapshot'->>'blockNumber' is distinct from p_safe_facts->>'block_number' then
    raise exception 'Refund arithmetic or canonical Safe snapshot binding failed' using errcode='23514';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_id::text,true);
  if coalesce(public.is_admin(),false) is not true then
    raise exception 'Verified administrator required to create a Safe refund request' using errcode='42501';
  end if;

  -- Match the immutable dispute-decision RPC lock order: dispute row first,
  -- then parent deal, then refund request/transaction. Safe finalization locks
  -- only the parent deal and never takes a child-dispute lock.
  select * into v_dispute from public.deal_disputes
   where id=(p_intent->>'disputeId')::uuid and deal_id=p_deal_id for update;
  if not found then raise exception 'Dispute not found for this deal' using errcode='P0002'; end if;

  select * into v_deal from public.deals where id=p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;
  if v_deal.status is distinct from 'disputed'
     or v_deal.dispute_status is distinct from 'resolved_buyer'
     or v_deal.payment_status is distinct from 'confirmed'
     or lower(coalesce(v_deal.payment_tx_hash,'')) is distinct from lower(p_funding_facts->>'tx_hash')
     or v_deal.chain_id is distinct from 56
     or lower(coalesce(v_deal.safe_address,'')) is distinct from v_safe
     or lower(coalesce(v_deal.token_contract,'')) is distinct from v_token
     or v_deal.amount is distinct from v_original then
    raise exception 'Deal is not in the exact buyer-refund state or funding binding changed' using errcode='23514';
  end if;
  if v_dispute.status is distinct from 'resolved'
     or v_dispute.resolution is distinct from 'buyer_wins' then
    raise exception 'Buyer-win dispute decision state is not resolved' using errcode='23514';
  end if;

  select * into v_decision from public.w3m_deal_dispute_decisions
   where id=(p_intent->>'decisionId')::uuid and deal_id=p_deal_id
     and dispute_id=v_dispute.id for share;
  if not found or v_decision.outcome is distinct from 'buyer_wins'
     or v_decision.decision_hash is distinct from lower(p_intent->>'decisionHash')
     or v_decision.terms_hash is distinct from p_intent->>'termsHash'
     or v_decision.buyer_refund_amount is null
     or v_decision.buyer_refund_amount::numeric <> v_refund
     or v_decision.buyer_refund_amount is distinct from (p_intent->>'buyerRefundAmount')::numeric then
    raise exception 'Immutable buyer-win decision and exact refund amount do not match' using errcode='23514';
  end if;

  select * into v_terms from public.w3m_deal_terms_versions
   where id=v_decision.terms_version_id and deal_id=p_deal_id for share;
  if not found or v_terms.terms_hash is distinct from v_decision.terms_hash
     or v_terms.terms_version is distinct from v_decision.terms_version
     or v_terms.project_id is distinct from v_deal.project_id
     or v_terms.buyer_id is distinct from v_deal.buyer_id
     or v_terms.seller_id is distinct from v_deal.seller_id
     or v_terms.chain_id is distinct from 56
     or lower(v_terms.safe_address) is distinct from v_safe then
    raise exception 'Refund terms are not bound to the immutable deal decision' using errcode='23514';
  end if;

  if not exists (
    select 1 from public.w3m_deal_terms_versions latest
     where latest.deal_id=p_deal_id and latest.id=v_terms.id
       and latest.terms_version=(select max(t.terms_version) from public.w3m_deal_terms_versions t where t.deal_id=p_deal_id)
  ) then
    raise exception 'Refund terms are not the latest signed terms version' using errcode='23514';
  end if;

  select * into v_buyer from public.profiles where id=v_deal.buyer_id for share;
  select * into v_seller from public.profiles where id=v_deal.seller_id for share;
  if v_buyer.wallet_verified is distinct from true or v_buyer.wallet_verified_at is null
     or v_seller.wallet_verified is distinct from true or v_seller.wallet_verified_at is null
     or lower(coalesce(v_buyer.wallet_address,'')) is distinct from lower(p_intent->>'buyerRecipient')
     or lower(coalesce(v_seller.wallet_address,'')) !~ '^0x[0-9a-f]{40}$'
     or lower(v_buyer.wallet_address)=lower(v_seller.wallet_address)
     or lower(v_buyer.wallet_address)=v_platform
     or lower(v_seller.wallet_address)=v_platform then
    raise exception 'Current verified buyer/seller wallet binding failed' using errcode='42501';
  end if;
  -- Require both immutable agreement rows for the exact latest terms and current verified wallets.
  -- Cryptographic EIP-712 recovery is performed by the trusted Edge Function and
  -- attested here; SQL independently binds the stored rows and recovered digests.
  select count(*), count(distinct a.party_role) into v_acceptance_count, v_acceptance_role_count
    from public.w3m_deal_agreement_acceptances a
   where a.terms_version_id=v_terms.id and a.deal_id=p_deal_id
     and a.terms_version=v_terms.terms_version and a.chain_id=56
     and lower(a.safe_address)=v_safe and lower(a.terms_hash)=lower(v_terms.terms_hash)
     and (
       (a.party_role='buyer' and a.party_id=v_deal.buyer_id
        and lower(a.wallet_address)=lower(v_buyer.wallet_address)
        and lower(a.typed_data_digest)=lower(p_server_authorization->>'buyer_acceptance_digest'))
       or
       (a.party_role='seller' and a.party_id=v_deal.seller_id
        and lower(a.wallet_address)=lower(v_seller.wallet_address)
        and lower(a.typed_data_digest)=lower(p_server_authorization->>'seller_acceptance_digest'))
     );
  if v_acceptance_count <> 2 or v_acceptance_role_count <> 2 then
    raise exception 'Both current cryptographically verified EIP-712 agreement acceptances are required'
      using errcode='23514';
  end if;

  if (select count(distinct lower(value)) from jsonb_array_elements_text(v_owners)) <> 3
     or exists(select 1 from jsonb_array_elements_text(v_owners) x(value) where lower(x.value) !~ '^0x[0-9a-f]{40}$')
     or not (v_owners @> jsonb_build_array(lower(v_buyer.wallet_address)))
     or not (v_owners @> jsonb_build_array(lower(v_seller.wallet_address)))
     or not (v_owners @> jsonb_build_array(v_platform)) then
    raise exception 'Canonical Safe owners do not match the current verified parties' using errcode='23514';
  end if;

  if exists(select 1 from public.w3m_buyer_refund_requests r where r.deal_id=p_deal_id and r.dispute_id=v_dispute.id) then
    select * into v_existing from public.w3m_buyer_refund_requests r
     where r.deal_id=p_deal_id and r.dispute_id=v_dispute.id for update;
    if v_existing.decision_id=v_decision.id
       and v_existing.safe_tx_hash=v_hash
       and v_existing.refund_amount=v_refund
       and v_existing.platform_fee_amount=v_fee
       and v_existing.safe_nonce=v_nonce then
      return jsonb_build_object('created',true,'idempotent_replay',true,
        'request_id',v_existing.id,'safe_transaction_id',v_existing.safe_transaction_id,
        'safe_tx_hash',v_existing.safe_tx_hash,'status',v_existing.status);
    end if;
    raise exception 'A conflicting refund request already exists for this dispute' using errcode='23505';
  end if;

  if exists(select 1 from public.deal_multisig_transactions t
     where t.deal_id=p_deal_id and t.action='refund_to_buyer') then
    raise exception 'An orphaned or legacy refund Safe transaction requires reconciliation' using errcode='23514';
  end if;

  insert into public.deal_multisig_transactions(
    id,deal_id,action,amount,token_symbol,chain_id,safe_address,
    tx_hash,safe_tx_hash,safe_nonce,to_address,data,value_wei,operation,
    safe_tx_gas,base_gas,gas_price,gas_token,refund_receiver,
    signatures,confirmations_count,required_signatures,status,updated_at
  ) values (
    v_tx_id,p_deal_id,'refund_to_buyer',v_refund,'USDT',56,v_safe,
    null,v_hash,v_nonce,lower(p_safe_transaction->>'to'),lower(p_safe_transaction->>'data'),0,1,
    0,0,0,lower(p_safe_transaction->>'gasToken'),lower(p_safe_transaction->>'refundReceiver'),
    '[]'::jsonb,0,2,'awaiting_signatures',v_now
  ) returning * into v_tx;

  insert into public.w3m_buyer_refund_requests(
    id,deal_id,dispute_id,decision_id,safe_transaction_id,
    decision_hash,terms_hash,original_deal_amount,refund_amount,platform_fee_amount,
    funded_amount,safe_balance,buyer_wallet,platform_wallet,token_address,chain_id,
    safe_address,safe_nonce,safe_block_number,safe_block_hash,safe_owners,safe_threshold,
    safe_tx_hash,status,created_by,created_at
  ) values (
    v_request_id,p_deal_id,v_dispute.id,v_decision.id,v_tx.id,
    v_decision.decision_hash,v_terms.terms_hash,v_original,v_refund,v_fee,
    v_funded,v_balance,lower(v_buyer.wallet_address),v_platform,v_token,56,
    v_safe,v_nonce,v_block_number,lower(p_safe_facts->>'block_hash'),v_owners,2,
    v_hash,'awaiting_signatures',p_actor_id,v_now
  );

  insert into public.deal_audit_logs(
    deal_id,actor_id,action,old_status,new_status,metadata,created_at
  ) values (
    p_deal_id,p_actor_id,'w3m_buyer_refund_request_created',v_deal.status,v_deal.status,
    jsonb_build_object(
      'request_id',v_request_id,'decision_id',v_decision.id,
      'decision_hash',v_decision.decision_hash,'terms_hash',v_terms.terms_hash,
      'safe_transaction_id',v_tx.id,'safe_tx_hash',v_hash,
      'refund_amount',v_refund::text,'original_deal_amount',v_original::text,
      'platform_fee_amount',v_fee::text,'safe_nonce',v_nonce,
      'safe_block_number',v_block_number,'safe_block_hash',lower(p_safe_facts->>'block_hash'),
      'funding_tx_hash',lower(p_funding_facts->>'tx_hash'),
      'funding_block_hash',lower(p_funding_facts->>'block_hash'),
      'confirmed_funded_amount',v_funded::text
    ),v_now
  );

  return jsonb_build_object('created',true,'idempotent_replay',false,
    'request_id',v_request_id,'safe_transaction_id',v_tx.id,
    'safe_tx_hash',v_hash,'status','awaiting_signatures');
end;
$create_refund$;

revoke all on function public.w3m_create_buyer_refund_request(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.w3m_create_buyer_refund_request(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)
 to service_role;

comment on function public.w3m_create_buyer_refund_request(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) is
 'Atomic service-role-only buyer-win Safe refund request creation. Revalidates immutable decision, terms, verified wallets, confirmed funding facts, 2-of-3 Safe snapshot, exact fixed 7.5% original-value fee, and inserts the refund Safe transaction plus immutable request and audit row. Caller must independently verify live canonical BNB Safe hash and exact MultiSend payload. Isolated draft; not deployed.';

commit;
