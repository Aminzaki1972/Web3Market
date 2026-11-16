-- Disposable PostgreSQL contract checks for the dedicated buyer-refund snapshot reader.
\set ON_ERROR_STOP on
begin;

do $snapshot_contract$
declare
  v_signature regprocedure;
  v_definition text;
  v_security_definer boolean;
  v_config text[];
begin
  v_signature := 'public.w3m_read_buyer_refund_request_snapshot(uuid,uuid)'::regprocedure;

  if has_function_privilege('anon',v_signature,'EXECUTE')
     or has_function_privilege('authenticated',v_signature,'EXECUTE')
     or not has_function_privilege('service_role',v_signature,'EXECUTE') then
    raise exception 'Buyer refund snapshot reader must be service-role-only';
  end if;

  select p.prosecdef,p.proconfig,pg_get_functiondef(p.oid)
    into v_security_definer,v_config,v_definition
    from pg_proc p where p.oid=v_signature;

  if v_security_definer is distinct from true
     or not coalesce(v_config @> array['search_path=""'],false)
     or position('public.is_admin()' in lower(v_definition))=0
     or position('w3m_deal_dispute_decisions' in lower(v_definition))=0
     or position('w3m_deal_terms_versions' in lower(v_definition))=0
     or position('w3m_deal_agreement_acceptances' in lower(v_definition))=0
     or position('wallet_verified' in lower(v_definition))=0
     or position('payment_tx_hash' in lower(v_definition))=0
     or position('signature' in lower(v_definition))=0
     or position('v_decision.buyer_refund_amount::text' in lower(v_definition))=0 then
    raise exception 'Buyer refund snapshot reader is missing an authorization or fresh-context field';
  end if;

  if position('insert into ' in lower(v_definition))>0
     or position('update public.' in lower(v_definition))>0
     or position('delete from ' in lower(v_definition))>0
     or position('truncate ' in lower(v_definition))>0 then
    raise exception 'Buyer refund snapshot reader must be read-only';
  end if;
end;
$snapshot_contract$;

rollback;
