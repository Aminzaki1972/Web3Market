-- Disposable PostgreSQL checks for the isolated buyer-refund registry.
\set ON_ERROR_STOP on
begin;

do $schema$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='w3m_buyer_refund_requests' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname='w3m_buyer_refund_signatures' and c.relrowsecurity
  ) then
    raise exception 'Buyer refund registry RLS is not enabled';
  end if;

  if has_table_privilege('anon','public.w3m_buyer_refund_requests','SELECT')
     or has_table_privilege('authenticated','public.w3m_buyer_refund_requests','SELECT')
     or has_table_privilege('anon','public.w3m_buyer_refund_signatures','SELECT')
     or has_table_privilege('authenticated','public.w3m_buyer_refund_signatures','SELECT')
     or has_table_privilege('service_role','public.w3m_buyer_refund_requests','INSERT')
     or has_table_privilege('service_role','public.w3m_buyer_refund_requests','UPDATE')
     or has_table_privilege('service_role','public.w3m_buyer_refund_signatures','INSERT')
     or has_table_privilege('service_role','public.w3m_buyer_refund_signatures','UPDATE') then
    raise exception 'Buyer refund registry direct table privileges are too broad';
  end if;

  if has_function_privilege('anon',
       'public.w3m_record_buyer_refund_signature(uuid,uuid,text,text,text,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_record_buyer_refund_signature(uuid,uuid,text,text,text,text,jsonb)','EXECUTE')
     or not has_function_privilege('service_role',
       'public.w3m_record_buyer_refund_signature(uuid,uuid,text,text,text,text,jsonb)','EXECUTE') then
    raise exception 'Buyer refund SIGN RPC must be service-role-only';
  end if;

  if not exists(select 1 from pg_trigger where tgname='w3m_buyer_refund_requests_immutable' and not tgisinternal)
     or not exists(select 1 from pg_trigger where tgname='w3m_buyer_refund_signatures_immutable' and not tgisinternal) then
    raise exception 'Buyer refund registry append-only triggers are missing';
  end if;
end;
$schema$;

-- Statement-level mutation guards must reject even empty-table UPDATE/DELETE/TRUNCATE.
do $immutable$
begin
  begin
    update public.w3m_buyer_refund_requests set status=status;
    raise exception 'Buyer refund request UPDATE was not blocked';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.w3m_buyer_refund_signatures;
    raise exception 'Buyer refund signature DELETE was not blocked';
  exception when sqlstate '55000' then null;
  end;
  begin
    truncate table public.w3m_buyer_refund_signatures, public.w3m_buyer_refund_requests;
    raise exception 'Buyer refund request TRUNCATE was not blocked';
  exception when sqlstate '55000' then null;
  end;
end;
$immutable$;

-- Invalid/unbound calls fail closed before any database write.
do $fail_closed$
begin
  begin
    perform public.w3m_record_buyer_refund_signature(
      null,null,null,null,null,null,null
    );
    raise exception 'Malformed buyer refund SIGN call was accepted';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.w3m_buyer_refund_signatures) <> 0 then
    raise exception 'Malformed SIGN call wrote a signature';
  end if;
end;
$fail_closed$;

rollback;
