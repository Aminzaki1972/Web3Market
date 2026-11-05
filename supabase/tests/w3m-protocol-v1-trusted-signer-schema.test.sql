-- Runs only against disposable PostgreSQL in isolated GitHub Actions.
-- Verifies the server-only, append-only trusted signer key lifecycle registry.

do $$
declare
  v_key_id text := 'w3m-ci-signer-key-001';
  v_bad_key_id text := 'w3m-ci-signer-key-rollback';
  v_result jsonb;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'w3m_trusted_signer_keys' and c.relrowsecurity
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'w3m_trusted_signer_key_events' and c.relrowsecurity
  ) then
    raise exception 'Trusted signer registry RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.w3m_trusted_signer_keys', 'SELECT')
     or has_table_privilege('authenticated', 'public.w3m_trusted_signer_keys', 'SELECT')
     or has_table_privilege('anon', 'public.w3m_trusted_signer_key_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.w3m_trusted_signer_key_events', 'SELECT')
     or has_table_privilege('anon', 'public.w3m_trusted_signer_key_status', 'SELECT')
     or has_table_privilege('authenticated', 'public.w3m_trusted_signer_key_status', 'SELECT') then
    raise exception 'Browser roles unexpectedly have trusted signer registry access';
  end if;

  if not has_table_privilege('service_role', 'public.w3m_trusted_signer_keys', 'SELECT')
     or not has_table_privilege('service_role', 'public.w3m_trusted_signer_key_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.w3m_trusted_signer_key_status', 'SELECT')
     or has_table_privilege('service_role', 'public.w3m_trusted_signer_keys', 'INSERT')
     or has_table_privilege('service_role', 'public.w3m_trusted_signer_keys', 'UPDATE')
     or has_table_privilege('service_role', 'public.w3m_trusted_signer_keys', 'DELETE')
     or has_table_privilege('service_role', 'public.w3m_trusted_signer_key_events', 'INSERT')
     or has_table_privilege('service_role', 'public.w3m_trusted_signer_key_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.w3m_trusted_signer_key_events', 'DELETE') then
    raise exception 'Trusted signer registry privileges are not read-only for service_role';
  end if;

  if not has_function_privilege('service_role',
       'public.w3m_register_trusted_signer_key(jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.w3m_revoke_trusted_signer_key(text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.w3m_register_trusted_signer_key(jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_register_trusted_signer_key(jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.w3m_revoke_trusted_signer_key(text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_revoke_trusted_signer_key(text,jsonb)', 'EXECUTE') then
    raise exception 'Trusted signer lifecycle RPC permissions are not service-role-only';
  end if;

  v_result := public.w3m_register_trusted_signer_key(
    jsonb_build_object(
      'key_id', v_key_id,
      'algorithm', 'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
      'public_address', '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
      'valid_from', (now() - interval '1 minute')::text,
      'valid_until', (now() + interval '1 day')::text,
      'created_by', 'ci-test-admin'
    ),
    jsonb_build_object(
      'key_id', v_key_id,
      'event_type', 'ACTIVATED',
      'actor_type', 'ADMIN',
      'actor_ref', 'ci-test-admin',
      'reason', 'Disposable CI signer key activation',
      'event_hash', repeat('a', 64)
    )
  );

  if v_result->>'registered' <> 'true'
     or (select status from public.w3m_trusted_signer_key_status where key_id = v_key_id) <> 'ACTIVE' then
    raise exception 'Trusted signer key did not register as active';
  end if;

  v_result := public.w3m_revoke_trusted_signer_key(
    v_key_id,
    jsonb_build_object(
      'key_id', v_key_id,
      'event_type', 'REVOKED',
      'actor_type', 'ADMIN',
      'actor_ref', 'ci-test-admin',
      'reason', 'Disposable CI revocation test',
      'event_hash', repeat('b', 64)
    )
  );

  if v_result->>'revoked' <> 'true'
     or (select status from public.w3m_trusted_signer_key_status where key_id = v_key_id) <> 'REVOKED'
     or (select count(*) from public.w3m_trusted_signer_key_events where key_id = v_key_id) <> 2 then
    raise exception 'Signer revocation did not append an event and update derived status';
  end if;

  begin
    perform public.w3m_register_trusted_signer_key(
      jsonb_build_object(
        'key_id', v_bad_key_id,
        'algorithm', 'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST',
        'public_address', '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
        'valid_from', now()::text,
        'created_by', 'ci-test-admin'
      ),
      jsonb_build_object(
        'key_id', v_bad_key_id,
        'event_type', 'ACTIVATED',
        'actor_type', 'ADMIN',
        'actor_ref', 'ci-test-admin',
        'reason', 'Must roll back due to malformed hash',
        'event_hash', 'bad-hash'
      )
    );
    raise exception 'Malformed signer event hash unexpectedly passed';
  exception
    when check_violation then
      null;
  end;

  if exists (select 1 from public.w3m_trusted_signer_keys where key_id = v_bad_key_id)
     or exists (select 1 from public.w3m_trusted_signer_key_events where key_id = v_bad_key_id) then
    raise exception 'Failed signer registration left partial key or event rows';
  end if;
end;
$$;
