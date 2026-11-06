-- W3M Protocol V1 — one-use connected-wallet execution package issuance.
-- Isolated draft only. Apply only to disposable PostgreSQL in CI; never deploy here.
begin;

alter table public.w3m_safe_execution_attempts
  add column package_actor_id uuid,
  add column package_hash text
    check (package_hash is null or package_hash ~ '^[0-9a-fA-F]{64}$'),
  add column package_issued_at timestamptz,
  add column package_expires_at timestamptz,
  add constraint w3m_attempt_package_all_or_none check (
    (package_actor_id is null and package_hash is null
      and package_issued_at is null and package_expires_at is null)
    or
    (package_actor_id is not null and package_hash is not null
      and package_issued_at is not null and package_expires_at is not null
      and package_expires_at > package_issued_at)
  );

comment on column public.w3m_safe_execution_attempts.package_hash is
  'SHA-256 of the exact canonical connected-wallet Safe execution package; immutable after issuance.';
comment on column public.w3m_safe_execution_attempts.package_expires_at is
  'Short package validity window; expired or changed packages cannot be reissued under the same attempt.';

create or replace function public.w3m_issue_safe_execution_package(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_package_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $issue$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_attempt_id is null or p_actor_id is null
     or p_package_hash is null or p_package_hash !~ '^[0-9a-fA-F]{64}$'
     or p_expires_at is null
     or p_expires_at <= v_now
     or p_expires_at > v_now + interval '2 minutes' then
    raise exception 'Invalid or excessive Safe package issuance window'
      using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then
    raise exception 'Execution attempt not found' using errcode = 'P0002';
  end if;

  if v_attempt.executor_ref is distinct from p_actor_id::text then
    raise exception 'Execution package actor does not own the claim'
      using errcode = '42501';
  end if;
  if v_attempt.state is distinct from 'CLAIMED' then
    raise exception 'Only a still-claimed attempt may issue a wallet package'
      using errcode = '23514';
  end if;

  if v_attempt.package_hash is not null then
    if v_attempt.package_actor_id = p_actor_id
       and lower(v_attempt.package_hash) = lower(p_package_hash)
       and v_attempt.package_expires_at > v_now then
      return jsonb_build_object(
        'issued', true,
        'idempotent_replay', true,
        'attempt_id', v_attempt.id,
        'package_hash', lower(v_attempt.package_hash),
        'expires_at', v_attempt.package_expires_at
      );
    end if;
    raise exception 'Execution package is immutable, expired, or bound to another actor'
      using errcode = '23505';
  end if;

  update public.w3m_safe_execution_attempts
     set package_actor_id = p_actor_id,
         package_hash = lower(p_package_hash),
         package_issued_at = v_now,
         package_expires_at = p_expires_at
   where id = p_attempt_id;

  return jsonb_build_object(
    'issued', true,
    'idempotent_replay', false,
    'attempt_id', p_attempt_id,
    'package_hash', lower(p_package_hash),
    'expires_at', p_expires_at
  );
end;
$issue$;

revoke all on function public.w3m_issue_safe_execution_package(uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_issue_safe_execution_package(uuid,uuid,text,timestamptz)
  to service_role;

commit;
