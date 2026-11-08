-- W3M V1: expose only the current immutable signed settlement snapshot to server-side Safe flows.
create or replace function public.w3m_get_current_deal_settlement_terms(
  p_deal_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $w3m$
declare
  v_terms w3m_private.w3m_acquisition_terms_versions%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  select * into v_terms
    from w3m_private.w3m_acquisition_terms_versions
    where deal_id = p_deal_id and status = 'published';

  if not found or (
    select count(*) from w3m_private.w3m_acquisition_terms_versions
    where deal_id = p_deal_id and status = 'published'
  ) <> 1 then
    raise exception 'current_settlement_terms_not_unique' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'deal_id', v_terms.deal_id,
    'terms_version', v_terms.terms_version,
    'terms_hash', v_terms.terms_hash,
    'canonical_terms_json', v_terms.canonical_terms_json
  );
end;
$w3m$;

revoke all on function public.w3m_get_current_deal_settlement_terms(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_get_current_deal_settlement_terms(uuid)
  to service_role;

comment on function public.w3m_get_current_deal_settlement_terms(uuid) is
  'Returns the unique current immutable W3M V1 signed terms snapshot for server-side settlement verification only.';
