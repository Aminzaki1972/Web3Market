-- W3M Protocol V1 — one-use connected-wallet execution package issuance.
-- Isolated draft only. Apply only to disposable PostgreSQL in CI; never deploy here.
begin;

alter table public.w3m_safe_execution_attempts
  add column package_actor_id uuid,
  add column package_hash text
    check (package_hash is null or package_hash ~ '^[0-9a-fA-F]{64}$'),
  add column package_payload jsonb
    check (package_payload is null or jsonb_typeof(package_payload) = 'object'),
  add column package_issued_at timestamptz,
  add column package_expires_at timestamptz,
  add constraint w3m_attempt_package_all_or_none check (
    (package_actor_id is null and package_hash is null and package_payload is null
      and package_issued_at is null and package_expires_at is null)
    or
    (package_actor_id is not null and package_hash is not null and package_payload is not null
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
  p_package jsonb,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $issue$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
  v_profile_wallet text;
  v_profile_verified boolean;
  v_now timestamptz := clock_timestamp();
  v_package_issued_at timestamptz;
  v_package_expires_at timestamptz;
begin
  if p_package is null or jsonb_typeof(p_package) is distinct from 'object'
     or p_package->>'issuedAt' is null or p_package->>'expiresAt' is null then
    raise exception 'Safe wallet package timestamps are missing' using errcode = '22023';
  end if;
  begin
    v_package_issued_at := (p_package->>'issuedAt')::timestamptz;
    v_package_expires_at := (p_package->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'Safe wallet package timestamps are invalid' using errcode = '22023';
  end;

  if p_attempt_id is null or p_actor_id is null
     or p_package_hash is null or p_package_hash !~ '^[0-9a-fA-F]{64}$'
     or p_package->>'protocol' is distinct from 'W3M_PROTOCOL_V1'
     or p_package->>'executorWallet' !~ '^0x[0-9a-fA-F]{40}$'
     or p_expires_at is null
     or v_package_expires_at is distinct from p_expires_at
     or v_package_issued_at > v_now
     or v_package_issued_at < v_now - interval '1 minute'
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

  select wallet_address, wallet_verified
    into v_profile_wallet, v_profile_verified
    from public.profiles
   where id = p_actor_id
   for share;
  if not found or v_profile_verified is distinct from true
     or v_profile_wallet is null
     or v_profile_wallet !~ '^0x[0-9a-fA-F]{40}$'
     or lower(v_profile_wallet) <> lower(p_package->>'executorWallet') then
    raise exception 'Authenticated participant wallet is not currently verified for package issuance'
      using errcode = '42501';
  end if;

  if v_attempt.package_hash is not null then
    if v_attempt.package_actor_id = p_actor_id
       and v_attempt.package_expires_at > v_now
       and (v_attempt.package_payload - 'issuedAt' - 'expiresAt' - 'readBlockNumber' - 'readBlockHash')
           = (p_package - 'issuedAt' - 'expiresAt' - 'readBlockNumber' - 'readBlockHash') then
      return jsonb_build_object(
        'issued', true,
        'idempotent_replay', true,
        'attempt_id', v_attempt.id,
        'package_hash', lower(v_attempt.package_hash),
        'expires_at', v_attempt.package_expires_at,
        'package', v_attempt.package_payload
      );
    end if;
    raise exception 'Execution package is immutable, expired, or bound to another actor'
      using errcode = '23505';
  end if;

  update public.w3m_safe_execution_attempts
     set package_actor_id = p_actor_id,
         package_hash = lower(p_package_hash),
         package_payload = p_package,
         package_issued_at = v_now,
         package_expires_at = p_expires_at
   where id = p_attempt_id;

  return jsonb_build_object(
    'issued', true,
    'idempotent_replay', false,
    'attempt_id', p_attempt_id,
    'package_hash', lower(p_package_hash),
    'expires_at', p_expires_at,
    'package', p_package
  );
end;
$issue$;

create or replace function public.w3m_record_safe_wallet_submission(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_package_hash text,
  p_broadcast_tx_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $submission$
declare
  v_attempt public.w3m_safe_execution_attempts%rowtype;
  v_profile_wallet text;
  v_profile_verified boolean;
begin
  if p_attempt_id is null or p_actor_id is null
     or p_package_hash is null or p_package_hash !~ '^[0-9a-fA-F]{64}$'
     or p_broadcast_tx_hash is null or p_broadcast_tx_hash !~ '^0x[0-9a-fA-F]{64}$' then
    raise exception 'Invalid connected-wallet submission arguments'
      using errcode = '22023';
  end if;

  select * into v_attempt
    from public.w3m_safe_execution_attempts
   where id = p_attempt_id
   for update;
  if not found then
    raise exception 'Execution attempt not found' using errcode = 'P0002';
  end if;

  if v_attempt.package_actor_id is distinct from p_actor_id
     or v_attempt.package_hash is null
     or lower(v_attempt.package_hash) <> lower(p_package_hash)
     or v_attempt.package_payload is null
     or v_attempt.package_issued_at is null
     or v_attempt.package_expires_at is null then
    raise exception 'Wallet submission is not bound to the exact issued package actor and hash'
      using errcode = '42501';
  end if;

  -- Exact retries are idempotent even after expiry; they cannot replace the
  -- already-recorded outer transaction hash.
  if v_attempt.state = 'BROADCAST'
     and lower(coalesce(v_attempt.broadcast_tx_hash,'')) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', true,
      'attempt_id', v_attempt.id, 'state', 'BROADCAST',
      'broadcast_tx_hash', lower(v_attempt.broadcast_tx_hash)
    );
  end if;

  if v_attempt.state = 'RECONCILIATION_REQUIRED'
     and v_attempt.broadcast_tx_hash is not null
     and lower(v_attempt.broadcast_tx_hash) = lower(p_broadcast_tx_hash) then
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', true,
      'attempt_id', v_attempt.id, 'state', 'RECONCILIATION_REQUIRED',
      'broadcast_tx_hash', lower(v_attempt.broadcast_tx_hash)
    );
  end if;

  -- For a new or recovered hash, the authenticated participant must still
  -- control the exact profile wallet that received this one-use package.
  select wallet_address, wallet_verified
    into v_profile_wallet, v_profile_verified
    from public.profiles
   where id = p_actor_id
   for share;
  if not found or v_profile_verified is distinct from true
     or v_profile_wallet is null
     or v_profile_wallet !~ '^0x[0-9a-fA-F]{40}$'
     or lower(v_profile_wallet) <> lower(coalesce(v_attempt.package_payload->>'executorWallet','')) then
    raise exception 'Authenticated participant wallet verification changed after package issuance'
      using errcode = '42501';
  end if;

  -- A fresh submission from CLAIMED must happen before package expiry.
  -- RECONCILIATION_REQUIRED may still record a possibly earlier broadcast;
  -- the finalizer independently checks the canonical receipt block timestamp.
  if v_attempt.state = 'CLAIMED'
     and v_attempt.package_expires_at <= clock_timestamp() then
    raise exception 'Connected-wallet package has expired'
      using errcode = '23514';
  end if;

  if v_attempt.state = 'RECONCILIATION_REQUIRED'
     and v_attempt.broadcast_tx_hash is null then
    update public.w3m_safe_execution_attempts
       set broadcast_tx_hash = lower(p_broadcast_tx_hash),
           broadcast_at = clock_timestamp()
     where id = p_attempt_id;
    return jsonb_build_object(
      'recorded', true, 'idempotent_replay', false,
      'attempt_id', v_attempt.id, 'state', 'RECONCILIATION_REQUIRED',
      'broadcast_tx_hash', lower(p_broadcast_tx_hash)
    );
  end if;

  if v_attempt.state is distinct from 'CLAIMED' then
    raise exception 'Attempt cannot accept a new connected-wallet transaction hash'
      using errcode = '23514';
  end if;

  update public.w3m_safe_execution_attempts
     set state = 'BROADCAST',
         broadcast_tx_hash = lower(p_broadcast_tx_hash),
         broadcast_at = clock_timestamp()
   where id = p_attempt_id;

  return jsonb_build_object(
    'recorded', true, 'idempotent_replay', false,
    'attempt_id', v_attempt.id, 'state', 'BROADCAST',
    'broadcast_tx_hash', lower(p_broadcast_tx_hash)
  );
end;
$submission$;

revoke all on function public.w3m_issue_safe_execution_package(uuid,uuid,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_issue_safe_execution_package(uuid,uuid,text,jsonb,timestamptz)
  to service_role;

revoke all on function public.w3m_record_safe_wallet_submission(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_record_safe_wallet_submission(uuid,uuid,text,text)
  to service_role;

commit;
