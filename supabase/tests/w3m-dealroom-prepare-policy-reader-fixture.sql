-- Disposable test double for the already-deployed policy validation RPC.
-- The W3M reader only calls this in disposable PostgreSQL CI.
create or replace function public.validate_deal_release_policy(p_deal_id uuid)
returns jsonb
language sql
stable
as $function$
  select case
    when p_deal_id = '81000000-0000-4000-8000-000000000001'::uuid then
      jsonb_build_object('valid', false)
    else
      jsonb_build_object(
        'valid', true,
        'deal_amount', 100.000000000000000001::numeric,
        'fee_percent', 7.500000000000000000::numeric,
        'fee_amount', 7.500000000000000000::numeric,
        'seller_net_amount', 92.500000000000000001::numeric
      )
  end;
$function$;
