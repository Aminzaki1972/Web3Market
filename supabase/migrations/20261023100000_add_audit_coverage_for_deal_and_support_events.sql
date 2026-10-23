-- Extend central audit coverage to deal communications, dispute workflow,
-- party agreements, multisig transaction state, and support message metadata.
-- Never copy message bodies, attachment paths, signatures, tx hashes, wallet addresses,
-- financial values, or payment-monitor secrets into the central audit archive.
-- Intentionally staged on the security PR branch; not applied to production.

create or replace function public.w3m_audit_deal_message_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
begin
  insert into public.admin_audit_log
    (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
  values (
    coalesce(auth.uid(), case when (v_row->>'sender_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'sender_id')::uuid else null end),
    'Deals',
    case TG_OP when 'INSERT' then 'deal_message_sent' else 'deal_message_deleted' end,
    'deal', v_row->>'deal_id',
    case TG_OP when 'INSERT' then 'Deal-room message metadata recorded' else 'Deal-room message removed' end,
    jsonb_build_object('message_id',v_row->>'id','sender_role',v_row->>'sender_role'),
    'recorded','db_trigger'
  );
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

create or replace function public.w3m_audit_support_message_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
begin
  insert into public.admin_audit_log
    (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
  values (
    coalesce(auth.uid(), case when (v_row->>'sender_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'sender_id')::uuid else null end),
    'Support',
    case TG_OP when 'INSERT' then 'support_message_sent' else 'support_message_deleted' end,
    'support_conversation', v_row->>'conversation_id',
    case TG_OP when 'INSERT' then 'Support message metadata recorded' else 'Support message removed' end,
    jsonb_build_object('message_id',v_row->>'id','has_attachment',coalesce(nullif(v_row->>'attachment_path',''),'') <> ''),
    'recorded','db_trigger'
  );
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

create or replace function public.w3m_audit_deal_subworkflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_action text;
  v_category text := 'Deals';
  v_target_type text;
  v_target_id text;
  v_summary text;
  v_details jsonb := '{}'::jsonb;
begin
  if TG_TABLE_NAME = 'deal_disputes' then
    v_action := case TG_OP when 'INSERT' then 'dispute_opened' when 'DELETE' then 'dispute_record_deleted' else 'dispute_status_changed' end;
    v_target_type := 'deal';
    v_target_id := v_row->>'deal_id';
    v_summary := case TG_OP when 'INSERT' then 'Deal dispute opened' when 'DELETE' then 'Deal dispute record removed' else 'Deal dispute state updated' end;
    v_details := jsonb_build_object(
      'dispute_id',v_row->>'id',
      'old_status',v_old->>'status','new_status',v_new->>'status',
      'status_changed',(v_old->>'status') is distinct from (v_new->>'status')
    );
  elsif TG_TABLE_NAME = 'deal_party_agreements' then
    v_action := case TG_OP when 'INSERT' then 'deal_party_agreement_created' when 'DELETE' then 'deal_party_agreement_deleted' else 'deal_party_agreement_updated' end;
    v_target_type := 'deal';
    v_target_id := v_row->>'deal_id';
    v_summary := case TG_OP when 'INSERT' then 'Deal party agreement recorded' when 'DELETE' then 'Deal party agreement removed' else 'Deal party agreement updated' end;
    v_details := jsonb_build_object('agreement_id',v_row->>'id','party_role',v_row->>'party_role','agreed',coalesce(v_row->>'agreed_at','') <> '');
  elsif TG_TABLE_NAME = 'deal_multisig_transactions' then
    v_action := case TG_OP when 'INSERT' then 'multisig_transaction_created' when 'DELETE' then 'multisig_transaction_deleted' else 'multisig_transaction_state_changed' end;
    v_target_type := 'deal';
    v_target_id := v_row->>'deal_id';
    v_summary := case TG_OP when 'INSERT' then 'Multisig transaction metadata recorded' when 'DELETE' then 'Multisig transaction record removed' else 'Multisig transaction state updated' end;
    v_details := jsonb_build_object(
      'multisig_record_id',v_row->>'id',
      'old_action',v_old->>'action','new_action',v_new->>'action',
      'old_status',v_old->>'status','new_status',v_new->>'status',
      'old_confirmations_count',v_old->>'confirmations_count','new_confirmations_count',v_new->>'confirmations_count'
    );
  end if;

  if TG_OP in ('INSERT','DELETE')
     or (TG_TABLE_NAME = 'deal_disputes' and ((v_old->>'status') is distinct from (v_new->>'status')))
     or (TG_TABLE_NAME = 'deal_party_agreements' and ((v_old->>'agreed_at') is distinct from (v_new->>'agreed_at') or (v_old->>'party_role') is distinct from (v_new->>'party_role')))
     or (TG_TABLE_NAME = 'deal_multisig_transactions' and ((v_old->>'status') is distinct from (v_new->>'status') or (v_old->>'action') is distinct from (v_new->>'action') or (v_old->>'confirmations_count') is distinct from (v_new->>'confirmations_count'))) then
    insert into public.admin_audit_log
      (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
    values (
      coalesce(auth.uid(), case when (v_row->>'opened_by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'opened_by')::uuid else null end, case when (v_row->>'party_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_row->>'party_id')::uuid else null end),
      v_category, v_action, v_target_type, v_target_id, v_summary, v_details,
      'recorded','db_trigger'
    );
  end if;

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

drop trigger if exists w3m_audit_deal_messages on public.deal_messages;
create trigger w3m_audit_deal_messages
after insert or delete on public.deal_messages
for each row execute function public.w3m_audit_deal_message_metadata();

drop trigger if exists w3m_audit_support_messages on public.support_messages;
create trigger w3m_audit_support_messages
after insert or delete on public.support_messages
for each row execute function public.w3m_audit_support_message_metadata();

drop trigger if exists w3m_audit_deal_disputes on public.deal_disputes;
create trigger w3m_audit_deal_disputes
after insert or update or delete on public.deal_disputes
for each row execute function public.w3m_audit_deal_subworkflow();

drop trigger if exists w3m_audit_deal_party_agreements on public.deal_party_agreements;
create trigger w3m_audit_deal_party_agreements
after insert or update or delete on public.deal_party_agreements
for each row execute function public.w3m_audit_deal_subworkflow();

drop trigger if exists w3m_audit_deal_multisig_transactions on public.deal_multisig_transactions;
create trigger w3m_audit_deal_multisig_transactions
after insert or update or delete on public.deal_multisig_transactions
for each row execute function public.w3m_audit_deal_subworkflow();

revoke all on function public.w3m_audit_deal_message_metadata() from public, anon, authenticated;
revoke all on function public.w3m_audit_support_message_metadata() from public, anon, authenticated;
revoke all on function public.w3m_audit_deal_subworkflow() from public, anon, authenticated;
