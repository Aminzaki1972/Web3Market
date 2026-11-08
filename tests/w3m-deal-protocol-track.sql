-- PostgreSQL 16 regression checks for the W3M deal protocol-track registry.
-- Run only against the disposable database created by the matching GitHub workflow.

do $w3m_protocol_track_test$
declare
  v_backfilled uuid := '70000000-0000-4000-8000-000000000007';
  v_inserted uuid := '70000000-0000-4000-8000-000000000008';
  v_missing uuid := '70000000-0000-4000-8000-000000000009';
  v_result jsonb;
  v_count integer;
  v_rls boolean;
  v_force_rls boolean;
begin
  -- The row inserted before the migration must be classified as legacy.
  select public.w3m_get_deal_protocol_track(v_backfilled)
    into v_result;
  if v_result->>'protocol_track' <> 'legacy'
     or v_result->>'assignment_source' <> 'legacy_backfill' then
    raise exception 'preexisting_deal_was_not_backfilled_as_legacy';
  end if;

  -- Every current direct INSERT path must be classified automatically.
  insert into public.deals
    (id, project_id, buyer_id, seller_id, status, dispute_status)
  values
    (v_inserted,
     '72000000-0000-4000-8000-000000000008',
     '73000000-0000-4000-8000-000000000008',
     '74000000-0000-4000-8000-000000000008',
     'pending', 'none');

  select public.w3m_get_deal_protocol_track(v_inserted)
    into v_result;
  if v_result->>'protocol_track' <> 'legacy'
     or v_result->>'assignment_source' <> 'legacy_insert' then
    raise exception 'new_direct_insert_was_not_classified_as_legacy';
  end if;

  -- Both existing and newly inserted deals must have exactly one registry row.
  select count(*) into v_count
  from w3m_private.w3m_deal_protocol_tracks
  where deal_id in (v_backfilled, v_inserted);
  if v_count <> 2 then
    raise exception 'protocol_track_registry_row_count_mismatch';
  end if;

  -- The private registry must enforce RLS and FORCE RLS, with no direct table
  -- privileges for browser roles or the Edge Function service role.
  select c.relrowsecurity, c.relforcerowsecurity
    into v_rls, v_force_rls
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'w3m_private'
    and c.relname = 'w3m_deal_protocol_tracks';
  if v_rls is distinct from true or v_force_rls is distinct from true then
    raise exception 'protocol_track_registry_rls_not_forced';
  end if;

  if has_table_privilege('anon','w3m_private.w3m_deal_protocol_tracks','select')
     or has_table_privilege('authenticated','w3m_private.w3m_deal_protocol_tracks','select')
     or has_table_privilege('service_role','w3m_private.w3m_deal_protocol_tracks','select')
     or has_table_privilege('anon','w3m_private.w3m_deal_protocol_tracks','insert')
     or has_table_privilege('authenticated','w3m_private.w3m_deal_protocol_tracks','insert')
     or has_table_privilege('service_role','w3m_private.w3m_deal_protocol_tracks','insert')
     or has_table_privilege('anon','w3m_private.w3m_deal_protocol_tracks','update')
     or has_table_privilege('authenticated','w3m_private.w3m_deal_protocol_tracks','update')
     or has_table_privilege('service_role','w3m_private.w3m_deal_protocol_tracks','update')
     or has_table_privilege('anon','w3m_private.w3m_deal_protocol_tracks','delete')
     or has_table_privilege('authenticated','w3m_private.w3m_deal_protocol_tracks','delete')
     or has_table_privilege('service_role','w3m_private.w3m_deal_protocol_tracks','delete') then
    raise exception 'protocol_track_registry_table_privileges_are_not_least_privilege';
  end if;

  if has_function_privilege('anon','public.w3m_get_deal_protocol_track(uuid)','execute')
     or has_function_privilege('authenticated','public.w3m_get_deal_protocol_track(uuid)','execute')
     or not has_function_privilege('service_role','public.w3m_get_deal_protocol_track(uuid)','execute') then
    raise exception 'protocol_track_lookup_rpc_privileges_are_not_least_privilege';
  end if;

  -- RPC must independently reject an authenticated JWT even if called by the
  -- database owner during this test.
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.w3m_get_deal_protocol_track(v_backfilled);
    raise exception 'expected_non_service_role_lookup_rejection';
  exception when sqlstate '42501' then
    null;
  end;

  -- Missing classification is an explicit fail-closed error, not an implicit
  -- legacy fallback.
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  begin
    perform public.w3m_get_deal_protocol_track(v_missing);
    raise exception 'expected_missing_protocol_track_rejection';
  exception when sqlstate '55000' then
    null;
  end;

  -- The registry cannot be rewritten or deleted, even by a role that could
  -- otherwise reach the table. The trigger is the final immutability guard.
  begin
    update w3m_private.w3m_deal_protocol_tracks
      set protocol_track = 'v1'
      where deal_id = v_backfilled;
    raise exception 'expected_protocol_track_update_rejection';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from w3m_private.w3m_deal_protocol_tracks
      where deal_id = v_backfilled;
    raise exception 'expected_protocol_track_delete_rejection';
  exception when sqlstate '55000' then
    null;
  end;

  select count(*) into v_count
  from w3m_private.w3m_deal_protocol_tracks
  where deal_id = v_backfilled and protocol_track = 'legacy';
  if v_count <> 1 then
    raise exception 'immutable_protocol_track_was_changed';
  end if;
end;
$w3m_protocol_track_test$;
