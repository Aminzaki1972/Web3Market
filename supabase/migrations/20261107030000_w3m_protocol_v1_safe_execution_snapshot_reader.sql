-- W3M Protocol V1 — exact read-only Safe EXECUTE database snapshot.
-- Isolated draft only. Service-role-only; no table writes or chain calls.
-- Legacy transaction ambiguity and unbound agreement acknowledgements are
-- deliberately returned to the caller so the adapter can fail closed.

begin;

create or replace function public.w3m_read_safe_execution_snapshot(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $snapshot$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_code_audit jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_transactions jsonb;
  v_signers jsonb;
  v_agreements jsonb;
  v_dispute jsonb;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;

  select * into v_deal
    from public.deals
   where id = p_deal_id;
  if not found then
    return null;
  end if;

  select * into v_policy
    from public.deal_release_policies
   where deal_id = p_deal_id;

  select jsonb_build_object(
    'id', p.id::text,
    'owner_id', p.owner_id::text,
    'status', p.status,
    'github_url', p.github_url,
    'updated_at', p.updated_at::text
  ) into v_project
  from public.projects p
  where p.id = v_deal.project_id;

  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);

  select jsonb_build_object(
    'id', p.id::text,
    'wallet_address', p.wallet_address,
    'wallet_verified', p.wallet_verified,
    'wallet_verified_at', p.wallet_verified_at::text
  ) into v_buyer_profile
  from public.profiles p
  where p.id = v_deal.buyer_id;

  select jsonb_build_object(
    'id', p.id::text,
    'wallet_address', p.wallet_address,
    'wallet_verified', p.wallet_verified,
    'wallet_verified_at', p.wallet_verified_at::text
  ) into v_seller_profile
  from public.profiles p
  where p.id = v_deal.seller_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id::text,
    'deal_id', t.deal_id::text,
    'action', t.action,
    'safe_tx_hash', t.safe_tx_hash,
    'tx_hash', t.tx_hash,
    'status', t.status,
    'confirmations_count', t.confirmations_count,
    'required_signatures', t.required_signatures,
    'safe_nonce', t.safe_nonce::text,
    'to_address', t.to_address,
    'data', t.data,
    'value_wei', t.value_wei::text,
    'operation', t.operation,
    'safe_tx_gas', t.safe_tx_gas::text,
    'base_gas', t.base_gas::text,
    'gas_price', t.gas_price::text,
    'gas_token', t.gas_token,
    'refund_receiver', t.refund_receiver,
    'signatures', t.signatures,
    'amount', t.amount::text,
    'token_symbol', t.token_symbol,
    'chain_id', t.chain_id::text,
    'safe_address', t.safe_address,
    'updated_at', t.updated_at::text
  ) order by t.created_at desc), '[]'::jsonb)
  into v_transactions
  from public.deal_multisig_transactions t
  where t.deal_id = p_deal_id
    and t.action = 'release_to_seller';

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', s.deal_id::text,
    'signer_role', s.signer_role,
    'signer_id', s.signer_id::text,
    'wallet_address', s.wallet_address,
    'signature_status', s.signature_status,
    'signed_at', s.signed_at::text,
    'safe_tx_hash', s.safe_tx_hash,
    'signature', s.signature
  ) order by s.signer_role), '[]'::jsonb)
  into v_signers
  from public.deal_multisig_signers s
  where s.deal_id = p_deal_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'party_role', a.party_role,
    'party_id', a.party_id::text,
    'agreed_at', a.agreed_at::text
  ) order by a.party_role), '[]'::jsonb)
  into v_agreements
  from public.deal_party_agreements a
  where a.deal_id = p_deal_id;

  select jsonb_build_object(
    'id', d.id::text,
    'deal_id', d.deal_id::text,
    'status', d.status,
    'resolution', d.resolution,
    'resolved_by', d.resolved_by::text,
    'resolved_at', d.resolved_at::text
  ) into v_dispute
  from public.deal_disputes d
  where d.deal_id = p_deal_id;

  return jsonb_build_object(
    'deal', jsonb_build_object(
      'id', v_deal.id::text,
      'project_id', v_deal.project_id::text,
      'buyer_id', v_deal.buyer_id::text,
      'seller_id', v_deal.seller_id::text,
      'amount', v_deal.amount::text,
      'currency', v_deal.currency,
      'status', v_deal.status,
      'payment_status', v_deal.payment_status,
      'payment_tx_hash', v_deal.payment_tx_hash,
      'chain_id', v_deal.chain_id::text,
      'safe_address', v_deal.safe_address,
      'token_contract', v_deal.token_contract,
      'token_symbol', v_deal.token_symbol,
      'expected_amount', v_deal.expected_amount::text,
      'platform_fee', v_deal.platform_fee::text,
      'platform_fee_percent', v_deal.platform_fee_percent::text,
      'seller_net_amount', v_deal.seller_net_amount::text,
      'platform_fee_amount', v_deal.platform_fee_amount::text,
      'delivery_status', v_deal.delivery_status,
      'buyer_approved_at', v_deal.buyer_approved_at::text,
      'delivery_accepted_at', v_deal.delivery_accepted_at::text,
      'dispute_status', v_deal.dispute_status,
      'release_tx_hash', v_deal.release_tx_hash,
      'buyer_agreed_at', v_deal.buyer_agreed_at::text,
      'seller_agreed_at', v_deal.seller_agreed_at::text
    ),
    'policy', case when v_policy.id is null then null else jsonb_build_object(
      'id', v_policy.id::text,
      'deal_id', v_policy.deal_id::text,
      'deal_amount', v_policy.deal_amount::text,
      'fee_percent', v_policy.fee_percent::text,
      'fee_amount', v_policy.fee_amount::text,
      'seller_net_amount', v_policy.seller_net_amount::text,
      'seller_wallet', v_policy.seller_wallet,
      'platform_wallet', v_policy.platform_wallet,
      'safe_address', v_policy.safe_address,
      'token_contract', v_policy.token_contract,
      'token_symbol', v_policy.token_symbol,
      'chain_id', v_policy.chain_id::text,
      'safe_nonce', v_policy.safe_nonce::text,
      'status', v_policy.status,
      'locked_at', v_policy.locked_at::text,
      'released_at', v_policy.released_at::text,
      'release_tx_hash', v_policy.release_tx_hash
    ) end,
    'project', v_project,
    'code_audit', v_code_audit,
    'buyer_profile', v_buyer_profile,
    'seller_profile', v_seller_profile,
    'release_transactions', v_transactions,
    'signers', v_signers,
    'party_agreements', v_agreements,
    'dispute', v_dispute,
    'agreement_binding_supported', false
  );
end;
$snapshot$;

revoke all on function public.w3m_read_safe_execution_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_safe_execution_snapshot(uuid)
  to service_role;

comment on function public.w3m_read_safe_execution_snapshot(uuid) is
  'Read-only server-side snapshot for W3M Safe EXECUTE. Returns exact numeric text and legacy agreement/transaction records. Isolated draft; not deployed.';

commit;
