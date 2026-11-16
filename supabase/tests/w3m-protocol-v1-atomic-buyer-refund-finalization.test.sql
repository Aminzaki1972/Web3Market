-- Disposable PostgreSQL contract tests for atomic buyer-refund receipt finalization.
-- No production connection, signing, broadcast, or funds movement is performed.
\set ON_ERROR_STOP on
begin;

do $schema$
declare
  v_fn regprocedure;
  v_definition text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='w3m_buyer_refund_receipts' and c.relrowsecurity
  ) then raise exception 'Buyer refund receipt ledger RLS is not enabled'; end if;

  if has_table_privilege('anon','public.w3m_buyer_refund_receipts','SELECT')
     or has_table_privilege('authenticated','public.w3m_buyer_refund_receipts','SELECT')
     or has_table_privilege('service_role','public.w3m_buyer_refund_receipts','INSERT')
     or has_table_privilege('service_role','public.w3m_buyer_refund_receipts','UPDATE') then
    raise exception 'Buyer refund receipt ledger direct table privileges are too broad';
  end if;

  v_fn := 'public.w3m_finalize_buyer_refund(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)'::regprocedure;
  if has_function_privilege('anon',v_fn,'EXECUTE')
     or has_function_privilege('authenticated',v_fn,'EXECUTE')
     or not has_function_privilege('service_role',v_fn,'EXECUTE') then
    raise exception 'Buyer refund finalization RPC must be service-role-only';
  end if;

  select pg_get_functiondef(v_fn) into v_definition;
  if position('from public.deal_disputes' in lower(v_definition))=0
     or position('from public.deals' in lower(v_definition))=0
     or position('from public.deal_disputes' in lower(v_definition)) >
        position('from public.deals' in lower(v_definition)) then
    raise exception 'Refund finalizer lock order must be dispute -> deal -> Safe transaction';
  end if;
  if position('for update' in lower(v_definition))=0
     or position('buyer_wins' in lower(v_definition))=0
     or position('round(v_original * 0.075,18)' in lower(v_definition))=0
     or position('two distinct recorded safe-owner signatures' in lower(v_definition))=0
     or position('w3m_buyer_refund_confirmed' in lower(v_definition))=0
     or position('receipt_block_hash' in lower(v_definition))=0
     or position('status=''cancelled''' in lower(v_definition))=0 then
    raise exception 'Atomic buyer refund finalizer is missing a required lock, binding, fee, or state transition';
  end if;

  if not exists(select 1 from pg_trigger where tgname='w3m_buyer_refund_receipts_immutable' and not tgisinternal) then
    raise exception 'Immutable buyer refund receipt trigger is missing';
  end if;

  if not exists(
    select 1 from pg_indexes where schemaname='public'
      and tablename='w3m_buyer_refund_receipts'
      and indexdef ilike 'CREATE UNIQUE INDEX%' and indexdef ilike '%(request_id)%'
  ) then raise exception 'One final receipt per refund request must be enforced'; end if;
end;
$schema$;

-- Malformed calls must fail before writing any ledger or transaction row.
do $fail_closed$
begin
  begin
    perform public.w3m_finalize_buyer_refund(null,null,null,null,null,null,null,null,null,null);
    raise exception 'Malformed finalization call was accepted';
  exception when sqlstate '22023' then null;
  end;
  if (select count(*) from public.w3m_buyer_refund_receipts) <> 0 then
    raise exception 'Malformed finalization call wrote a receipt';
  end if;
end;
$fail_closed$;

-- Append-only receipt ledger rejects UPDATE, DELETE and TRUNCATE even when empty.
do $immutable$
begin
  begin
    update public.w3m_buyer_refund_receipts set finalized_at=finalized_at;
    raise exception 'Receipt UPDATE was not blocked';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.w3m_buyer_refund_receipts;
    raise exception 'Receipt DELETE was not blocked';
  exception when sqlstate '55000' then null;
  end;
  begin
    truncate table public.w3m_buyer_refund_receipts;
    raise exception 'Receipt TRUNCATE was not blocked';
  exception when sqlstate '55000' then null;
  end;
end;
$immutable$;

rollback;
