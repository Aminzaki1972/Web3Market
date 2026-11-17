-- W3M Protocol V1 — include immutable EIP-712 agreements in the Safe EXECUTE snapshot.
-- Isolated draft only; must follow 20261107040000 agreement registry migration.
begin;

create or replace function public.w3m_read_safe_execution_snapshot(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $snapshot$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_transactions jsonb;
  v_signers jsonb;
  v_legacy_agreements jsonb;
  v_dispute jsonb;
  v_terms_version jsonb;
  v_acceptances jsonb;
  v_terms_version_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;

  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,
    'status',p.status,'updated_at',p.updated_at::text)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id::text,'deal_id',t.deal_id::text,'action',t.action,
    'safe_tx_hash',t.safe_tx_hash,'tx_hash',t.tx_hash,'status',t.status,
    'confirmations_count',t.confirmations_count,'required_signatures',t.required_signatures,
    'safe_nonce',t.safe_nonce::text,'to_address',t.to_address,'data',t.data,
    'value_wei',t.value_wei::text,'operation',t.operation,
    'safe_tx_gas',t.safe_tx_gas::text,'base_gas',t.base_gas::text,
    'gas_price',t.gas_price::text,'gas_token',t.gas_token,
    'refund_receiver',t.refund_receiver,'signatures',t.signatures,
    'amount',t.amount::text,'token_symbol',t.token_symbol,
    'chain_id',t.chain_id::text,'safe_address',t.safe_address,
    'updated_at',t.updated_at::text
  ) order by t.created_at desc),'[]'::jsonb)
  into v_transactions from public.deal_multisig_transactions t
  where t.deal_id = p_deal_id and t.action = 'release_to_seller';

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id',s.deal_id::text,'signer_role',s.signer_role,
    'signer_id',s.signer_id::text,'wallet_address',s.wallet_address,
    'signature_status',s.signature_status,'signed_at',s.signed_at::text,
    'safe_tx_hash',s.safe_tx_hash,'signature',s.signature
  ) order by s.signer_role),'[]'::jsonb)
  into v_signers from public.deal_multisig_signers s where s.deal_id = p_deal_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'party_role',a.party_role,'party_id',a.party_id::text,'agreed_at',a.agreed_at::text
  ) order by a.party_role),'[]'::jsonb)
  into v_legacy_agreements from public.deal_party_agreements a where a.deal_id = p_deal_id;

  select jsonb_build_object('id',d.id::text,'deal_id',d.deal_id::text,
    'status',d.status,'resolution',d.resolution,'resolved_by',d.resolved_by::text,
    'resolved_at',d.resolved_at::text)
    into v_dispute from public.deal_disputes d where d.deal_id = p_deal_id;

  select id into v_terms_version_id
    from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if v_terms_version_id is not null then
    select jsonb_build_object(
      'id',tv.id::text,'deal_id',tv.deal_id::text,'terms_version',tv.terms_version::text,
      'project_id',tv.project_id::text,'buyer_id',tv.buyer_id::text,'seller_id',tv.seller_id::text,
      'chain_id',tv.chain_id::text,'safe_address',tv.safe_address,
      'terms_hash',tv.terms_hash,'canonical_terms',tv.canonical_terms,'created_at',tv.created_at::text
    ) into v_terms_version from public.w3m_deal_terms_versions tv where tv.id = v_terms_version_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id::text,'terms_version_id',a.terms_version_id::text,'deal_id',a.deal_id::text,
      'terms_version',a.terms_version::text,'party_role',a.party_role,'party_id',a.party_id::text,
      'wallet_address',a.wallet_address,'chain_id',a.chain_id::text,
      'safe_address',a.safe_address,'terms_hash',a.terms_hash,
      'typed_data_digest',a.typed_data_digest,'signature',a.signature,'accepted_at',a.accepted_at::text
    ) order by a.party_role),'[]'::jsonb)
    into v_acceptances from public.w3m_deal_agreement_acceptances a
    where a.terms_version_id = v_terms_version_id;
  else
    v_acceptances := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'deal',jsonb_build_object(
      'id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,'status',v_deal.status,
      'payment_status',v_deal.payment_status,'payment_tx_hash',v_deal.payment_tx_hash,
      'chain_id',v_deal.chain_id::text,'safe_address',v_deal.safe_address,
      'token_contract',v_deal.token_contract,'token_symbol',v_deal.token_symbol,
      'expected_amount',v_deal.expected_amount::text,'platform_fee',v_deal.platform_fee::text,
      'platform_fee_percent',v_deal.platform_fee_percent::text,
      'seller_net_amount',v_deal.seller_net_amount::text,
      'platform_fee_amount',v_deal.platform_fee_amount::text,
      'delivery_status',v_deal.delivery_status,'buyer_approved_at',v_deal.buyer_approved_at::text,
      'delivery_accepted_at',v_deal.delivery_accepted_at::text,'dispute_status',v_deal.dispute_status,
      'release_tx_hash',v_deal.release_tx_hash,'buyer_agreed_at',v_deal.buyer_agreed_at::text,
      'seller_agreed_at',v_deal.seller_agreed_at::text,'updated_at',v_deal.updated_at::text
    ),
    'policy',case when v_policy.id is null then null else jsonb_build_object(
      'id',v_policy.id::text,'deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'seller_wallet',v_policy.seller_wallet,'platform_wallet',v_policy.platform_wallet,
      'safe_address',v_policy.safe_address,'token_contract',v_policy.token_contract,
      'token_symbol',v_policy.token_symbol,'chain_id',v_policy.chain_id::text,
      'safe_nonce',v_policy.safe_nonce::text,'status',v_policy.status,
      'locked_at',v_policy.locked_at::text,'released_at',v_policy.released_at::text,
      'release_tx_hash',v_policy.release_tx_hash,'updated_at',v_policy.updated_at::text
    ) end,
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'release_transactions',v_transactions,'signers',v_signers,
    'party_agreements',v_legacy_agreements,'dispute',v_dispute,
    'terms_version',v_terms_version,'agreement_acceptances',v_acceptances,
    'agreement_binding_supported',v_terms_version is not null
  );
end;
$snapshot$;

revoke all on function public.w3m_read_safe_execution_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_safe_execution_snapshot(uuid)
  to service_role;

commit;
