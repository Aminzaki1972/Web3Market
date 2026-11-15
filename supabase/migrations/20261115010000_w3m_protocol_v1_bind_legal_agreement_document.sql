-- W3M Protocol V1 — bind the immutable owner-approved Arabic agreement into canonical deal terms.
-- Isolated V1 migration only; do not apply to production during this phase.
begin;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'agreementDocument', jsonb_build_object(
      'documentId', 'W3M-AGREEMENT',
      'version', '1.0',
      'locale', 'ar',
      'sha256', '74fc948b9b7757718b617af080acd51c0a21de81aa3a5b7f410a19aa07a7a465'
    ),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

commit;
