-- W3M Protocol V1 — dedicated fresh buyer-refund request context reader.
-- Read-only service-role RPC. It deliberately does not reuse seller-release
-- eligibility rules and does not verify chain data; the Edge Function must do that.
begin;

create or replace function public.w3m_read_buyer_refund_request_snapshot(
  p_deal_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $buyer_refund_snapshot$
declare
  v_deal public.deals%rowtype;
  v_dispute public.deal_disputes%rowtype;
  v_decision public.w3m_deal_dispute_decisions%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_acceptances jsonb;
begin
  if p_deal_id is null or p_actor_id is null then
    raise exception 'Deal ID and authenticated actor ID are required' using errcode='22023';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub',p_actor_id::text,true);
  if coalesce(public.is_admin(),false) is not true then
    raise exception 'Verified administrator required for buyer-refund snapshot' using errcode='42501';
  end if;

  select * into v_deal from public.deals d where d.id=p_deal_id;
  if not found then return null; end if;

  select * into v_buyer from public.profiles p where p.id=v_deal.buyer_id;
  select * into v_seller from public.profiles p where p.id=v_deal.seller_id;

  select * into v_dispute
    from public.deal_disputes d
   where d.deal_id=p_deal_id
   order by case when exists (
     select 1 from public.w3m_deal_dispute_decisions x
      where x.dispute_id=d.id and x.outcome='buyer_wins'
   ) then 0 when d.status in ('open','under_review') then 1 else 2 end, d.id desc
   limit 1;
  if not found then
    return jsonb_build_object(
      'deal',jsonb_build_object(
        'id',v_deal.id,'project_id',v_deal.project_id,'buyer_id',v_deal.buyer_id,
        'seller_id',v_deal.seller_id,'amount',v_deal.amount::text,
        'status',v_deal.status,'payment_status',v_deal.payment_status,
        'payment_tx_hash',v_deal.payment_tx_hash,'chain_id',v_deal.chain_id,
        'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
        'dispute_status',v_deal.dispute_status
      ),
      'buyer_profile',jsonb_build_object('id',v_buyer.id,'wallet_address',v_buyer.wallet_address,
        'wallet_verified',v_buyer.wallet_verified,'wallet_verified_at',v_buyer.wallet_verified_at),
      'seller_profile',jsonb_build_object('id',v_seller.id,'wallet_address',v_seller.wallet_address,
        'wallet_verified',v_seller.wallet_verified,'wallet_verified_at',v_seller.wallet_verified_at),
      'dispute',null,'decision',null,'terms',null,'acceptances','[]'::jsonb
    );
  end if;

  select * into v_decision
    from public.w3m_deal_dispute_decisions d
   where d.dispute_id=v_dispute.id and d.deal_id=p_deal_id;
  if found then
    select * into v_terms
      from public.w3m_deal_terms_versions t
     where t.id=v_decision.terms_version_id and t.deal_id=p_deal_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'terms_version_id',a.terms_version_id,'deal_id',a.deal_id,
      'terms_version',a.terms_version,'party_role',a.party_role,'party_id',a.party_id,
      'wallet_address',a.wallet_address,'chain_id',a.chain_id,'safe_address',a.safe_address,
      'terms_hash',a.terms_hash,'typed_data_digest',a.typed_data_digest,
      'signature',a.signature,'accepted_at',a.accepted_at
    ) order by a.party_role),'[]'::jsonb)
      into v_acceptances
      from public.w3m_deal_agreement_acceptances a
     where a.terms_version_id=v_terms.id and a.deal_id=p_deal_id;
  else
    v_acceptances := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'deal',jsonb_build_object(
      'id',v_deal.id,'project_id',v_deal.project_id,'buyer_id',v_deal.buyer_id,
      'seller_id',v_deal.seller_id,'amount',v_deal.amount::text,
      'status',v_deal.status,'payment_status',v_deal.payment_status,
      'payment_tx_hash',v_deal.payment_tx_hash,'chain_id',v_deal.chain_id,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'dispute_status',v_deal.dispute_status
    ),
    'buyer_profile',jsonb_build_object('id',v_buyer.id,'wallet_address',v_buyer.wallet_address,
      'wallet_verified',v_buyer.wallet_verified,'wallet_verified_at',v_buyer.wallet_verified_at),
    'seller_profile',jsonb_build_object('id',v_seller.id,'wallet_address',v_seller.wallet_address,
      'wallet_verified',v_seller.wallet_verified,'wallet_verified_at',v_seller.wallet_verified_at),
    'dispute',jsonb_build_object(
      'id',v_dispute.id,'deal_id',v_dispute.deal_id,'status',v_dispute.status,
      'resolution',v_dispute.resolution,'resolved_by',v_dispute.resolved_by,
      'resolved_at',v_dispute.resolved_at
    ),
    'decision',case when v_decision.id is null then null else jsonb_build_object(
      'id',v_decision.id,'deal_id',v_decision.deal_id,'dispute_id',v_decision.dispute_id,
      'outcome',v_decision.outcome,'buyer_refund_amount',v_decision.buyer_refund_amount::text,
      'terms_version_id',v_decision.terms_version_id,'terms_version',v_decision.terms_version,
      'terms_hash',v_decision.terms_hash,'decision_hash',v_decision.decision_hash,
      'canonical_payload',v_decision.canonical_payload,'decided_at',v_decision.decided_at
    ) end,
    'terms',case when v_terms.id is null then null else jsonb_build_object(
      'id',v_terms.id,'deal_id',v_terms.deal_id,'terms_version',v_terms.terms_version,
      'project_id',v_terms.project_id,'buyer_id',v_terms.buyer_id,'seller_id',v_terms.seller_id,
      'chain_id',v_terms.chain_id,'safe_address',v_terms.safe_address,
      'terms_hash',v_terms.terms_hash,'canonical_terms',v_terms.canonical_terms
    ) end,
    'acceptances',v_acceptances
  );
end;
$buyer_refund_snapshot$;

revoke all on function public.w3m_read_buyer_refund_request_snapshot(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.w3m_read_buyer_refund_request_snapshot(uuid,uuid)
  to service_role;

comment on function public.w3m_read_buyer_refund_request_snapshot(uuid,uuid) is
  'Read-only, admin-authorized fresh snapshot for buyer-win refund request preparation. Returns exact deal, dispute, immutable decision, referenced terms, party wallet verification and EIP-712 acceptances. Does not verify BNB RPC evidence or authorize any transaction.';

commit;
