begin;

create or replace function public.w3m_finalize_deal_payment(
  p_deal_id uuid,
  p_actor_id uuid,
  p_tx_hash text,
  p_verified_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_deal public.deals%rowtype;
  v_buyer public.profiles%rowtype;
  v_existing public.blockchain_transactions%rowtype;
  v_expected_amount numeric;
  v_expected_base_units text;
  v_fee numeric;
  v_seller_net numeric;
  v_block_number bigint;
  v_confirmations integer;
  v_old_status text;
  v_token constant text := '0x55d398326f99059ff775485246999027b3197955';
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'W3M_PAYMENT_SERVICE_ROLE_REQUIRED';
  end if;

  if p_deal_id is null or p_actor_id is null
     or p_tx_hash is null or p_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or jsonb_typeof(p_verified_receipt) is distinct from 'object' then
    raise exception 'W3M_PAYMENT_INPUT_INVALID';
  end if;

  select d.* into v_deal
  from public.deals d
  where d.id = p_deal_id
  for update;

  if not found then
    raise exception 'W3M_PAYMENT_DEAL_NOT_FOUND';
  end if;

  if v_deal.buyer_id is distinct from p_actor_id then
    raise exception 'W3M_PAYMENT_ACTOR_NOT_BUYER';
  end if;

  select p.* into v_buyer
  from public.profiles p
  where p.id = v_deal.buyer_id;

  if not found or v_buyer.wallet_verified is not true
     or v_buyer.wallet_address is null then
    raise exception 'W3M_PAYMENT_BUYER_WALLET_NOT_VERIFIED';
  end if;

  if v_deal.chain_id is distinct from 56
     or lower(coalesce(v_deal.token_contract, '')) is distinct from v_token
     or lower(coalesce(v_deal.safe_address, '')) !~ '^0x[0-9a-f]{40}$' then
    raise exception 'W3M_PAYMENT_DEAL_CONFIGURATION_INVALID';
  end if;

  if v_deal.platform_fee_percent is distinct from 7.5 then
    raise exception 'W3M_PAYMENT_FEE_CONFIGURATION_INVALID';
  end if;

  if v_deal.status not in ('accepted', 'pending', 'in_progress')
     or lower(coalesce(v_deal.payment_status, '')) not in ('pending', '') then
    if v_deal.payment_status = 'confirmed'
       and lower(coalesce(v_deal.payment_tx_hash, '')) = lower(p_tx_hash) then
      select bt.* into v_existing
      from public.blockchain_transactions bt
      where bt.tx_hash = lower(p_tx_hash)
      limit 1;
      if found and v_existing.deal_id = v_deal.id
         and v_existing.transaction_type = 'payment'
         and v_existing.status = 'confirmed' then
        return jsonb_build_object('ok', true, 'verified', true, 'idempotent', true,
          'deal_id', v_deal.id, 'tx_hash', lower(p_tx_hash));
      end if;
    end if;
    raise exception 'W3M_PAYMENT_DEAL_STATE_INVALID';
  end if;

  if v_deal.payment_tx_hash is not null
     and lower(v_deal.payment_tx_hash) <> lower(p_tx_hash) then
    raise exception 'W3M_PAYMENT_DIFFERENT_HASH_ALREADY_RECORDED';
  end if;

  if lower(coalesce(p_verified_receipt->>'transactionHash', '')) <> lower(p_tx_hash)
     or p_verified_receipt->>'chainId' <> '56'
     or lower(coalesce(p_verified_receipt->>'buyerWallet', '')) <> lower(v_buyer.wallet_address)
     or lower(coalesce(p_verified_receipt->>'safeAddress', '')) <> lower(v_deal.safe_address)
     or lower(coalesce(p_verified_receipt->>'tokenContract', '')) <> v_token
     or coalesce(p_verified_receipt->>'blockHash', '') !~ '^0x[0-9a-fA-F]{64}$'
     or coalesce(p_verified_receipt->>'blockNumber', '') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_verified_receipt->>'amountBaseUnits', '') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_verified_receipt->>'logIndex', '') !~ '^(0|[1-9][0-9]*)$'
     or coalesce(p_verified_receipt->>'confirmations', '') !~ '^[1-9][0-9]*$' then
    raise exception 'W3M_PAYMENT_VERIFIED_RECEIPT_MALFORMED';
  end if;

  v_confirmations := (p_verified_receipt->>'confirmations')::integer;
  if v_confirmations < 3 then
    raise exception 'W3M_PAYMENT_CONFIRMATIONS_INSUFFICIENT';
  end if;

  v_block_number := (p_verified_receipt->>'blockNumber')::bigint;
  v_expected_amount := coalesce(v_deal.expected_amount, v_deal.amount);
  if v_expected_amount is null or v_expected_amount <= 0
     or v_expected_amount * 1000000000000000000 <> trunc(v_expected_amount * 1000000000000000000) then
    raise exception 'W3M_PAYMENT_EXPECTED_AMOUNT_INVALID';
  end if;
  v_expected_base_units := trunc(v_expected_amount * 1000000000000000000)::text;

  if p_verified_receipt->>'amountBaseUnits' <> v_expected_base_units then
    raise exception 'W3M_PAYMENT_AMOUNT_MISMATCH';
  end if;

  select bt.* into v_existing
  from public.blockchain_transactions bt
  where bt.tx_hash = lower(p_tx_hash)
  limit 1;

  if found then
    if v_existing.deal_id is distinct from v_deal.id
       or v_existing.transaction_type is distinct from 'payment' then
      raise exception 'W3M_PAYMENT_TRANSACTION_HASH_ALREADY_BOUND';
    end if;
    if v_existing.status <> 'confirmed' then
      raise exception 'W3M_PAYMENT_TRANSACTION_HASH_ALREADY_EXISTS';
    end if;
  end if;

  v_fee := round(v_deal.amount * 0.075, 18);
  v_seller_net := v_deal.amount - v_fee;
  v_old_status := v_deal.status;

  if not found then
    insert into public.blockchain_transactions (
      user_id, deal_id, chain_id, tx_hash, transaction_type, token_symbol,
      amount, to_address, from_address, status, block_number, confirmed_at, metadata
    ) values (
      v_deal.buyer_id, v_deal.id, 56, lower(p_tx_hash), 'payment', 'USDT',
      v_expected_amount, lower(v_deal.safe_address), lower(v_buyer.wallet_address),
      'confirmed', v_block_number, pg_catalog.now(),
      jsonb_build_object(
        'verified_by', 'w3m_finalize_deal_payment',
        'chain_id', 56,
        'block_hash', lower(p_verified_receipt->>'blockHash'),
        'block_number', v_block_number,
        'confirmations', v_confirmations,
        'amount_base_units', v_expected_base_units,
        'log_index', p_verified_receipt->>'logIndex'
      )
    );
  end if;

  update public.deals
  set payment_tx_hash = lower(p_tx_hash),
      payment_status = 'confirmed',
      expected_amount = coalesce(expected_amount, amount),
      status = case when status in ('accepted', 'pending', 'in_progress') then 'funded' else status end,
      funded_at = coalesce(funded_at, pg_catalog.now()),
      platform_fee_amount = v_fee,
      seller_net_amount = v_seller_net,
      platform_fee = v_fee,
      fee_locked_at = coalesce(fee_locked_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  where id = v_deal.id;

  insert into public.deal_audit_logs (
    deal_id, actor_id, action, old_status, new_status, metadata
  ) values (
    v_deal.id, p_actor_id, 'payment_verified', v_old_status,
    case when v_old_status in ('accepted', 'pending', 'in_progress') then 'funded' else v_old_status end,
    jsonb_build_object(
      'tx_hash', lower(p_tx_hash),
      'block_number', v_block_number,
      'block_hash', lower(p_verified_receipt->>'blockHash'),
      'confirmations', v_confirmations,
      'amount_base_units', v_expected_base_units,
      'fee_percent', 7.5,
      'platform_fee_amount', v_fee,
      'seller_net_amount', v_seller_net
    )
  );

  return jsonb_build_object(
    'ok', true, 'verified', true, 'idempotent', false,
    'deal_id', v_deal.id, 'tx_hash', lower(p_tx_hash),
    'block_number', v_block_number, 'confirmations', v_confirmations,
    'platform_fee_amount', v_fee, 'seller_net_amount', v_seller_net
  );
end;
$function$;

revoke all on function public.w3m_finalize_deal_payment(uuid, uuid, text, jsonb) from public;
revoke all on function public.w3m_finalize_deal_payment(uuid, uuid, text, jsonb) from anon;
revoke all on function public.w3m_finalize_deal_payment(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.w3m_finalize_deal_payment(uuid, uuid, text, jsonb) to service_role;

commit;
