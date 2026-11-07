-- W3M Protocol V1 — bind PASS report insertion to a live trusted signer.
-- Isolated migration only. This closes the race between application-side
-- signature verification and concurrent signer revocation.
begin;

create or replace function public.w3m_require_active_report_signer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $signer_guard$
declare
  v_key public.w3m_trusted_signer_keys%rowtype;
begin
  -- Diagnostic reports may be unsigned; a PASS report must always be signed
  -- by a currently active, time-valid key in the append-only signer registry.
  if new.status <> 'PASS' then
    return new;
  end if;

  if new.signer_key_id is null
     or new.report_signature is null
     or new.report_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'W3M PASS report requires a valid registry signer and signature'
      using errcode = '23514';
  end if;

  -- The row lock is shared with w3m_revoke_trusted_signer_key's FOR UPDATE.
  -- Therefore insertion and revocation serialize: either this report commits
  -- while the key is active, or the revocation commits first and this fails.
  select *
    into v_key
    from public.w3m_trusted_signer_keys
   where key_id = new.signer_key_id
   for share;

  if not found then
    raise exception 'W3M PASS report signer key is not registered'
      using errcode = '23514';
  end if;

  if v_key.algorithm <> 'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST'
     or v_key.valid_from > new.issued_at
     or (v_key.valid_until is not null and v_key.valid_until <= new.issued_at)
     or not exists (
       select 1
         from public.w3m_trusted_signer_key_events e
        where e.key_id = v_key.key_id
          and e.event_type = 'ACTIVATED'
     )
     or exists (
       select 1
         from public.w3m_trusted_signer_key_events e
        where e.key_id = v_key.key_id
          and e.event_type = 'REVOKED'
     ) then
    raise exception 'W3M PASS report signer key is inactive, revoked, or outside its validity window'
      using errcode = '23514';
  end if;

  return new;
end;
$signer_guard$;

revoke all on function public.w3m_require_active_report_signer()
  from public, anon, authenticated, service_role;

drop trigger if exists w3m_acquisition_reports_require_active_signer
  on public.w3m_acquisition_reports;
create trigger w3m_acquisition_reports_require_active_signer
before insert on public.w3m_acquisition_reports
for each row execute function public.w3m_require_active_report_signer();

comment on function public.w3m_require_active_report_signer() is
  'Requires PASS reports to reference an active, time-valid trusted signer; serializes insertion against signer revocation.';

commit;
