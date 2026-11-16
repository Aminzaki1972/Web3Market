begin;

do $$
declare
  v_proc regprocedure := to_regprocedure('public.w3m_finalize_deal_payment(uuid,uuid,text,jsonb)');
  v_definition text;
  v_hash_index text;
  v_deal_index text;
begin
  if v_proc is null then
    raise exception 'atomic deal payment finalization RPC is missing';
  end if;

  v_definition := pg_get_functiondef(v_proc);
  if v_definition not ilike '%request.jwt.claim.role%'
     or v_definition not ilike '%service_role%'
     or v_definition not ilike '%for update%'
     or v_definition not ilike '%insert into public.blockchain_transactions%'
     or v_definition not ilike '%update public.deals%'
     or v_definition not ilike '%insert into public.deal_audit_logs%'
     or v_definition not ilike '%W3M_PAYMENT_TRANSACTION_HASH_ALREADY_BOUND%' then
    raise exception 'atomic deal payment finalization RPC is missing a required trust or atomicity guard';
  end if;

  select pg_get_indexdef(indexrelid) into v_hash_index
  from pg_index
  where indexrelid = to_regclass('public.blockchain_transactions_tx_hash_lower_uq');
  if v_hash_index is null or v_hash_index not ilike '%lower(tx_hash)%' then
    raise exception 'case-insensitive transaction hash unique index is missing';
  end if;

  select pg_get_indexdef(indexrelid) into v_deal_index
  from pg_index
  where indexrelid = to_regclass('public.deals_payment_tx_hash_lower_uq');
  if v_deal_index is null or v_deal_index not ilike '%lower(payment_tx_hash)%' then
    raise exception 'case-insensitive deal payment hash unique index is missing';
  end if;

  if has_function_privilege('anon', v_proc, 'EXECUTE')
     or has_function_privilege('authenticated', v_proc, 'EXECUTE')
     or not has_function_privilege('service_role', v_proc, 'EXECUTE') then
    raise exception 'atomic deal payment RPC grants are not service-role-only';
  end if;
end;
$$;

rollback;
