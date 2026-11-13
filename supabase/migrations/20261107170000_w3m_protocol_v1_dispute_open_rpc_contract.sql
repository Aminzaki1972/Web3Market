-- W3M Protocol V1 — expose only the authenticated, participant-checked
-- dispute-opening RPC to the Deal Room. The function atomically updates both
-- deal status vocabularies and writes the audit event.
begin;

create or replace function public.open_deal_dispute(p_deal_id uuid, p_reason text)
returns public.deal_disputes
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_deal public.deals%rowtype;
  v_dispute public.deal_disputes%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_deal_id is null or p_reason is null
     or length(btrim(p_reason)) < 10
     or length(btrim(p_reason)) > 5000 then
    raise exception 'Dispute reason must contain between 10 and 5000 characters'
      using errcode = '22023';
  end if;

  select * into v_deal
    from public.deals
   where id = p_deal_id
   for update;

  if not found or (v_deal.buyer_id <> v_actor_id and v_deal.seller_id <> v_actor_id) then
    raise exception 'Not a deal participant' using errcode = '42501';
  end if;

  if v_deal.status = 'completed' or v_deal.dispute_status in ('resolved_buyer','resolved_seller','closed') then
    raise exception 'Completed or resolved deals cannot be disputed' using errcode = '23514';
  end if;

  insert into public.deal_disputes(deal_id, opened_by, reason, status)
  values (v_deal.id, v_actor_id, btrim(p_reason), 'open')
  returning * into v_dispute;

  update public.deals
     set status = 'disputed',
         dispute_status = 'open',
         disputed_at = now(),
         updated_at = now()
   where id = v_deal.id;

  insert into public.deal_audit_logs(deal_id, actor_id, action, old_status, new_status, metadata)
  values (v_deal.id, v_actor_id, 'dispute_opened', v_deal.status, 'disputed',
          jsonb_build_object('reason', btrim(p_reason), 'dispute_status', 'open'));

  return v_dispute;
end;
$function$;

revoke all on function public.open_deal_dispute(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.open_deal_dispute(uuid, text)
  to authenticated, service_role;

commit;
