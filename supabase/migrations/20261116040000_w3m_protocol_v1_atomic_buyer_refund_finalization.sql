-- W3M Protocol V1 — atomic buyer-refund receipt finalization.
-- Isolated CI migration only. Never apply to production without a separately approved release.
begin;

create table public.w3m_buyer_refund_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.w3m_buyer_refund_requests(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  dispute_id uuid not null references public.deal_disputes(id) on delete restrict,
  decision_id uuid not null references public.w3m_deal_dispute_decisions(id) on delete restrict,
  safe_transaction_id uuid not null references public.deal_multisig_transactions(id) on delete restrict,
  decision_hash text not null check (decision_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  safe_tx_hash text not null check (safe_tx_hash ~ '^0x[0-9a-f]{64}$'),
  broadcast_tx_hash text not null unique check (broadcast_tx_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id integer not null check (chain_id = 56),
  safe_address text not null check (safe_address ~ '^0x[0-9a-f]{40}$'),
  token_address text not null check (token_address = lower('0x55d398326f99059ff775485246999027b3197955')),
  buyer_wallet text not null check (buyer_wallet ~ '^0x[0-9a-f]{40}$'),
  buyer_refund_amount numeric(38,18) not null check (buyer_refund_amount > 0),
  platform_wallet text not null check (platform_wallet = lower('0x2b15cc63ee3b833f502c065767695fa2b584f8c9')),
  platform_fee_amount numeric(38,18) not null check (platform_fee_amount > 0),
  receipt_block_number text not null check (receipt_block_number ~ '^0x[0-9a-f]+$'),
  receipt_block_hash text not null check (receipt_block_hash ~ '^0x[0-9a-f]{64}$'),
  confirmations integer not null check (confirmations >= 1),
  execution_success boolean not null check (execution_success),
  verified_receipt jsonb not null check (jsonb_typeof(verified_receipt) = 'object'),
  server_authorization jsonb not null check (jsonb_typeof(server_authorization) = 'object'),
  finalized_by uuid not null references auth.users(id) on delete restrict,
  finalized_at timestamptz not null default clock_timestamp(),
  check (buyer_refund_amount + platform_fee_amount > 0)
);
create index w3m_buyer_refund_receipts_deal_idx
  on public.w3m_buyer_refund_receipts(deal_id, finalized_at desc);

alter table public.w3m_buyer_refund_receipts enable row level security;
revoke all on table public.w3m_buyer_refund_receipts from public, anon, authenticated, service_role;
grant select on table public.w3m_buyer_refund_receipts to service_role;

create trigger w3m_buyer_refund_receipts_immutable
before update or delete or truncate on public.w3m_buyer_refund_receipts
for each statement execute function public.w3m_reject_buyer_refund_registry_mutation();

comment on table public.w3m_buyer_refund_receipts is
  'Append-only server-attested canonical BNB Safe buyer-refund receipts. The receipt row is the authoritative finalization ledger; request rows remain immutable.';

create or replace function public.w3m_finalize_buyer_refund(
  p_actor_id uuid,
  p_deal_id uuid,
  p_request_id uuid,
  p_decision_id uuid,
  p_decision_hash text,
  p_terms_hash text,
  p_safe_tx_hash text,
  p_broadcast_tx_hash text,
  p_verified_receipt jsonb,
  p_server_authorization jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $finalize_refund$
declare
  v_request public.w3m_buyer_refund_requests%rowtype;
  v_deal public.deals%rowtype;
  v_dispute public.deal_disputes%rowtype;
  v_decision public.w3m_deal_dispute_decisions%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_existing public.w3m_buyer_refund_receipts%rowtype;
  v_receipt_id uuid := gen_random_uuid();
  v_signature_count integer;
  v_distinct_signers integer;
  v_distinct_wallets integer;
  v_now timestamptz := clock_timestamp();
  v_block_number text;
  v_block_hash text;
  v_confirmations integer;
  v_fee numeric(38,18);
  v_refund numeric(38,18);
  v_original numeric(38,18);
begin
  if p_actor_id is null or p_deal_id is null or p_request_id is null or p_decision_id is null
     or p_decision_hash is null or p_decision_hash !~ '^[0-9a-f]{64}$'
     or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}$'
     or p_safe_tx_hash is null or p_safe_tx_hash !~ '^0x[0-9a-f]{64}$'
     or p_broadcast_tx_hash is null or p_broadcast_tx_hash !~ '^0x[0-9a-f]{64}$'
     or jsonb_typeof(p_verified_receipt) is distinct from 'object'
     or jsonb_typeof(p_server_authorization) is distinct from 'object' then
    raise exception 'Invalid buyer refund finalization arguments' using errcode='22023';
  end if;

  if p_server_authorization->>'authorized' is distinct from 'true'
     or p_server_authorization->>'phase' is distinct from 'FINALIZE_BUYER_REFUND'
     or p_server_authorization->>'requestId' is distinct from p_request_id::text
     or p_server_authorization->>'decisionHash' is distinct from p_decision_hash
     or p_server_authorization->>'termsHash' is distinct from p_terms_hash
     or lower(coalesce(p_server_authorization->>'broadcastTxHash','')) is distinct from p_broadcast_tx_hash
     or lower(coalesce(p_server_authorization->>'receiptBlockHash','')) is distinct from lower(coalesce(p_verified_receipt->>'blockHash',''))
     or jsonb_typeof(p_server_authorization->'issues') is distinct from 'array'
     or jsonb_array_length(p_server_authorization->'issues') <> 0 then
    raise exception 'Fresh request-bound server authorization is required' using errcode='42501';
  end if;

  if p_verified_receipt->>'chainId' is distinct from '56'
     or lower(coalesce(p_verified_receipt->>'transactionHash','')) is distinct from p_broadcast_tx_hash
     or lower(coalesce(p_verified_receipt->>'safeTxHash','')) is distinct from p_safe_tx_hash
     or p_verified_receipt->>'executionSuccess' is distinct from 'true'
     or lower(coalesce(p_verified_receipt->>'decisionId','')) is distinct from p_decision_id::text
     or lower(coalesce(p_verified_receipt->>'decisionHash','')) is distinct from p_decision_hash
     or lower(coalesce(p_verified_receipt->>'termsHash','')) is distinct from p_terms_hash
     or coalesce(p_verified_receipt->>'blockNumber','') !~ '^0x[0-9a-f]+$'
     or lower(coalesce(p_verified_receipt->>'blockHash','')) !~ '^0x[0-9a-f]{64}$'
     or coalesce(p_verified_receipt->>'confirmations','') !~ '^[1-9][0-9]*$'
     or coalesce(p_verified_receipt->>'safeAddress','') !~ '^0x[0-9a-f]{40}$'
     or coalesce(p_verified_receipt->>'tokenContract','') !~ '^0x[0-9a-f]{40}$'
     or coalesce(p_verified_receipt->>'buyerWallet','') !~ '^0x[0-9a-f]{40}$'
     or coalesce(p_verified_receipt->>'platformWallet','') !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Verified canonical BNB refund receipt is malformed or unsuccessful' using errcode='23514';
  end if;

  v_block_number := lower(p_verified_receipt->>'blockNumber');
  v_block_hash := lower(p_verified_receipt->>'blockHash');
  v_confirmations := (p_verified_receipt->>'confirmations')::integer;

  -- The Edge Function has independently verified the canonical BNB receipt,
  -- exact two USDT transfers, Safe execution event, block hash and confirmations.
  -- SQL persists that attestation; it does not claim to query or verify a blockchain.

  select * into v_request from public.w3m_buyer_refund_requests where id=p_request_id;
  if not found or v_request.deal_id is distinct from p_deal_id then
    raise exception 'Buyer refund request not found for this deal' using errcode='P0002';
  end if;

  -- Global order: parent deal -> dispute -> refund transaction. Registry rows are immutable.
  select * into v_deal from public.deals where id=p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;
  select * into v_dispute from public.deal_disputes
   where id=v_request.dispute_id and deal_id=p_deal_id for update;
  if not found then raise exception 'Bound dispute not found' using errcode='P0002'; end if;
  select * into v_tx from public.deal_multisig_transactions
   where id=v_request.safe_transaction_id and deal_id=p_deal_id for update;
  if not found then raise exception 'Bound refund Safe transaction not found' using errcode='P0002'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_id::text,true);
  if coalesce(public.is_admin(),false) is not true then
    raise exception 'Verified administrator required to finalize buyer refund' using errcode='42501';
  end if;

  select * into v_existing from public.w3m_buyer_refund_receipts where request_id=p_request_id;
  if found then
    if v_existing.deal_id=p_deal_id and v_existing.decision_id=p_decision_id
       and v_existing.decision_hash=p_decision_hash and v_existing.terms_hash=p_terms_hash
       and v_existing.safe_tx_hash=p_safe_tx_hash and v_existing.broadcast_tx_hash=p_broadcast_tx_hash
       and v_existing.receipt_block_hash=v_block_hash then
      return jsonb_build_object('finalized',true,'idempotent_replay',true,
        'receipt_id',v_existing.id,'request_id',p_request_id,'deal_id',p_deal_id,
        'status','confirmed','broadcast_tx_hash',v_existing.broadcast_tx_hash);
    end if;
    raise exception 'Refund request already finalized with conflicting receipt evidence' using errcode='23505';
  end if;

  select * into v_decision from public.w3m_deal_dispute_decisions
   where id=p_decision_id and deal_id=p_deal_id and dispute_id=v_request.dispute_id for share;
  if not found or v_decision.outcome is distinct from 'buyer_wins'
     or v_decision.decision_hash is distinct from p_decision_hash
     or v_decision.terms_hash is distinct from p_terms_hash
     or v_decision.id is distinct from v_request.decision_id
     or v_request.decision_hash is distinct from p_decision_hash
     or v_request.terms_hash is distinct from p_terms_hash
     or v_decision.buyer_refund_amount is null
     or v_decision.buyer_refund_amount::numeric is distinct from v_request.refund_amount then
    raise exception 'Immutable buyer-win decision binding mismatch' using errcode='23514';
  end if;

  select * into v_terms from public.w3m_deal_terms_versions
   where id=v_decision.terms_version_id and deal_id=p_deal_id for share;
  if not found or v_terms.terms_hash is distinct from p_terms_hash
     or v_terms.terms_version is distinct from v_decision.terms_version
     or v_terms.project_id is distinct from v_deal.project_id
     or v_terms.buyer_id is distinct from v_deal.buyer_id
     or v_terms.seller_id is distinct from v_deal.seller_id
     or v_terms.chain_id is distinct from 56
     or lower(v_terms.safe_address) is distinct from v_request.safe_address then
    raise exception 'Signed deal terms no longer match the refund decision' using errcode='23514';
  end if;

  v_original := v_request.original_deal_amount;
  v_refund := v_request.refund_amount;
  v_fee := v_request.platform_fee_amount;
  if v_original is distinct from v_request.funded_amount
     or v_original is distinct from v_deal.amount
     or v_fee <> round(v_original * 0.075,18)
     or v_refund + v_fee <> v_original
     or v_refund + v_fee > v_request.safe_balance then
    raise exception 'Buyer refund and fixed 7.5% commission do not fully allocate confirmed funding' using errcode='23514';
  end if;

  if v_deal.status is distinct from 'disputed'
     or v_deal.dispute_status is distinct from 'resolved_buyer'
     or v_deal.payment_status is distinct from 'confirmed'
     or v_deal.chain_id is distinct from 56
     or lower(coalesce(v_deal.safe_address,'')) is distinct from v_request.safe_address
     or lower(coalesce(v_deal.token_contract,'')) is distinct from v_request.token_address
     or v_dispute.status is distinct from 'resolved'
     or v_dispute.resolution is distinct from 'buyer_wins' then
    raise exception 'Deal or dispute is not in the exact buyer-refund settlement state' using errcode='23514';
  end if;

  if v_tx.action is distinct from 'refund_to_buyer'
     or v_tx.chain_id is distinct from 56
     or lower(coalesce(v_tx.safe_address,'')) is distinct from v_request.safe_address
     or lower(coalesce(v_tx.safe_tx_hash,'')) is distinct from p_safe_tx_hash
     or v_tx.safe_nonce is distinct from v_request.safe_nonce
     or v_tx.amount is distinct from v_refund
     or v_tx.status not in ('signed','submitted')
     or (v_tx.tx_hash is not null and lower(v_tx.tx_hash) is distinct from p_broadcast_tx_hash) then
    raise exception 'Persisted Safe refund transaction does not match the verified broadcast' using errcode='23514';
  end if;

  if lower(p_verified_receipt->>'safeAddress') is distinct from v_request.safe_address
     or lower(p_verified_receipt->>'tokenContract') is distinct from v_request.token_address
     or lower(p_verified_receipt->>'buyerWallet') is distinct from v_request.buyer_wallet
     or lower(p_verified_receipt->>'platformWallet') is distinct from v_request.platform_wallet
     or p_verified_receipt->>'buyerRefundAmount' is distinct from v_refund::text
     or p_verified_receipt->>'platformFeeAmount' is distinct from v_fee::text
     or v_confirmations < 6 then
    raise exception 'Receipt transfers or chain confirmations do not match the immutable refund request' using errcode='23514';
  end if;

  select count(*),count(distinct signer_id),count(distinct lower(wallet_address))
    into v_signature_count,v_distinct_signers,v_distinct_wallets
    from public.w3m_buyer_refund_signatures s
   where s.request_id=p_request_id and lower(s.safe_tx_hash)=p_safe_tx_hash
     and v_request.safe_owners @> jsonb_build_array(lower(s.wallet_address));
  if v_signature_count <> 2 or v_distinct_signers <> 2 or v_distinct_wallets <> 2 then
    raise exception 'Two distinct recorded Safe-owner signatures are required' using errcode='23514';
  end if;

  insert into public.w3m_buyer_refund_receipts(
    id,request_id,deal_id,dispute_id,decision_id,safe_transaction_id,
    decision_hash,terms_hash,safe_tx_hash,broadcast_tx_hash,chain_id,
    safe_address,token_address,buyer_wallet,buyer_refund_amount,
    platform_wallet,platform_fee_amount,receipt_block_number,receipt_block_hash,
    confirmations,execution_success,verified_receipt,server_authorization,
    finalized_by,finalized_at
  ) values (
    v_receipt_id,p_request_id,p_deal_id,v_request.dispute_id,p_decision_id,
    v_request.safe_transaction_id,p_decision_hash,p_terms_hash,p_safe_tx_hash,
    p_broadcast_tx_hash,56,v_request.safe_address,v_request.token_address,
    v_request.buyer_wallet,v_refund,v_request.platform_wallet,v_fee,
    v_block_number,v_block_hash,v_confirmations,true,p_verified_receipt,
    p_server_authorization,p_actor_id,v_now
  );

  update public.deal_multisig_transactions
     set tx_hash=p_broadcast_tx_hash,status='confirmed',updated_at=v_now
   where id=v_tx.id;

  -- The project is not transferred to the buyer on a buyer-win refund.
  -- The deal is cancelled only after the canonical Safe refund is confirmed.
  update public.deals
     set status='cancelled',dispute_status='closed',updated_at=v_now
   where id=p_deal_id;

  insert into public.deal_audit_logs(
    deal_id,actor_id,action,old_status,new_status,metadata,created_at
  ) values (
    p_deal_id,p_actor_id,'w3m_buyer_refund_confirmed','disputed','cancelled',
    jsonb_build_object(
      'receipt_id',v_receipt_id,'request_id',p_request_id,
      'decision_id',p_decision_id,'decision_hash',p_decision_hash,
      'terms_hash',p_terms_hash,'safe_tx_hash',p_safe_tx_hash,
      'broadcast_tx_hash',p_broadcast_tx_hash,'receipt_block_number',v_block_number,
      'receipt_block_hash',v_block_hash,'confirmations',v_confirmations,
      'buyer_refund_amount',v_refund::text,'platform_fee_amount',v_fee::text,
      'chain_id',56,'safe_address',v_request.safe_address
    ),v_now
  );

  return jsonb_build_object('finalized',true,'idempotent_replay',false,
    'receipt_id',v_receipt_id,'request_id',p_request_id,'deal_id',p_deal_id,
    'status','confirmed','broadcast_tx_hash',p_broadcast_tx_hash);
end;
$finalize_refund$;

revoke all on function public.w3m_finalize_buyer_refund(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.w3m_finalize_buyer_refund(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)
  to service_role;

comment on function public.w3m_finalize_buyer_refund(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb) is
  'Atomic service-role-only buyer refund finalizer. Persists an immutable server-attested receipt, confirms the exact refund Safe transaction, cancels the deal only after verified settlement, and appends an audit event. Does not query the blockchain; canonical receipt verification belongs to the trusted Edge Function.';

commit;
