-- Exact-text contract test for the read-only PREPARE policy wrapper.
do $test$
declare
  v record;
begin
  if not has_function_privilege('service_role',
       'public.w3m_read_validated_release_policy(uuid)', 'EXECUTE')
     or has_function_privilege('anon',
       'public.w3m_read_validated_release_policy(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_read_validated_release_policy(uuid)', 'EXECUTE') then
    raise exception 'Validated PREPARE policy reader must be service-role-only';
  end if;

  select * into v
  from public.w3m_read_validated_release_policy('81000000-0000-4000-8000-000000000002'::uuid);

  if v.valid <> 'true'
     or v.deal_amount <> '100.000000000000000001'
     or v.fee_percent <> '7.500000000000000000'
     or v.fee_amount <> '7.500000000000000000'
     or v.seller_net_amount <> '92.500000000000000001' then
    raise exception 'PREPARE policy reader did not preserve exact validator decimal text';
  end if;

  select * into v
  from public.w3m_read_validated_release_policy('81000000-0000-4000-8000-000000000001'::uuid);
  if v.valid <> 'false' then
    raise exception 'Invalid release policy was not preserved as a false validation result';
  end if;
end;
$test$;
