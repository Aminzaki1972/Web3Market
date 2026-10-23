-- Core activity audit triggers for project lifecycle and security-sensitive profile changes.
-- Staged for review only; do not apply to production until the migration is tested.
-- No project descriptions, emails, wallet addresses, credentials, or financial details are copied.

create or replace function public.w3m_audit_core_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when TG_OP = 'INSERT' then '{}'::jsonb else to_jsonb(OLD) end;
  v_new jsonb := case when TG_OP = 'DELETE' then '{}'::jsonb else to_jsonb(NEW) end;
  v_row jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  v_actor uuid;
  v_action text;
  v_category text;
  v_target_type text;
  v_target_id text;
  v_summary text;
  v_changed text[] := array[]::text[];
  v_details jsonb := '{}'::jsonb;
begin
  if TG_TABLE_NAME = 'projects' then
    v_category := 'Project activity';
    v_target_type := 'project';
    v_target_id := v_row->>'id';
    v_actor := coalesce(auth.uid(), nullif(v_row->>'owner_id','')::uuid);

    if TG_OP = 'INSERT' then
      v_action := 'project_created';
      v_summary := 'Project listing created';
      v_details := jsonb_build_object('status',v_new->>'status','project_status',v_new->>'project_status','ai_status',v_new->>'ai_status');
    elsif TG_OP = 'DELETE' then
      v_action := 'project_deleted';
      v_summary := 'Project listing deleted';
      v_details := jsonb_build_object('previous_status',v_old->>'status','previous_project_status',v_old->>'project_status','previous_ai_status',v_old->>'ai_status');
    else
      if v_old->>'status' is distinct from v_new->>'status' then v_changed := array_append(v_changed,'status'); end if;
      if v_old->>'project_status' is distinct from v_new->>'project_status' then v_changed := array_append(v_changed,'project_status'); end if;
      if v_old->>'ai_status' is distinct from v_new->>'ai_status' then v_changed := array_append(v_changed,'ai_status'); end if;
      if v_old->>'owner_id' is distinct from v_new->>'owner_id' then v_changed := array_append(v_changed,'owner_id'); end if;
      if v_old->>'title' is distinct from v_new->>'title' then v_changed := array_append(v_changed,'title'); end if;
      if cardinality(v_changed) = 0 then return NEW; end if;
      v_action := 'project_key_fields_updated';
      v_summary := 'Project lifecycle or ownership fields changed';
      v_details := jsonb_build_object(
        'changed_fields',to_jsonb(v_changed),
        'previous_status',v_old->>'status','new_status',v_new->>'status',
        'previous_project_status',v_old->>'project_status','new_project_status',v_new->>'project_status',
        'previous_ai_status',v_old->>'ai_status','new_ai_status',v_new->>'ai_status',
        'owner_changed',(v_old->>'owner_id') is distinct from (v_new->>'owner_id')
      );
    end if;
  elsif TG_TABLE_NAME = 'profiles' then
    v_category := 'Accounts';
    v_target_type := 'profile';
    v_target_id := v_row->>'id';
    v_actor := coalesce(auth.uid(), nullif(v_row->>'id','')::uuid);

    if TG_OP = 'INSERT' then
      v_action := 'profile_created';
      v_summary := 'Account profile created';
      v_details := jsonb_build_object('role',v_new->>'role');
    elsif TG_OP = 'DELETE' then
      v_action := 'profile_deleted';
      v_summary := 'Account profile deleted';
      v_details := jsonb_build_object('previous_role',v_old->>'role');
    else
      if v_old->>'role' is distinct from v_new->>'role' then v_changed := array_append(v_changed,'role'); end if;
      if v_old->>'wallet_verified' is distinct from v_new->>'wallet_verified' then v_changed := array_append(v_changed,'wallet_verified'); end if;
      if cardinality(v_changed) = 0 then return NEW; end if;
      v_action := 'profile_security_fields_updated';
      v_summary := 'Account role or wallet-verification state changed';
      v_details := jsonb_build_object(
        'changed_fields',to_jsonb(v_changed),
        'previous_role',v_old->>'role','new_role',v_new->>'role',
        'previous_wallet_verified',v_old->>'wallet_verified','new_wallet_verified',v_new->>'wallet_verified'
      );
    end if;
  else
    raise exception 'Unsupported table for audit trigger: %', TG_TABLE_NAME;
  end if;

  insert into public.admin_audit_log
    (actor_id, category, action, target_type, target_id, summary, details, outcome, source)
  values (v_actor, v_category, v_action, v_target_type, v_target_id, v_summary, v_details, 'recorded', 'db_trigger');

  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

drop trigger if exists w3m_audit_projects on public.projects;
create trigger w3m_audit_projects
after insert or update or delete on public.projects
for each row execute function public.w3m_audit_core_activity();

drop trigger if exists w3m_audit_profiles on public.profiles;
create trigger w3m_audit_profiles
after insert or update or delete on public.profiles
for each row execute function public.w3m_audit_core_activity();

revoke all on function public.w3m_audit_core_activity() from public, anon, authenticated;
