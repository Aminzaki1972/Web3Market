-- W3M Protocol V1 — pin the existing authenticated dispute-opening RPC
-- in the isolated migration chain so the finalizer/dispute lock contract is
-- tested against the same function body used by the current production schema.
-- This is not a new dispute-resolution or refund capability.
begin;

create or replace function public.open_deal_dispute(p_deal_id uuid, p_reason text)
returns public.deal_disputes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  d public.deals;
  x public.deal_disputes;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into d
    from public.deals
   where id = p_deal_id
   for update;

  if d.id is null or (d.buyer_id <> auth.uid() and d.seller_id <> auth.uid()) then
    raise exception 'Not a deal participant';
  end if;

  if d.status = 'completed' then
    raise exception 'Completed deals cannot be disputed';
  end if;

  insert into public.deal_disputes(deal_id, opened_by, reason)
  values (d.id, auth.uid(), nullif(trim(p_reason), ''))
  returning * into x;

  update public.deals
     set status = 'disputed',
         disputed_at = now(),
         updated_at = now()
   where id = d.id;

  insert into public.deal_audit_logs(deal_id, actor_id, action, old_status, new_status, metadata)
  values (d.id, auth.uid(), 'dispute_opened', d.status, 'disputed',
          jsonb_build_object('reason', p_reason));

  return x;
end;
$function$;

revoke all on function public.open_deal_dispute(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.open_deal_dispute(uuid, text)
  to service_role;

commit;
