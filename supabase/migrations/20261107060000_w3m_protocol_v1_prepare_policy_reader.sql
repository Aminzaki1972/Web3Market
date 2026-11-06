-- W3M Protocol V1: expose the existing release-policy validator result as exact text.
-- This is read-only and service-role-only; it does not lock or write a policy.
begin;

create or replace function public.w3m_read_validated_release_policy(p_deal_id uuid)
returns table (
  valid text,
  deal_amount text,
  fee_percent text,
  fee_amount text,
  seller_net_amount text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_result jsonb;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;

  v_result := to_jsonb(public.validate_deal_release_policy(p_deal_id));
  if v_result is null or jsonb_typeof(v_result) <> 'object' then
    return query select 'false'::text, null::text, null::text, null::text, null::text;
    return;
  end if;

  return query select
    coalesce(v_result ->> 'valid', 'false'),
    v_result ->> 'deal_amount',
    v_result ->> 'fee_percent',
    v_result ->> 'fee_amount',
    v_result ->> 'seller_net_amount';
end;
$function$;

revoke all on function public.w3m_read_validated_release_policy(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_validated_release_policy(uuid)
  to service_role;

comment on function public.w3m_read_validated_release_policy(uuid) is
  'Read-only wrapper around the existing release policy validator; returns exact decimal text for W3M pre-lock PREPARE.';

commit;
