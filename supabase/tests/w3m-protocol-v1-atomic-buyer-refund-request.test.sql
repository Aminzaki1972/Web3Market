-- Disposable PostgreSQL contract checks for atomic buyer-refund request creation.
-- This test never contacts production or broadcasts a Safe transaction.
\set ON_ERROR_STOP on
begin;

do $schema$
declare
  v_definition text;
  v_signature regprocedure;
begin
  v_signature := 'public.w3m_create_buyer_refund_request(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='w3m_buyer_refund_requests' and c.relrowsecurity
  ) then
    raise exception 'Buyer refund request RLS is not enabled';
  end if;

  if has_table_privilege('anon','public.w3m_buyer_refund_requests','SELECT')
     or has_table_privilege('authenticated','public.w3m_buyer_refund_requests','SELECT')
     or has_table_privilege('anon','public.w3m_buyer_refund_requests','INSERT')
     or has_table_privilege('authenticated','public.w3m_buyer_refund_requests','INSERT')
     or has_table_privilege('service_role','public.w3m_buyer_refund_requests','INSERT') then
    raise exception 'Buyer refund request or Safe transaction direct table privileges are too broad';
  end if;

  if has_function_privilege('anon',v_signature,'EXECUTE')
     or has_function_privilege('authenticated',v_signature,'EXECUTE')
     or not has_function_privilege('service_role',v_signature,'EXECUTE') then
    raise exception 'Atomic buyer refund request RPC must be service-role-only';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  if position('for update' in lower(v_definition))=0
     or position('buyer_wins' in lower(v_definition))=0
     or position('round(v_original * 0.075,18)' in lower(v_definition))=0
     or position('safe_hash_verified' in lower(v_definition))=0
     or position('payload_verified' in lower(v_definition))=0
     or position('agreement_acceptances_verified' in lower(v_definition))=0
     or position('buyer_acceptance_digest' in lower(v_definition))=0
     or position('seller_acceptance_digest' in lower(v_definition))=0
     or position('w3m_deal_agreement_acceptances' in lower(v_definition))=0
     or position('funding_block_canonical' in lower(v_definition))=0
     or position('v_funded is distinct from v_original' in lower(v_definition))=0
     or position('v_refund + v_fee <> v_funded' in lower(v_definition))=0
     or lower(v_definition) !~ '(?s)buyer_refund_amount.*is distinct from.*buyerrefundamount.*numeric'
     or position('w3m_buyer_refund_request_created' in lower(v_definition))=0 then
    raise exception 'Atomic buyer refund RPC is missing a required validation or audit binding';
  end if;

  if not exists(select 1 from pg_trigger where tgname='w3m_buyer_refund_requests_immutable' and not tgisinternal) then
    raise exception 'Append-only buyer refund request trigger is missing';
  end if;

  if not exists(
    select 1 from pg_indexes where schemaname='public'
     and tablename='w3m_buyer_refund_requests'
     and indexdef ilike 'CREATE UNIQUE INDEX%'
     and indexdef ilike '%USING btree (deal_id, dispute_id)%'
  ) then
    raise exception 'One refund request per deal/dispute uniqueness is missing';
  end if;
end;
$schema$;

-- Malformed requests must fail before authorization, locks, or any insert.
do $fail_closed$
declare
  v_blocked boolean := false;
begin
  begin
    perform public.w3m_create_buyer_refund_request(
      null,null,null,null,null,null,null
    );
  exception when sqlstate '22023' then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Malformed buyer refund request was not rejected';
  end if;

  if (select count(*) from public.w3m_buyer_refund_requests) <> 0 then
    raise exception 'Malformed request created a buyer refund request';
  end if;
  if (select count(*) from public.deal_multisig_transactions where action='refund_to_buyer') <> 0 then
    raise exception 'Malformed request created a Safe refund transaction';
  end if;
end;
$fail_closed$;

rollback;

-- Cross-runtime rounding contract: TypeScript computes the 7.5% fee in integer
-- 18-decimal units; PostgreSQL numeric round() must produce the same result.
do $rounding$
begin
  if round(0.000000000000000006::numeric * 0.075,18) <> 0::numeric then
    raise exception 'PostgreSQL fee rounding below half of the smallest 18-decimal unit diverges from the TypeScript builder';
  end if;
  if round(0.000000000000000007::numeric * 0.075,18) <> 0.000000000000000001::numeric then
    raise exception 'PostgreSQL fee rounding at/above half of the smallest 18-decimal unit diverges from the TypeScript builder';
  end if;
end;
$rounding$;
