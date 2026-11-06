-- W3M Protocol V1 trusted signer registry.
-- Isolated migration only. Never apply to production without separate approval.
-- Stores public verification metadata only; no private signing keys.

create table if not exists public.w3m_trusted_signer_keys (
  key_id text primary key
    check (length(key_id) between 1 and 128),
  algorithm text not null
    check (algorithm = 'ECDSA_SECP256K1_KECCAK256_RAW_DIGEST'),
  public_address text not null
    check (public_address ~ '^0x[0-9a-fA-F]{40}$'),
  valid_from timestamptz not null,
  valid_until timestamptz,
  created_by text not null
    check (length(created_by) between 1 and 256),
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from)
);

create table if not exists public.w3m_trusted_signer_key_events (
  event_id bigint generated always as identity primary key,
  key_id text not null references public.w3m_trusted_signer_keys(key_id),
  event_type text not null check (event_type in ('ACTIVATED', 'REVOKED')),
  actor_type text not null check (actor_type in ('ADMIN', 'SYSTEM')),
  actor_ref text,
  reason text not null check (length(reason) between 1 and 1000),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (key_id, event_type)
);

alter table public.w3m_trusted_signer_keys enable row level security;
alter table public.w3m_trusted_signer_key_events enable row level security;

revoke all on public.w3m_trusted_signer_keys from public, anon, authenticated;
revoke all on public.w3m_trusted_signer_key_events from public, anon, authenticated;
revoke all on public.w3m_trusted_signer_keys from service_role;
revoke all on public.w3m_trusted_signer_key_events from service_role;

grant select on public.w3m_trusted_signer_keys to service_role;
grant select on public.w3m_trusted_signer_key_events to service_role;
grant usage, select on sequence public.w3m_trusted_signer_key_events_event_id_seq to service_role;

create or replace view public.w3m_trusted_signer_key_status
with (security_invoker = true)
as
select
  k.key_id,
  k.algorithm,
  lower(k.public_address) as public_address,
  k.valid_from,
  k.valid_until,
  k.created_at,
  latest.event_type as latest_event,
  case when latest.event_type = 'REVOKED' then 'REVOKED' else 'ACTIVE' end as status,
  case when latest.event_type = 'REVOKED' then latest.created_at else null end as revoked_at
from public.w3m_trusted_signer_keys k
join lateral (
  select e.event_type, e.created_at
  from public.w3m_trusted_signer_key_events e
  where e.key_id = k.key_id
  order by e.event_id desc
  limit 1
) latest on true;

revoke all on public.w3m_trusted_signer_key_status from public, anon, authenticated;
grant select on public.w3m_trusted_signer_key_status to service_role;

create or replace function public.w3m_register_trusted_signer_key(
  p_key jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key_id text;
  v_event_id bigint;
begin
  v_key_id := p_key->>'key_id';
  if v_key_id is null or length(v_key_id) not between 1 and 128 then
    raise exception 'Invalid signer key ID' using errcode = '23514';
  end if;
  if p_event->>'event_type' is distinct from 'ACTIVATED'
     or p_event->>'key_id' is distinct from v_key_id then
    raise exception 'Signer event key ID mismatch' using errcode = '23514';
  end if;

  insert into public.w3m_trusted_signer_keys (
    key_id, algorithm, public_address, valid_from, valid_until, created_by
  ) values (
    v_key_id,
    p_key->>'algorithm',
    lower(p_key->>'public_address'),
    (p_key->>'valid_from')::timestamptz,
    nullif(p_key->>'valid_until', '')::timestamptz,
    p_key->>'created_by'
  );

  insert into public.w3m_trusted_signer_key_events (
    key_id, event_type, actor_type, actor_ref, reason, event_hash
  ) values (
    v_key_id,
    'ACTIVATED',
    p_event->>'actor_type',
    p_event->>'actor_ref',
    p_event->>'reason',
    p_event->>'event_hash'
  ) returning event_id into v_event_id;

  return jsonb_build_object('registered', true, 'key_id', v_key_id, 'event_id', v_event_id);
end;
$$;

create or replace function public.w3m_revoke_trusted_signer_key(
  p_key_id text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id bigint;
begin
  if p_key_id is null or length(p_key_id) not between 1 and 128
     or p_event->>'event_type' is distinct from 'REVOKED'
     or p_event->>'key_id' is distinct from p_key_id then
    raise exception 'Invalid signer revocation request' using errcode = '23514';
  end if;

  -- Serialize revocation against any finalizer that locks this same key row.
  perform 1
    from public.w3m_trusted_signer_keys
   where key_id = p_key_id
   for update;
  if not found then
    raise exception 'Unknown signer key' using errcode = '23503';
  end if;

  insert into public.w3m_trusted_signer_key_events (
    key_id, event_type, actor_type, actor_ref, reason, event_hash
  ) values (
    p_key_id,
    'REVOKED',
    p_event->>'actor_type',
    p_event->>'actor_ref',
    p_event->>'reason',
    p_event->>'event_hash'
  ) returning event_id into v_event_id;

  return jsonb_build_object('revoked', true, 'key_id', p_key_id, 'event_id', v_event_id);
end;
$$;

revoke all on function public.w3m_register_trusted_signer_key(jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.w3m_revoke_trusted_signer_key(text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.w3m_register_trusted_signer_key(jsonb,jsonb) to service_role;
grant execute on function public.w3m_revoke_trusted_signer_key(text,jsonb) to service_role;
