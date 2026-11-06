-- W3M Protocol V1 — exact server-only Safe finalization snapshot reader.
-- Draft only. Apply only in disposable PostgreSQL CI; never deploy without approval.
-- The finalizer RPC still locks and revalidates persisted values atomically.
begin;

create or replace function public.w3m_read_safe_finalization_snapshot(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $snapshot$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
  v_deal public.deals%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_policy public.deal_release_policies%rowtype;
begin
  if p_attempt_id is null then
    raise exception 'Execution attempt ID is required' using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id;
  if not found then
    raise exception 'Execution attempt not found' using errcode = 'P0002';
  end if;

  select * into v_deal
    from public.deals
   where id = v_attempt.deal_id;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  select * into v_tx
    from public.deal_multisig_transactions
   where id = v_attempt.transaction_id
     and deal_id = v_attempt.deal_id;
  if not found then raise exception 'Bound Safe transaction not found' using errcode = 'P0002'; end if;

  select * into v_policy
    from public.deal_release_policies
   where deal_id = v_attempt.deal_id;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;

  if v_attempt.state not in ('BROADCAST','RECONCILIATION_REQUIRED')
     or v_attempt.broadcast_tx_hash is null
     or v_attempt.safe_tx_hash is null
     or v_tx.action is distinct from 'release_to_seller'
     or v_tx.status not in ('signed','submitted')
     or lower(coalesce(v_tx.safe_tx_hash,'')) <> lower(v_attempt.safe_tx_hash)
     or (v_tx.tx_hash is not null and lower(v_tx.tx_hash) <> lower(v_attempt.broadcast_tx_hash))
     or v_deal.chain_id is distinct from 56
     or v_policy.chain_id is distinct from 56
     or v_tx.chain_id is distinct from 56
     or v_deal.safe_address is null
     or v_policy.safe_address is null
     or v_tx.safe_address is null
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_policy.safe_address) <> lower(v_tx.safe_address)
     or v_deal.token_contract is null
     or v_policy.token_contract is null
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_policy.seller_wallet is null
     or v_policy.platform_wallet is null
     or lower(v_policy.seller_wallet) = lower(v_policy.platform_wallet)
     or v_policy.seller_net_amount is null
     or v_policy.fee_amount is null then
    raise exception 'Safe finalization snapshot is not execution-ready or bindings changed'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt.id::text,
    'deal_id', v_attempt.deal_id::text,
    'transaction_id', v_attempt.transaction_id::text,
    'report_id', v_attempt.report_id::text,
    'safe_tx_hash', lower(v_attempt.safe_tx_hash),
    'broadcast_tx_hash', lower(v_attempt.broadcast_tx_hash),
    'chain_id', v_deal.chain_id,
    'safe_address', lower(v_policy.safe_address),
    'token_contract', lower(v_policy.token_contract),
    'seller_wallet', lower(v_policy.seller_wallet),
    'seller_net_amount', v_policy.seller_net_amount::text,
    'platform_wallet', lower(v_policy.platform_wallet),
    'platform_fee', v_policy.fee_amount::text,
    'buyer_id', v_deal.buyer_id::text,
    'seller_id', v_deal.seller_id::text,
    'deal_status', v_deal.status,
    'policy_status', v_policy.status,
    'transaction_status', v_tx.status,
    'attempt_state', v_attempt.state
  );
end;
$snapshot$;

revoke all on function public.w3m_read_safe_finalization_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_read_safe_finalization_snapshot(uuid)
  to service_role;

commit;
