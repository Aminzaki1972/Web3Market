-- W3M Protocol V1: server-only, append-only agreement evidence and atomic nonce consumption.
-- Draft migration in PR #181. Do NOT apply to production until reviewed and explicitly approved.
-- No foreign keys are used so protocol evidence survives deletion/retention of marketplace rows.

create table if not exists public.w3m_deal_audit_bindings (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  project_id uuid not null,
  audit_id uuid not null,
  fingerprint_id uuid not null,
  fingerprint_digest text not null check (fingerprint_digest ~ '^[0-9a-f]{64}$'),
  repository text not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint w3m_binding_one_per_deal unique (deal_id),
  constraint w3m_binding_fingerprint_identity unique (fingerprint_id, fingerprint_digest)
);

create table if not exists public.w3m_acquisition_terms_versions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  terms_version bigint not null check (terms_version > 0),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  canonical_terms_json jsonb not null,
  status text not null check (status in ('published','superseded')),
  published_at timestamptz not null default now(),
  constraint w3m_terms_one_version_per_deal unique (deal_id, terms_version),
  constraint w3m_terms_one_hash_per_deal unique (deal_id, terms_hash)
);
create unique index if not exists w3m_terms_one_current_version_per_deal
  on public.w3m_acquisition_terms_versions (deal_id) where status = 'published';

create table if not exists public.w3m_agreement_challenges (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  project_id uuid not null,
  audit_id uuid not null,
  fingerprint_id uuid not null,
  fingerprint_digest text not null check (fingerprint_digest ~ '^[0-9a-f]{64}$'),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  terms_version bigint not null check (terms_version > 0),
  party_role text not null check (party_role in ('buyer','seller')),
  user_id uuid not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  nonce text not null unique check (nonce ~ '^0x[0-9a-fA-F]{64}$'),
  signature_deadline bigint not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint w3m_challenge_deadline_window check (
    signature_deadline > extract(epoch from created_at)::bigint
    and signature_deadline <= extract(epoch from created_at)::bigint + 900
  )
);

create table if not exists public.w3m_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.w3m_agreement_challenges(id) on delete restrict,
  deal_id uuid not null,
  project_id uuid not null,
  audit_id uuid not null,
  fingerprint_id uuid not null,
  fingerprint_digest text not null check (fingerprint_digest ~ '^[0-9a-f]{64}$'),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  terms_version bigint not null check (terms_version > 0),
  party_role text not null check (party_role in ('buyer','seller')),
  user_id uuid not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  signature text not null check (signature ~ '^0x[0-9a-fA-F]{130}$'),
  nonce text not null unique check (nonce ~ '^0x[0-9a-fA-F]{64}$'),
  signature_deadline bigint not null,
  accepted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint w3m_acceptance_one_party_per_terms unique (deal_id, terms_version, party_role),
  constraint w3m_acceptance_deadline check (
    extract(epoch from accepted_at)::bigint <= signature_deadline
    and extract(epoch from accepted_at)::bigint >= signature_deadline - 900
  )
);

-- These records are never directly accessible to browser roles.
alter table public.w3m_deal_audit_bindings enable row level security;
alter table public.w3m_acquisition_terms_versions enable row level security;
alter table public.w3m_agreement_challenges enable row level security;
alter table public.w3m_agreement_acceptances enable row level security;
revoke all on public.w3m_deal_audit_bindings, public.w3m_acquisition_terms_versions,
  public.w3m_agreement_challenges, public.w3m_agreement_acceptances
  from anon, authenticated;
grant select, insert on public.w3m_deal_audit_bindings,
  public.w3m_acquisition_terms_versions to service_role;
grant select, insert, update on public.w3m_agreement_challenges to service_role;
grant select, insert on public.w3m_agreement_acceptances to service_role;

create or replace function public.w3m_issue_agreement_challenge(
  p_deal_id uuid,
  p_project_id uuid,
  p_audit_id uuid,
  p_fingerprint_id uuid,
  p_fingerprint_digest text,
  p_binding_hash text,
  p_terms_hash text,
  p_terms_version bigint,
  p_party_role text,
  p_user_id uuid,
  p_wallet_address text,
  p_nonce text,
  p_signature_deadline bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_now bigint := extract(epoch from clock_timestamp())::bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_party_role not in ('buyer','seller') or p_terms_version < 1
    or p_fingerprint_digest !~ '^[0-9a-f]{64}$'
    or p_binding_hash !~ '^[0-9a-f]{64}$'
    or p_terms_hash !~ '^[0-9a-f]{64}$'
    or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
    or p_nonce !~ '^0x[0-9a-fA-F]{64}$'
    or p_signature_deadline <= v_now
    or p_signature_deadline > v_now + 900 then
    raise exception 'invalid_challenge_parameters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.w3m_deal_audit_bindings b
    where b.deal_id = p_deal_id and b.project_id = p_project_id
      and b.audit_id = p_audit_id and b.fingerprint_id = p_fingerprint_id
      and b.fingerprint_digest = p_fingerprint_digest and b.binding_hash = p_binding_hash
  ) then
    raise exception 'trusted_deal_audit_binding_not_found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.w3m_acquisition_terms_versions t
    where t.deal_id = p_deal_id and t.terms_version = p_terms_version
      and t.terms_hash = p_terms_hash and t.status = 'published'
  ) then
    raise exception 'current_terms_version_not_found' using errcode = '23503';
  end if;
  insert into public.w3m_agreement_challenges (
    deal_id, project_id, audit_id, fingerprint_id, fingerprint_digest,
    binding_hash, terms_hash, terms_version, party_role, user_id,
    wallet_address, nonce, signature_deadline
  ) values (
    p_deal_id, p_project_id, p_audit_id, p_fingerprint_id, p_fingerprint_digest,
    p_binding_hash, p_terms_hash, p_terms_version, p_party_role, p_user_id,
    lower(p_wallet_address), lower(p_nonce), p_signature_deadline
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.w3m_record_agreement_acceptance(
  p_challenge_id uuid,
  p_user_id uuid,
  p_party_role text,
  p_wallet_address text,
  p_recovered_signer text,
  p_signature text,
  p_accepted_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge public.w3m_agreement_challenges%rowtype;
  v_acceptance_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select * into v_challenge
    from public.w3m_agreement_challenges
    where id = p_challenge_id
    for update;
  if not found then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if v_challenge.consumed_at is not null then
    raise exception 'challenge_already_consumed' using errcode = '23505';
  end if;
  if v_challenge.user_id <> p_user_id or v_challenge.party_role <> p_party_role
    or lower(v_challenge.wallet_address) <> lower(p_wallet_address)
    or lower(v_challenge.wallet_address) <> lower(p_recovered_signer)
    or p_signature !~ '^0x[0-9a-fA-F]{130}$'
    or p_accepted_at > v_now
    or p_accepted_at > to_timestamp(v_challenge.signature_deadline)
    or p_accepted_at < to_timestamp(v_challenge.signature_deadline - 900)
    or v_now > to_timestamp(v_challenge.signature_deadline) then
    raise exception 'challenge_acceptance_mismatch_or_expired' using errcode = '22023';
  end if;

  insert into public.w3m_agreement_acceptances (
    challenge_id, deal_id, project_id, audit_id, fingerprint_id,
    fingerprint_digest, binding_hash, terms_hash, terms_version, party_role,
    user_id, wallet_address, signature, nonce, signature_deadline, accepted_at
  ) values (
    v_challenge.id, v_challenge.deal_id, v_challenge.project_id, v_challenge.audit_id,
    v_challenge.fingerprint_id, v_challenge.fingerprint_digest, v_challenge.binding_hash,
    v_challenge.terms_hash, v_challenge.terms_version, v_challenge.party_role,
    v_challenge.user_id, v_challenge.wallet_address, lower(p_signature),
    v_challenge.nonce, v_challenge.signature_deadline, p_accepted_at
  ) returning id into v_acceptance_id;

  update public.w3m_agreement_challenges
    set consumed_at = v_now
    where id = v_challenge.id and consumed_at is null;
  if not found then
    raise exception 'challenge_already_consumed' using errcode = '23505';
  end if;
  return v_acceptance_id;
end;
$$;

revoke all on function public.w3m_issue_agreement_challenge(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint
) from public, anon, authenticated;
revoke all on function public.w3m_record_agreement_acceptance(
  uuid,uuid,text,text,text,text,timestamptz
) from public, anon, authenticated;
grant execute on function public.w3m_issue_agreement_challenge(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint
) to service_role;
grant execute on function public.w3m_record_agreement_acceptance(
  uuid,uuid,text,text,text,text,timestamptz
) to service_role;

comment on table public.w3m_agreement_acceptances is
  'Append-only W3M V1 EIP-712 agreement acceptance evidence; server-only writes.';
comment on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz) is
  'Atomically locks and consumes one issued challenge and inserts one acceptance row; call only after server-side EIP-712 signature verification.';
