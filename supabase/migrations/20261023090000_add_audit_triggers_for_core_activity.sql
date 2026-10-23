-- Central audit coverage for important future mutations.
-- This migration is intentionally staged on the security PR branch; it is NOT applied to production.
-- No existing business/deal rows are backfilled or modified.

create or replace function public.w3m_audit_project_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_changed text[];
  v_actor uuid := auth.uid();
  v_id text := coalesce(v_new->>'id', v_old->>'id');
begin
  select coalesce(array_agg(k order by k), array[]::text[]) into v_changed
  from (
    select key as k from jsonb_each(v_new)
    union
    select key as k from jsonb_each(v_old)
  ) keys
  where (v_new->k) is distinct from (v_old->k)
    and k not in ('updated_at','created_at','view_count','views');

  insert into public.admin_audit_log
    (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
  values (
    v_actor, 'Project activity',
    case TG_OP when 'INSERT' then 'project_created' when 'DELETE' then 'project_deleted' else 'project_updated' end,
    'project', v_id,
    case TG_OP when 'INSERT' then 'Project record created' when 'DELETE' then 'Project record deleted' else 'Project record updated' end,
    jsonb_build_object(
      'changed_fields', to_jsonb(v_changed),
      'old_status', v_old->>'status',
      'new_status', v_new->>'status',
      'old_project_status', v_old->>'project_status',
      'new_project_status', v_new->>'project_status',
      'old_ai_status', v_old->>'ai_status',
      'new_ai_status', v_new->>'ai_status'
    ),
    'recorded', 'db_trigger'
  );
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

create or replace function public.w3m_audit_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_changed text[];
  v_actor uuid := auth.uid();
  v_id text := coalesce(v_new->>'id', v_old->>'id');
begin
  select coalesce(array_agg(k order by k), array[]::text[]) into v_changed
  from (
    select key as k from jsonb_each(v_new)
    union
    select key as k from jsonb_each(v_old)
  ) keys
  where (v_new->k) is distinct from (v_old->k)
    and k not in ('updated_at','created_at','email','display_name','bio','avatar_url','wallet_address');

  insert into public.admin_audit_log
    (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
  values (
    v_actor, 'Accounts',
    case TG_OP when 'INSERT' then 'profile_created' when 'DELETE' then 'profile_deleted' else 'profile_updated' end,
    'profile', v_id,
    case TG_OP when 'INSERT' then 'Account profile created' when 'DELETE' then 'Account profile deleted' else 'Account profile updated' end,
    jsonb_build_object('changed_fields', to_jsonb(v_changed), 'old_role', v_old->>'role', 'new_role', v_new->>'role'),
    'recorded', 'db_trigger'
  );
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

create or replace function public.w3m_audit_deal_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_changed text[] := array[]::text[];
  v_actor uuid := auth.uid();
  v_id text := coalesce(v_new->>'id', v_old->>'id');
  v_fields text[] := array['status','payment_status','delivery_status','dispute_status','safe_deployment_status'];
  k text;
begin
  foreach k in array v_fields loop
    if (v_old->>k) is distinct from (v_new->>k) then
      v_changed := array_append(v_changed, k);
    end if;
  end loop;

  -- Avoid logging unrelated updates and avoid financial values, transaction hashes,
  -- wallet addresses, delivery payloads, or payment-monitor secrets.
  if TG_OP = 'INSERT' or TG_OP = 'DELETE' or cardinality(v_changed) > 0 then
    insert into public.admin_audit_log
      (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
    values (
      v_actor, 'Deals',
      case TG_OP when 'INSERT' then 'deal_created' when 'DELETE' then 'deal_deleted' else 'deal_lifecycle_updated' end,
      'deal', v_id,
      case TG_OP when 'INSERT' then 'Deal record created' when 'DELETE' then 'Deal record deleted' else 'Deal lifecycle status changed' end,
      jsonb_build_object(
        'changed_fields', to_jsonb(v_changed),
        'old_status', v_old->>'status', 'new_status', v_new->>'status',
        'old_payment_status', v_old->>'payment_status', 'new_payment_status', v_new->>'payment_status',
        'old_delivery_status', v_old->>'delivery_status', 'new_delivery_status', v_new->>'delivery_status',
        'old_dispute_status', v_old->>'dispute_status', 'new_dispute_status', v_new->>'dispute_status',
        'old_safe_deployment_status', v_old->>'safe_deployment_status', 'new_safe_deployment_status', v_new->>'safe_deployment_status'
      ),
      'recorded', 'db_trigger'
    );
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

create or replace function public.w3m_audit_support_conversation_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_actor uuid := auth.uid();
  v_id text := coalesce(v_new->>'id', v_old->>'id');
begin
  if TG_OP = 'INSERT' or TG_OP = 'DELETE' or (v_old->>'status') is distinct from (v_new->>'status') then
    insert into public.admin_audit_log
      (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
    values (
      v_actor, 'Support',
      case TG_OP when 'INSERT' then 'support_conversation_created' when 'DELETE' then 'support_conversation_deleted' else 'support_status_changed' end,
      'support_conversation', v_id,
      case TG_OP when 'INSERT' then 'Support conversation created' when 'DELETE' then 'Support conversation deleted' else 'Support conversation status changed' end,
      jsonb_build_object('old_status',v_old->>'status','new_status',v_new->>'status'),
      'recorded', 'db_trigger'
    );
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

drop trigger if exists w3m_audit_projects on public.projects;
create trigger w3m_audit_projects
after insert or update or delete on public.projects
for each row execute function public.w3m_audit_project_mutation();

drop trigger if exists w3m_audit_profiles on public.profiles;
create trigger w3m_audit_profiles
after insert or update or delete on public.profiles
for each row execute function public.w3m_audit_profile_mutation();

drop trigger if exists w3m_audit_deals on public.deals;
create trigger w3m_audit_deals
after insert or update or delete on public.deals
for each row execute function public.w3m_audit_deal_lifecycle();

drop trigger if exists w3m_audit_support_conversations on public.support_conversations;
create trigger w3m_audit_support_conversations
after insert or update or delete on public.support_conversations
for each row execute function public.w3m_audit_support_conversation_mutation();

revoke all on function public.w3m_audit_project_mutation() from public, anon, authenticated;
revoke all on function public.w3m_audit_profile_mutation() from public, anon, authenticated;
revoke all on function public.w3m_audit_deal_lifecycle() from public, anon, authenticated;
revoke all on function public.w3m_audit_support_conversation_mutation() from public, anon, authenticated;
