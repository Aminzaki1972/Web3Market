-- W3M Protocol V1 — dedicated buyer-refund request binding and SIGN persistence.
-- Isolated disposable-CI migration only. No production application.
begin;

create table public.w3m_buyer_refund_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  dispute_id uuid not null references public.deal_disputes(id) on delete restrict,
  decision_id uuid not null unique references public.w3m_deal_dispute_decisions(id) on delete restrict,
  safe_transaction_id uuid not null unique references public.deal_multisig_transactions(id) on delete restrict,
  decision_hash text not null check (decision_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  original_deal_amount numeric(38,18) not null check (original_deal_amount > 0),
  refund_amount numeric(38,18) not null check (refund_amount > 0),
  platform_fee_amount numeric(38,18) not null check (platform_fee_amount > 0),
  funded_amount numeric(38,18) not null check (funded_amount > 0),
  safe_balance numeric(38,18) not null check (safe_balance > 0),
  buyer_wallet text not null check (buyer_wallet ~ '^0x[0-9a-f]{40}$'),
  platform_wallet text not null check (platform_wallet = lower('0x2B15cC63eE3b833F502C065767695Fa2B584f8c9')),
  token_address text not null check (token_address = lower('0x55d398326f99059ff775485246999027b3197955')),
  chain_id integer not null check (chain_id = 56),
  safe_address text not null check (safe_address ~ '^0x[0-9a-f]{40}$'),
  safe_nonce bigint not null check (safe_nonce >= 0),
  safe_block_number bigint not null check (safe_block_number >= 0),
  safe_block_hash text not null check (safe_block_hash ~ '^0x[0-9a-f]{64}$'),
  safe_owners jsonb not null check (jsonb_typeof(safe_owners)='array' and jsonb_array_length(safe_owners)=3),
  safe_threshold integer not null check (safe_threshold=2),
  safe_tx_hash text not null check (safe_tx_hash ~ '^0x[0-9a-f]{64}$'),
  status text not null default 'awaiting_signatures'
    check (status in ('awaiting_signatures','signed','submitted','confirmed','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (refund_amount <= funded_amount),
  check (platform_fee_amount = round(original_deal_amount * 0.075,18)),
  check (refund_amount + platform_fee_amount <= safe_balance),
  unique (deal_id, dispute_id)
);
create index w3m_buyer_refund_requests_deal_idx
  on public.w3m_buyer_refund_requests(deal_id, created_at desc);

create table public.w3m_buyer_refund_signatures (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.w3m_buyer_refund_requests(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  signer_role text not null check (signer_role in ('buyer','seller','platform')),
  signer_id uuid not null references auth.users(id) on delete restrict,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  safe_tx_hash text not null check (safe_tx_hash ~ '^0x[0-9a-f]{64}$'),
  signature text not null check (signature ~ '^0x[0-9a-f]{130}$'),
  signed_at timestamptz not null default now(),
  unique(request_id, signer_role),
  unique(request_id, wallet_address)
);
create index w3m_buyer_refund_signatures_deal_idx
  on public.w3m_buyer_refund_signatures(deal_id, request_id);

alter table public.w3m_buyer_refund_requests enable row level security;
alter table public.w3m_buyer_refund_signatures enable row level security;
revoke all on table public.w3m_buyer_refund_requests,
  public.w3m_buyer_refund_signatures from public, anon, authenticated, service_role;
grant select on table public.w3m_buyer_refund_requests,
  public.w3m_buyer_refund_signatures to service_role;

create or replace function public.w3m_reject_buyer_refund_registry_mutation()
returns trigger language plpgsql security definer set search_path=''
as $reject$
begin
  raise exception 'W3M buyer refund request/signature records are append-only'
    using errcode='55000';
end;
$reject$;

create trigger w3m_buyer_refund_requests_immutable
before update or delete or truncate on public.w3m_buyer_refund_requests
for each statement execute function public.w3m_reject_buyer_refund_registry_mutation();
create trigger w3m_buyer_refund_signatures_immutable
before update or delete or truncate on public.w3m_buyer_refund_signatures
for each statement execute function public.w3m_reject_buyer_refund_registry_mutation();

create or replace function public.w3m_record_buyer_refund_signature(
  p_request_id uuid,
  p_actor_id uuid,
  p_signer_role text,
  p_verified_wallet text,
  p_safe_tx_hash text,
  p_safe_nonce text,
  p_signature text,
  p_server_authorization jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $refund_sign$
declare
  v_request public.w3m_buyer_refund_requests%rowtype;
  v_deal public.deals%rowtype;
  v_decision public.w3m_deal_dispute_decisions%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_existing public.w3m_buyer_refund_signatures%rowtype;
  v_expected_wallet text;
  v_count integer;
  v_signatures jsonb;
  v_status text;
begin
  if p_request_id is null or p_actor_id is null
     or p_signer_role is null or p_signer_role not in ('buyer','seller','platform')
     or p_verified_wallet is null or p_verified_wallet !~ '^0x[0-9a-fA-F]{40}$'
     or p_safe_tx_hash is null or p_safe_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or p_safe_nonce is null or p_safe_nonce !~ '^(0|[1-9][0-9]*)$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$'
     or jsonb_typeof(p_server_authorization) is distinct from 'object'
     or p_server_authorization->>'authorized' is distinct from 'true'
     or p_server_authorization->>'phase' is distinct from 'SIGN'
     or p_server_authorization->>'request_id' is distinct from p_request_id::text
     or lower(p_server_authorization->>'safe_tx_hash') is distinct from lower(p_safe_tx_hash)
     or jsonb_typeof(p_server_authorization->'issues') is distinct from 'array'
     or jsonb_array_length(p_server_authorization->'issues') <> 0 then
    raise exception 'Invalid or unauthorized buyer refund SIGN request' using errcode='42501';
  end if;

  -- Lock order: parent deal, refund request, then Safe transaction.
  -- First read only to discover the parent key, then acquire locks in the
  -- documented parent-deal -> request -> transaction order.
  select * into v_request from public.w3m_buyer_refund_requests where id=p_request_id;
  if not found then raise exception 'Buyer refund request not found' using errcode='P0002'; end if;
  select * into v_deal from public.deals where id=v_request.deal_id for update;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;
  select * into v_request from public.w3m_buyer_refund_requests
   where id=p_request_id and deal_id=v_deal.id for update;
  if not found then raise exception 'Buyer refund request changed during lock acquisition' using errcode='40001'; end if;

  select * into v_decision from public.w3m_deal_dispute_decisions
   where id=v_request.decision_id and deal_id=v_request.deal_id
     and dispute_id=v_request.dispute_id for share;
  if not found or v_decision.outcome <> 'buyer_wins'
     or v_decision.decision_hash <> v_request.decision_hash
     or v_decision.terms_hash <> v_request.terms_hash
     or v_decision.buyer_refund_amount is null
     or v_decision.buyer_refund_amount::numeric <> v_request.refund_amount then
    raise exception 'Immutable buyer-win decision binding mismatch' using errcode='23514';
  end if;
  if v_deal.status is distinct from 'disputed' or v_deal.dispute_status is distinct from 'resolved_buyer'
     or v_deal.chain_id is distinct from 56 or v_deal.payment_status is distinct from 'confirmed'
     or v_deal.safe_address is null or lower(v_deal.safe_address) <> v_request.safe_address
     or v_deal.token_contract is null or lower(v_deal.token_contract) <> v_request.token_address then
    raise exception 'Deal state or Safe/token binding blocks refund signature' using errcode='23514';
  end if;

  select * into v_terms from public.w3m_deal_terms_versions
   where id=v_decision.terms_version_id and deal_id=v_deal.id for share;
  if not found or v_terms.terms_hash <> v_request.terms_hash
     or v_terms.terms_version <> v_decision.terms_version
     or lower(v_terms.safe_address) <> v_request.safe_address then
    raise exception 'Signed terms binding changed' using errcode='23514';
  end if;

  select * into v_buyer from public.profiles where id=v_deal.buyer_id for share;
  select * into v_seller from public.profiles where id=v_deal.seller_id for share;
  if v_buyer.wallet_verified is distinct from true or v_buyer.wallet_verified_at is null
     or v_seller.wallet_verified is distinct from true or v_seller.wallet_verified_at is null
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) <> v_request.buyer_wallet then
    raise exception 'Buyer verified wallet changed or is not bound' using errcode='42501';
  end if;

  if p_signer_role='buyer' then
    v_expected_wallet := lower(v_buyer.wallet_address);
    if p_actor_id <> v_deal.buyer_id then raise exception 'Buyer actor mismatch' using errcode='42501'; end if;
  elsif p_signer_role='seller' then
    v_expected_wallet := lower(v_seller.wallet_address);
    if p_actor_id <> v_deal.seller_id then raise exception 'Seller actor mismatch' using errcode='42501'; end if;
  else
    perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_id::text,true);
    if coalesce(public.is_admin(),false) is not true then
      raise exception 'Verified platform administrator required' using errcode='42501';
    end if;
    v_expected_wallet := lower(v_request.platform_wallet);
  end if;
  if lower(p_verified_wallet) <> v_expected_wallet
     or not (v_request.safe_owners @> jsonb_build_array(v_expected_wallet))
     or v_request.safe_threshold <> 2
     or (select count(distinct lower(value)) from jsonb_array_elements_text(v_request.safe_owners)) <> 3
     or not (v_request.safe_owners @> jsonb_build_array(lower(v_buyer.wallet_address)))
     or not (v_request.safe_owners @> jsonb_build_array(lower(v_seller.wallet_address)))
     or not (v_request.safe_owners @> jsonb_build_array(v_request.platform_wallet)) then
    raise exception 'Signer wallet or recorded Safe owner set mismatch' using errcode='42501';
  end if;
  if v_request.safe_tx_hash <> lower(p_safe_tx_hash)
     or v_request.safe_nonce <> p_safe_nonce::bigint
     or v_request.status <> 'awaiting_signatures' then
    raise exception 'Refund transaction hash or request state mismatch' using errcode='23514';
  end if;

  select * into v_tx from public.deal_multisig_transactions
   where id=v_request.safe_transaction_id and deal_id=v_deal.id
     and action='refund_to_buyer' for update;
  if not found or v_tx.safe_tx_hash is null or lower(v_tx.safe_tx_hash) <> lower(p_safe_tx_hash)
     or v_tx.safe_address is null or lower(v_tx.safe_address) <> v_request.safe_address
     or v_tx.chain_id is distinct from 56 or v_tx.safe_nonce is distinct from v_request.safe_nonce
     or v_tx.amount is distinct from v_request.refund_amount
     or lower(coalesce(v_tx.to_address,'')) <> '0x9641d764fc13c8b624c04430c7356c1c7c8102e2'
     or v_tx.operation is distinct from 1 or v_tx.value_wei is distinct from 0
     or v_tx.data is null or v_tx.data !~ '^0x([0-9a-fA-F]{2})+$'
     or v_tx.required_signatures is distinct from 2
     or v_tx.status is null or v_tx.status not in ('awaiting_signatures','signed') then
    raise exception 'Safe refund transaction row mismatch' using errcode='23514';
  end if;

  select * into v_existing from public.w3m_buyer_refund_signatures
   where request_id=p_request_id and signer_role=p_signer_role for update;
  if found then
    if v_existing.signer_id=p_actor_id
       and v_existing.wallet_address=v_expected_wallet
       and v_existing.safe_tx_hash=lower(p_safe_tx_hash)
       and v_existing.signature=lower(p_signature) then
      select count(*) into v_count from public.w3m_buyer_refund_signatures
       where request_id=p_request_id;
      return jsonb_build_object('recorded',true,'idempotent_replay',true,
        'confirmations_count',v_count,'required_signatures',2,
        'status',case when v_count>=2 then 'signed' else 'awaiting_signatures' end);
    end if;
    raise exception 'Conflicting signature already recorded for this Safe role' using errcode='23505';
  end if;

  insert into public.w3m_buyer_refund_signatures(
    request_id,deal_id,signer_role,signer_id,wallet_address,safe_tx_hash,signature
  ) values(p_request_id,v_deal.id,p_signer_role,p_actor_id,v_expected_wallet,
    lower(p_safe_tx_hash),lower(p_signature));

  select count(*) into v_count from public.w3m_buyer_refund_signatures
   where request_id=p_request_id;
  if v_count>2 then raise exception 'Refund Safe signer count exceeds 2-of-3 threshold' using errcode='23514'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'wallet_address',wallet_address,'signature',signature
  ) order by wallet_address),'[]'::jsonb) into v_signatures
  from public.w3m_buyer_refund_signatures where request_id=p_request_id;

  v_status := case when v_count>=2 then 'signed' else 'awaiting_signatures' end;
  update public.deal_multisig_transactions set signatures=v_signatures,
    confirmations_count=v_count,status=v_status,updated_at=now()
   where id=v_tx.id;

  insert into public.deal_audit_logs(deal_id,actor_id,action,old_status,new_status,metadata)
  values(v_deal.id,p_actor_id,'w3m_buyer_refund_signature_recorded',
    v_tx.status,v_status,jsonb_build_object(
      'request_id',p_request_id,'decision_id',v_decision.id,
      'decision_hash',v_decision.decision_hash,'terms_hash',v_decision.terms_hash,
      'safe_tx_hash',lower(p_safe_tx_hash),'signer_role',p_signer_role,
      'wallet_address',v_expected_wallet,'confirmations_count',v_count));

  return jsonb_build_object('recorded',true,'idempotent_replay',false,
    'confirmations_count',v_count,'required_signatures',2,'status',v_status);
end;
$refund_sign$;

revoke all on function public.w3m_record_buyer_refund_signature(uuid,uuid,text,text,text,text,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.w3m_record_buyer_refund_signature(uuid,uuid,text,text,text,text,text,jsonb)
 to service_role;

comment on table public.w3m_buyer_refund_requests is
 'Immutable W3M V1 buyer-win Safe refund request binding. Does not itself authorize or broadcast Safe execution.';
comment on table public.w3m_buyer_refund_signatures is
 'Append-only refund-specific Safe signatures, isolated from seller-release signer records.';
comment on function public.w3m_record_buyer_refund_signature(uuid,uuid,text,text,text,text,text,jsonb) is
 'Service-role-only atomic refund SIGN persistence. Caller must authenticate, load fresh canonical BNB Safe context and cryptographically verify Safe digest before invocation.';

commit;
