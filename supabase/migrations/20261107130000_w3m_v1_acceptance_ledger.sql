-- W3M Protocol V1 server-only acceptance evidence. Draft only; never apply to production without explicit approval.
-- Evidence rows intentionally do not cascade-delete with marketplace records.

create schema if not exists w3m_private;
revoke all on schema w3m_private from public, anon, authenticated;
grant usage on schema w3m_private to service_role;

create table if not exists w3m_private.w3m_audit_fingerprints (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique,
  fingerprint_digest text not null unique check (fingerprint_digest ~ '^[0-9a-f]{64}$'),
  repository text not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  manifest jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists w3m_private.w3m_deal_audit_bindings (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique,
  project_id uuid not null,
  audit_id uuid not null,
  fingerprint_id uuid not null,
  fingerprint_digest text not null check (fingerprint_digest ~ '^[0-9a-f]{64}$'),
  repository text not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  binding_hash text not null check (binding_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (fingerprint_id, fingerprint_digest)
);

create table if not exists w3m_private.w3m_acquisition_terms_versions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  terms_version bigint not null check (terms_version > 0),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  canonical_terms_json jsonb not null,
  status text not null check (status in ('published','superseded')),
  published_at timestamptz not null default now(),
  unique (deal_id, terms_version),
  unique (deal_id, terms_hash)
);
create unique index if not exists w3m_terms_one_current_version_per_deal
  on w3m_private.w3m_acquisition_terms_versions (deal_id) where status = 'published';

create table if not exists w3m_private.w3m_agreement_challenges (
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
  check (signature_deadline > extract(epoch from created_at)::bigint),
  check (signature_deadline <= extract(epoch from created_at)::bigint + 900)
);

create table if not exists w3m_private.w3m_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references w3m_private.w3m_agreement_challenges(id) on delete restrict,
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
  unique (deal_id, terms_version, party_role),
  check (extract(epoch from accepted_at)::bigint <= signature_deadline),
  check (extract(epoch from accepted_at)::bigint >= signature_deadline - 900)
);

alter table w3m_private.w3m_audit_fingerprints enable row level security;
alter table w3m_private.w3m_deal_audit_bindings enable row level security;
alter table w3m_private.w3m_acquisition_terms_versions enable row level security;
alter table w3m_private.w3m_agreement_challenges enable row level security;
alter table w3m_private.w3m_agreement_acceptances enable row level security;

revoke all on w3m_private.w3m_audit_fingerprints, w3m_private.w3m_deal_audit_bindings,
  w3m_private.w3m_acquisition_terms_versions, w3m_private.w3m_agreement_challenges,
  w3m_private.w3m_agreement_acceptances from anon, authenticated;
grant select, insert on w3m_private.w3m_audit_fingerprints, w3m_private.w3m_deal_audit_bindings to service_role;
grant select, insert, update on w3m_private.w3m_acquisition_terms_versions, w3m_private.w3m_agreement_challenges to service_role;
grant select, insert on w3m_private.w3m_agreement_acceptances to service_role;

create or replace function w3m_private.w3m_reject_protocol_mutation()
returns trigger language plpgsql set search_path = ''
as $w3m$
begin
  raise exception 'w3m_protocol_evidence_is_immutable' using errcode = '55000';
end;
$w3m$;

create or replace function w3m_private.w3m_guard_terms_supersede()
returns trigger language plpgsql set search_path = ''
as $w3m$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    or old.status <> 'published' or new.status <> 'superseded' then
    raise exception 'w3m_terms_only_allow_published_to_superseded' using errcode = '55000';
  end if;
  return new;
end;
$w3m$;

create or replace function w3m_private.w3m_guard_challenge_consumption()
returns trigger language plpgsql set search_path = ''
as $w3m$
begin
  if (to_jsonb(new) - 'consumed_at') is distinct from (to_jsonb(old) - 'consumed_at')
    or old.consumed_at is not null or new.consumed_at is null then
    raise exception 'w3m_challenge_only_allows_single_consumption' using errcode = '55000';
  end if;
  return new;
end;
$w3m$;

drop trigger if exists w3m_audit_fingerprints_no_mutation on w3m_private.w3m_audit_fingerprints;
create trigger w3m_audit_fingerprints_no_mutation before update or delete on w3m_private.w3m_audit_fingerprints
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_bindings_no_mutation on w3m_private.w3m_deal_audit_bindings;
create trigger w3m_bindings_no_mutation before update or delete on w3m_private.w3m_deal_audit_bindings
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_terms_guard_update on w3m_private.w3m_acquisition_terms_versions;
create trigger w3m_terms_guard_update before update on w3m_private.w3m_acquisition_terms_versions
for each row execute function w3m_private.w3m_guard_terms_supersede();
drop trigger if exists w3m_terms_no_delete on w3m_private.w3m_acquisition_terms_versions;
create trigger w3m_terms_no_delete before delete on w3m_private.w3m_acquisition_terms_versions
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_acceptances_no_mutation on w3m_private.w3m_agreement_acceptances;
create trigger w3m_acceptances_no_mutation before update or delete on w3m_private.w3m_agreement_acceptances
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_challenges_guard_consumption on w3m_private.w3m_agreement_challenges;
create trigger w3m_challenges_guard_consumption before update on w3m_private.w3m_agreement_challenges
for each row execute function w3m_private.w3m_guard_challenge_consumption();
drop trigger if exists w3m_challenges_no_delete on w3m_private.w3m_agreement_challenges;
create trigger w3m_challenges_no_delete before delete on w3m_private.w3m_agreement_challenges
for each row execute function w3m_private.w3m_reject_protocol_mutation();

create or replace function public.w3m_publish_acquisition_terms_version(
  p_deal_id uuid, p_terms_version bigint, p_terms_hash text, p_canonical_terms_json jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_max_version bigint;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
    or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}$'
    or p_canonical_terms_json is null or p_canonical_terms_json = '{}'::jsonb then
    raise exception 'invalid_terms_version_parameters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text, 0));
  select coalesce(max(terms_version), 0) into v_max_version
    from w3m_private.w3m_acquisition_terms_versions where deal_id = p_deal_id;
  if p_terms_version <> v_max_version + 1 then
    raise exception 'terms_version_must_be_next_sequential' using errcode = '23505';
  end if;
  update w3m_private.w3m_acquisition_terms_versions set status = 'superseded'
    where deal_id = p_deal_id and status = 'published';
  insert into w3m_private.w3m_acquisition_terms_versions
    (deal_id, terms_version, terms_hash, canonical_terms_json, status)
  values (p_deal_id, p_terms_version, lower(p_terms_hash), p_canonical_terms_json, 'published')
  returning id into v_id;
  return v_id;
end;
$w3m$;

create or replace function public.w3m_issue_agreement_challenge(
  p_deal_id uuid, p_project_id uuid, p_audit_id uuid, p_fingerprint_id uuid,
  p_fingerprint_digest text, p_binding_hash text, p_terms_hash text, p_terms_version bigint,
  p_party_role text, p_user_id uuid, p_wallet_address text, p_nonce text, p_signature_deadline bigint
) returns uuid language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_id uuid;
  v_now bigint := extract(epoch from clock_timestamp())::bigint;
  v_deal public.deals%rowtype;
  v_profile_wallet text;
  v_wallet_verified boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_project_id is null or p_audit_id is null
    or p_fingerprint_id is null or p_user_id is null
    or p_party_role is null or p_party_role not in ('buyer','seller') or p_terms_version is null or p_terms_version < 1
    or p_fingerprint_digest is null or p_fingerprint_digest !~ '^[0-9a-f]{64}$'
    or p_binding_hash is null or p_binding_hash !~ '^[0-9a-f]{64}$'
    or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}$'
    or p_wallet_address is null or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
    or p_nonce is null or p_nonce !~ '^0x[0-9a-fA-F]{64}$'
    or p_signature_deadline is null or p_signature_deadline <= v_now
    or p_signature_deadline > v_now + 900 then
    raise exception 'invalid_challenge_parameters' using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or v_deal.project_id <> p_project_id then
    raise exception 'deal_or_project_not_found' using errcode = 'P0002';
  end if;
  if v_deal.status is null or v_deal.status not in ('pending','accepted')\n    or v_deal.dispute_status is distinct from 'none' then
    raise exception 'deal_not_eligible_for_agreement' using errcode = '22023';
  end if;
  if (p_party_role = 'buyer' and v_deal.buyer_id <> p_user_id)
    or (p_party_role = 'seller' and v_deal.seller_id <> p_user_id) then
    raise exception 'authenticated_user_is_not_deal_party' using errcode = '42501';
  end if;

  select wallet_address, wallet_verified into v_profile_wallet, v_wallet_verified
    from public.profiles where id = p_user_id;
  if not found or v_wallet_verified is not true
    or lower(coalesce(v_profile_wallet,'')) <> lower(p_wallet_address) then
    raise exception 'verified_profile_wallet_mismatch' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.code_audits a
    join w3m_private.w3m_audit_fingerprints f
      on f.audit_id = a.id and f.id = p_fingerprint_id
     and f.fingerprint_digest = p_fingerprint_digest
    join w3m_private.w3m_deal_audit_bindings b
      on b.audit_id = f.audit_id and b.fingerprint_id = f.id
     and b.fingerprint_digest = f.fingerprint_digest
     and b.repository = f.repository and b.commit_sha = f.commit_sha
    where a.id = p_audit_id and a.project_id = v_deal.project_id
      and a.status = 'completed'
      and lower(a.repo_owner || '/' || a.repo_name) = b.repository
      and lower(a.commit_sha) = b.commit_sha
      and b.deal_id = p_deal_id and b.project_id = p_project_id
      and b.binding_hash = p_binding_hash
  ) then
    raise exception 'trusted_completed_audit_binding_not_found' using errcode = '23503';
  end if;

  -- Lock the selected terms row through challenge insertion so publication
  -- of a newer version cannot race this challenge.
  perform 1 from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = p_deal_id and t.terms_version = p_terms_version
      and t.terms_hash = p_terms_hash and t.status = 'published'
    for share;
  if not found then
    raise exception 'current_terms_version_not_found' using errcode = '23503';
  end if;

  insert into w3m_private.w3m_agreement_challenges
    (deal_id, project_id, audit_id, fingerprint_id, fingerprint_digest, binding_hash,
     terms_hash, terms_version, party_role, user_id, wallet_address, nonce, signature_deadline)
  values
    (p_deal_id, p_project_id, p_audit_id, p_fingerprint_id, p_fingerprint_digest, p_binding_hash,
     p_terms_hash, p_terms_version, p_party_role, p_user_id, lower(p_wallet_address),
     lower(p_nonce), p_signature_deadline)
  returning id into v_id;
  return v_id;
end;
$w3m$;

create or replace function public.w3m_record_agreement_acceptance(
  p_challenge_id uuid, p_user_id uuid, p_party_role text, p_wallet_address text,
  p_recovered_signer text, p_signature text, p_accepted_at timestamptz
) returns uuid language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_challenge w3m_private.w3m_agreement_challenges%rowtype;
  v_acceptance_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_challenge_id is null or p_user_id is null or p_party_role is null
    or p_wallet_address is null or p_recovered_signer is null
    or p_signature is null or p_accepted_at is null then
    raise exception 'acceptance_parameters_required' using errcode = '22023';
  end if;
  select * into v_challenge from w3m_private.w3m_agreement_challenges
    where id = p_challenge_id for update;
  if not found then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if v_challenge.consumed_at is not null then
    raise exception 'challenge_already_consumed' using errcode = '23505';
  end if;
  -- Lock current terms through commit; a concurrent publisher must wait.
  perform 1 from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = v_challenge.deal_id and t.terms_version = v_challenge.terms_version
      and t.terms_hash = v_challenge.terms_hash and t.status = 'published'
    for share;
  if not found then
    raise exception 'challenge_terms_are_no_longer_current' using errcode = '22023';
  end if;
  if v_challenge.user_id <> p_user_id or v_challenge.party_role <> p_party_role
    or lower(v_challenge.wallet_address) <> lower(p_wallet_address)
    or lower(v_challenge.wallet_address) <> lower(p_recovered_signer)
    or p_signature !~ '^0x[0-9a-fA-F]{130}$'
    or p_accepted_at > v_now or p_accepted_at > to_timestamp(v_challenge.signature_deadline)
    or p_accepted_at < v_challenge.created_at
    or p_accepted_at < to_timestamp(v_challenge.signature_deadline - 900)
    or v_now > to_timestamp(v_challenge.signature_deadline) then
    raise exception 'challenge_acceptance_mismatch_or_expired' using errcode = '22023';
  end if;
  insert into w3m_private.w3m_agreement_acceptances
    (challenge_id, deal_id, project_id, audit_id, fingerprint_id, fingerprint_digest,
     binding_hash, terms_hash, terms_version, party_role, user_id, wallet_address,
     signature, nonce, signature_deadline, accepted_at)
  values
    (v_challenge.id, v_challenge.deal_id, v_challenge.project_id, v_challenge.audit_id,
     v_challenge.fingerprint_id, v_challenge.fingerprint_digest, v_challenge.binding_hash,
     v_challenge.terms_hash, v_challenge.terms_version, v_challenge.party_role,
     v_challenge.user_id, v_challenge.wallet_address, lower(p_signature),
     v_challenge.nonce, v_challenge.signature_deadline, p_accepted_at)
  returning id into v_acceptance_id;
  update w3m_private.w3m_agreement_challenges set consumed_at = v_now
    where id = v_challenge.id and consumed_at is null;
  if not found then
    raise exception 'challenge_already_consumed' using errcode = '23505';
  end if;
  return v_acceptance_id;
end;
$w3m$;

create or replace function w3m_private.w3m_reject_protocol_mutation()
returns trigger language plpgsql set search_path = ''
as $w3m$
begin
  raise exception 'w3m_protocol_evidence_is_immutable' using errcode = '55000';
end;
$w3m$;

create or replace function w3m_private.w3m_guard_terms_supersede()
returns trigger language plpgsql set search_path = ''
as $w3m$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
    or old.status <> 'published' or new.status <> 'superseded' then
    raise exception 'w3m_terms_only_allow_published_to_superseded' using errcode = '55000';
  end if;
  return new;
end;
$w3m$;

create or replace function w3m_private.w3m_guard_challenge_consumption()
returns trigger language plpgsql set search_path = ''
as $w3m$
begin
  if (to_jsonb(new) - 'consumed_at') is distinct from (to_jsonb(old) - 'consumed_at')
    or old.consumed_at is not null or new.consumed_at is null then
    raise exception 'w3m_challenge_only_allows_single_consumption' using errcode = '55000';
  end if;
  return new;
end;
$w3m$;

drop trigger if exists w3m_audit_fingerprints_no_mutation on w3m_private.w3m_audit_fingerprints;
create trigger w3m_audit_fingerprints_no_mutation before update or delete on w3m_private.w3m_audit_fingerprints
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_bindings_no_mutation on w3m_private.w3m_deal_audit_bindings;
create trigger w3m_bindings_no_mutation before update or delete on w3m_private.w3m_deal_audit_bindings
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_terms_guard_update on w3m_private.w3m_acquisition_terms_versions;
create trigger w3m_terms_guard_update before update on w3m_private.w3m_acquisition_terms_versions
for each row execute function w3m_private.w3m_guard_terms_supersede();
drop trigger if exists w3m_terms_no_delete on w3m_private.w3m_acquisition_terms_versions;
create trigger w3m_terms_no_delete before delete on w3m_private.w3m_acquisition_terms_versions
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_acceptances_no_mutation on w3m_private.w3m_agreement_acceptances;
create trigger w3m_acceptances_no_mutation before update or delete on w3m_private.w3m_agreement_acceptances
for each row execute function w3m_private.w3m_reject_protocol_mutation();
drop trigger if exists w3m_challenges_guard_consumption on w3m_private.w3m_agreement_challenges;
create trigger w3m_challenges_guard_consumption before update on w3m_private.w3m_agreement_challenges
for each row execute function w3m_private.w3m_guard_challenge_consumption();
drop trigger if exists w3m_challenges_no_delete on w3m_private.w3m_agreement_challenges;
create trigger w3m_challenges_no_delete before delete on w3m_private.w3m_agreement_challenges
for each row execute function w3m_private.w3m_reject_protocol_mutation();

revoke all on function public.w3m_publish_acquisition_terms_version(uuid,bigint,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.w3m_issue_agreement_challenge(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint)
  from public, anon, authenticated;
revoke all on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.w3m_publish_acquisition_terms_version(uuid,bigint,text,jsonb) to service_role;
grant execute on function public.w3m_issue_agreement_challenge(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint) to service_role;
grant execute on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz) to service_role;

comment on table w3m_private.w3m_audit_fingerprints is 'Immutable W3M V1 fingerprint manifest for a completed audit; server-only writes.';
comment on table w3m_private.w3m_agreement_acceptances is 'Append-only W3M V1 EIP-712 agreement acceptance evidence; server-only writes.';
