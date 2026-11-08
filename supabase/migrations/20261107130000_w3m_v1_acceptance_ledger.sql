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
  created_at timestamptz not null default now()
);
create index if not exists w3m_deal_audit_bindings_fingerprint_idx
  on w3m_private.w3m_deal_audit_bindings (fingerprint_id, fingerprint_digest);

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
grant select on w3m_private.w3m_audit_fingerprints, w3m_private.w3m_deal_audit_bindings to service_role;
-- Protocol rows are read-only to the Edge Function role. Mutations must pass
-- through the SECURITY DEFINER RPCs below, which enforce the transaction rules.
grant select on w3m_private.w3m_acquisition_terms_versions,
  w3m_private.w3m_agreement_challenges,
  w3m_private.w3m_agreement_acceptances to service_role;

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

create or replace function public.w3m_publish_audit_fingerprint_and_binding(
  p_deal_id uuid, p_project_id uuid, p_audit_id uuid, p_fingerprint_id uuid, p_user_id uuid,
  p_repository text, p_commit_sha text, p_fingerprint_digest text,
  p_manifest jsonb, p_binding_hash text
) returns table (fingerprint_id uuid, binding_hash text)
language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_deal public.deals%rowtype;
  v_audit public.code_audits%rowtype;
  v_project_owner uuid;
  v_scanned_file_count integer;
  v_manifest_file_match_count integer;
  v_finding_count integer;
  v_fingerprint w3m_private.w3m_audit_fingerprints%rowtype;
  v_binding w3m_private.w3m_deal_audit_bindings%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_project_id is null or p_audit_id is null
    or p_fingerprint_id is null or p_user_id is null
    or p_repository is null or p_repository !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?/[a-z0-9_.-]+$'
    or p_commit_sha is null or p_commit_sha !~ '^[0-9a-f]{40}$'
    or p_fingerprint_digest is null or p_fingerprint_digest !~ '^[0-9a-f]{64}$'
    or p_binding_hash is null or p_binding_hash !~ '^[0-9a-f]{64}$'
    or p_manifest is null or jsonb_typeof(p_manifest) is distinct from 'object'
    or pg_column_size(p_manifest) > 8388608
    or p_manifest ->> 'manifest_schema' is distinct from 'w3m.persisted-audit-manifest.v1'
    or jsonb_typeof(p_manifest -> 'files') is distinct from 'array'
    or jsonb_typeof(p_manifest -> 'findings') is distinct from 'array'
    or jsonb_array_length(p_manifest -> 'files') = 0 then
    raise exception 'invalid_fingerprint_publication_parameters' using errcode = '22023';
  end if;

  -- All publication paths lock the deal first, then project and audit evidence.
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or v_deal.project_id is distinct from p_project_id
    or v_deal.seller_id is distinct from p_user_id
    or v_deal.buyer_id is not distinct from p_user_id
    or v_deal.status is null or v_deal.status not in ('pending','accepted')
    or v_deal.dispute_status is distinct from 'none' then
    raise exception 'caller_is_not_eligible_deal_seller' using errcode = '42501';
  end if;

  select owner_id into v_project_owner from public.projects
    where id = p_project_id for share;
  if not found or v_project_owner is distinct from p_user_id then
    raise exception 'caller_does_not_own_project' using errcode = '42501';
  end if;

  select * into v_audit from public.code_audits where id = p_audit_id for share;
  if not found or v_audit.project_id is distinct from p_project_id
    or v_audit.status is distinct from 'completed'
    or v_audit.repo_owner is null or v_audit.repo_name is null
    or lower(v_audit.repo_owner || '/' || v_audit.repo_name) <> p_repository
    or lower(coalesce(v_audit.commit_sha,'')) <> p_commit_sha
    or p_manifest #>> '{audit,id}' is distinct from p_audit_id::text
    or lower(coalesce(p_manifest #>> '{audit,repository}','')) <> p_repository
    or lower(coalesce(p_manifest #>> '{audit,commit_sha}','')) <> p_commit_sha
    or p_manifest #>> '{audit,files_scanned}' is null
    or (p_manifest #>> '{audit,files_scanned}')::integer <> v_audit.files_scanned
    or (p_manifest #>> '{audit,files_scanned}')::integer <> jsonb_array_length(p_manifest -> 'files') then
    raise exception 'persisted_audit_manifest_does_not_match_completed_audit' using errcode = '23503';
  end if;

  select count(*) into v_scanned_file_count
    from public.code_audit_files f
    where f.audit_id = p_audit_id and f.scanned = true;
  if v_scanned_file_count <> v_audit.files_scanned
    or exists (
      select 1 from public.code_audit_files f
      where f.audit_id = p_audit_id and f.scanned = true
        and (f.sha is null or f.sha !~ '^[0-9a-fA-F]{40,64}$')
    )
    or exists (
      select 1 from public.code_audit_files f
      where f.audit_id = p_audit_id and f.scanned = true
      group by replace(f.path, chr(92), '/')
      having count(*) > 1
    ) then
    raise exception 'persisted_scanned_file_evidence_is_incomplete_or_duplicated' using errcode = '23503';
  end if;

  select count(*) into v_manifest_file_match_count
    from jsonb_array_elements(p_manifest -> 'files') as manifest_file(item)
    join public.code_audit_files f
      on f.audit_id = p_audit_id and f.scanned = true
     and replace(f.path, chr(92), '/') = manifest_file.item ->> 'path'
     and lower(f.sha) = manifest_file.item ->> 'sha';
  if v_manifest_file_match_count <> v_scanned_file_count then
    raise exception 'manifest_files_do_not_match_persisted_scan_rows' using errcode = '23503';
  end if;

  select count(*) into v_finding_count
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  if v_finding_count <> jsonb_array_length(p_manifest -> 'findings') then
    raise exception 'manifest_findings_do_not_match_persisted_audit_rows' using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_audit_id::text, 1));
  select * into v_fingerprint from w3m_private.w3m_audit_fingerprints
    where audit_id = p_audit_id for update;
  if found then
    if v_fingerprint.id <> p_fingerprint_id
      or v_fingerprint.fingerprint_digest <> p_fingerprint_digest
      or v_fingerprint.repository <> p_repository
      or v_fingerprint.commit_sha <> p_commit_sha
      or v_fingerprint.manifest <> p_manifest then
      raise exception 'audit_already_has_different_immutable_fingerprint' using errcode = '23505';
    end if;
  else
    insert into w3m_private.w3m_audit_fingerprints
      (id, audit_id, fingerprint_digest, repository, commit_sha, manifest)
    values (p_fingerprint_id, p_audit_id, p_fingerprint_digest, p_repository, p_commit_sha, p_manifest)
    returning * into v_fingerprint;
  end if;

  select * into v_binding from w3m_private.w3m_deal_audit_bindings
    where deal_id = p_deal_id for update;
  if found then
    if v_binding.project_id <> p_project_id or v_binding.audit_id <> p_audit_id
      or v_binding.fingerprint_id <> v_fingerprint.id
      or v_binding.fingerprint_digest <> p_fingerprint_digest
      or v_binding.repository <> p_repository or v_binding.commit_sha <> p_commit_sha
      or v_binding.binding_hash <> p_binding_hash then
      raise exception 'deal_already_has_different_immutable_audit_binding' using errcode = '23505';
    end if;
  else
    insert into w3m_private.w3m_deal_audit_bindings
      (deal_id, project_id, audit_id, fingerprint_id, fingerprint_digest,
       repository, commit_sha, binding_hash)
    values
      (p_deal_id, p_project_id, p_audit_id, v_fingerprint.id, p_fingerprint_digest,
       p_repository, p_commit_sha, p_binding_hash)
    returning * into v_binding;
  end if;

  return query select v_fingerprint.id, v_binding.binding_hash;
end;
$w3m$;

create or replace function public.w3m_publish_acquisition_terms_version(
  p_deal_id uuid, p_terms_version bigint, p_terms_hash text, p_canonical_terms_json jsonb
) returns uuid language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_max_version bigint;
  v_id uuid;
  v_deal public.deals%rowtype;
  v_binding w3m_private.w3m_deal_audit_bindings%rowtype;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
    or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}$'
    or p_canonical_terms_json is null
    or jsonb_typeof(p_canonical_terms_json) is distinct from 'object'
    or p_canonical_terms_json ->> 'schema' is distinct from 'w3m-acquisition-terms-v1'
    or p_canonical_terms_json ->> 'terms_version' is distinct from p_terms_version::text
    or jsonb_typeof(p_canonical_terms_json -> 'deal') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'audit') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'payment') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'project') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'consideration') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'platform_fee') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'seller_net') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'transfer_scope') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'delivery') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'inspection') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'dispute') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'escrow') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'governing_terms') is distinct from 'object'
    or jsonb_typeof(p_canonical_terms_json -> 'risk_acknowledgements') is distinct from 'array'
    or jsonb_typeof(p_canonical_terms_json -> 'disclosures') is distinct from 'array'
    or p_canonical_terms_json #>> '{payment,method}' is distinct from 'safe_multisig'
    or p_canonical_terms_json #>> '{payment,chain_id}' is distinct from '56'
    or p_canonical_terms_json #>> '{payment,status_at_signing}' is distinct from 'configured_or_pending' then
    raise exception 'invalid_or_incomplete_canonical_terms_v1' using errcode = '22023';
  end if;

  -- Serialize terms publication with acceptance by locking the deal first.
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found or v_deal.status not in ('pending','accepted')
    or v_deal.dispute_status is distinct from 'none' then
    raise exception 'deal_not_eligible_for_terms_publication' using errcode = '22023';
  end if;

  -- The signed terms must describe this exact deal and its immutable audit binding.
  select * into v_binding
    from w3m_private.w3m_deal_audit_bindings
    where deal_id = p_deal_id
    for share;
  if not found then
    raise exception 'deal_audit_binding_required_before_terms_publication' using errcode = '23503';
  end if;

  if lower(coalesce(p_canonical_terms_json #>> '{deal,deal_id}','')) <> v_deal.id::text
    or lower(coalesce(p_canonical_terms_json #>> '{deal,project_id}','')) <> v_deal.project_id::text
    or lower(coalesce(p_canonical_terms_json #>> '{deal,buyer_id}','')) <> v_deal.buyer_id::text
    or lower(coalesce(p_canonical_terms_json #>> '{deal,seller_id}','')) <> v_deal.seller_id::text
    or lower(coalesce(p_canonical_terms_json #>> '{audit,audit_id}','')) <> v_binding.audit_id::text
    or lower(coalesce(p_canonical_terms_json #>> '{audit,fingerprint_digest}','')) <> v_binding.fingerprint_digest
    or lower(coalesce(p_canonical_terms_json #>> '{audit,repository}','')) <> v_binding.repository
    or lower(coalesce(p_canonical_terms_json #>> '{audit,commit_sha}','')) <> v_binding.commit_sha then
    raise exception 'canonical_terms_do_not_match_deal_parties_or_audit_binding' using errcode = '23503';
  end if;

  if exists (
    select 1 from w3m_private.w3m_agreement_acceptances a
    where a.deal_id = p_deal_id
  ) then
    raise exception 'terms_locked_after_first_party_acceptance' using errcode = '23505';
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
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
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
  if v_deal.status is null or v_deal.status not in ('pending','accepted')
    or v_deal.dispute_status is distinct from 'none' then
    raise exception 'deal_not_eligible_for_agreement' using errcode = '22023';
  end if;
  if (p_party_role = 'buyer' and v_deal.buyer_id is distinct from p_user_id)
    or (p_party_role = 'seller' and v_deal.seller_id is distinct from p_user_id) then
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
  v_deal public.deals%rowtype;
  v_profile_wallet text;
  v_wallet_verified boolean;
  v_acceptance_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
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
  -- Lock the deal before terms. Challenge issuance uses the same deal -> terms
  -- order, preventing an acceptance/issuance deadlock on concurrent requests.
  select * into v_deal from public.deals where id = v_challenge.deal_id for update;
  if not found or v_deal.project_id is distinct from v_challenge.project_id
    or v_deal.status is null or v_deal.status not in ('pending','accepted')
    or v_deal.dispute_status is distinct from 'none'
    or (v_challenge.party_role = 'buyer' and v_deal.buyer_id is distinct from v_challenge.user_id)
    or (v_challenge.party_role = 'seller' and v_deal.seller_id is distinct from v_challenge.user_id) then
    raise exception 'deal_party_or_state_changed_after_challenge' using errcode = '42501';
  end if;

  -- Lock current terms through commit; a concurrent publisher must wait.
  perform 1 from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = v_challenge.deal_id and t.terms_version = v_challenge.terms_version
      and t.terms_hash = v_challenge.terms_hash and t.status = 'published'
    for share;
  if not found then
    raise exception 'challenge_terms_are_no_longer_current' using errcode = '22023';
  end if;

  select wallet_address, wallet_verified into v_profile_wallet, v_wallet_verified
    from public.profiles where id = v_challenge.user_id for share;
  if not found or v_wallet_verified is not true
    or lower(coalesce(v_profile_wallet,'')) <> lower(v_challenge.wallet_address) then
    raise exception 'verified_wallet_changed_after_challenge' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.code_audits a
    join w3m_private.w3m_audit_fingerprints f
      on f.audit_id = a.id and f.id = v_challenge.fingerprint_id
     and f.fingerprint_digest = v_challenge.fingerprint_digest
    join w3m_private.w3m_deal_audit_bindings b
      on b.audit_id = f.audit_id and b.fingerprint_id = f.id
     and b.fingerprint_digest = f.fingerprint_digest
     and b.repository = f.repository and b.commit_sha = f.commit_sha
    where a.id = v_challenge.audit_id and a.project_id = v_challenge.project_id
      and a.status = 'completed'
      and lower(a.repo_owner || '/' || a.repo_name) = b.repository
      and lower(a.commit_sha) = b.commit_sha
      and b.deal_id = v_challenge.deal_id and b.project_id = v_challenge.project_id
      and b.binding_hash = v_challenge.binding_hash
  ) then
    raise exception 'audit_binding_changed_after_challenge' using errcode = '23503';
  end if;

  -- Database time is authoritative for acceptance. Do not reject a valid
  -- signature because the Edge Runtime and PostgreSQL host clocks differ slightly.
  if v_challenge.user_id <> p_user_id or v_challenge.party_role <> p_party_role
    or lower(v_challenge.wallet_address) <> lower(p_wallet_address)
    or lower(v_challenge.wallet_address) <> lower(p_recovered_signer)
    or p_signature !~ '^0x[0-9a-fA-F]{130}    (challenge_id, deal_id, project_id, audit_id, fingerprint_id, fingerprint_digest,
     binding_hash, terms_hash, terms_version, party_role, user_id, wallet_address,
     signature, nonce, signature_deadline, accepted_at)
  values
    (v_challenge.id, v_challenge.deal_id, v_challenge.project_id, v_challenge.audit_id,
     v_challenge.fingerprint_id, v_challenge.fingerprint_digest, v_challenge.binding_hash,
     v_challenge.terms_hash, v_challenge.terms_version, v_challenge.party_role,
     v_challenge.user_id, v_challenge.wallet_address, lower(p_signature),
     v_challenge.nonce, v_challenge.signature_deadline, v_now)
  returning id into v_acceptance_id;
  update w3m_private.w3m_agreement_challenges set consumed_at = v_now
    where id = v_challenge.id and consumed_at is null;
  if not found then
    raise exception 'challenge_already_consumed' using errcode = '23505';
  end if;
  return v_acceptance_id;
end;
$w3m$;

create or replace function public.w3m_get_agreement_challenge_for_verification(
  p_challenge_id uuid
) returns table (
  id uuid, deal_id uuid, project_id uuid, audit_id uuid, fingerprint_id uuid,
  fingerprint_digest text, binding_hash text, terms_hash text, terms_version bigint,
  party_role text, user_id uuid, wallet_address text, nonce text,
  signature_deadline bigint, created_at timestamptz, consumed_at timestamptz
) language plpgsql security definer set search_path = ''
as $w3m$
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_challenge_id is null then
    raise exception 'challenge_id_required' using errcode = '22023';
  end if;
  return query
    select c.id, c.deal_id, c.project_id, c.audit_id, c.fingerprint_id,
      c.fingerprint_digest, c.binding_hash, c.terms_hash, c.terms_version,
      c.party_role, c.user_id, c.wallet_address, c.nonce,
      c.signature_deadline, c.created_at, c.consumed_at
    from w3m_private.w3m_agreement_challenges c
    where c.id = p_challenge_id;
end;
$w3m$;

create or replace function public.w3m_get_deal_agreement_context(
  p_deal_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_binding jsonb;
  v_terms jsonb;
  v_acceptances jsonb;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  -- Keep w3m_private outside the Data API. Return only the minimum trusted
  -- agreement context through this service-role-only public RPC.
  select jsonb_build_object(
    'deal_id', b.deal_id,
    'project_id', b.project_id,
    'audit_id', b.audit_id,
    'fingerprint_id', b.fingerprint_id,
    'fingerprint_digest', b.fingerprint_digest,
    'repository', b.repository,
    'commit_sha', b.commit_sha,
    'binding_hash', b.binding_hash
  ) into v_binding
  from w3m_private.w3m_deal_audit_bindings b
  where b.deal_id = p_deal_id;

  select jsonb_build_object(
    'id', t.id,
    'terms_version', t.terms_version,
    'terms_hash', t.terms_hash,
    'canonical_terms_json', t.canonical_terms_json,
    'status', t.status,
    'published_at', t.published_at
  ) into v_terms
  from w3m_private.w3m_acquisition_terms_versions t
  where t.deal_id = p_deal_id and t.status = 'published';

  select coalesce(jsonb_agg(jsonb_build_object(
    'party_role', a.party_role,
    'user_id', a.user_id,
    'terms_version', a.terms_version,
    'terms_hash', a.terms_hash,
    'accepted_at', a.accepted_at
  ) order by a.party_role, a.terms_version desc, a.accepted_at desc), '[]'::jsonb)
  into v_acceptances
  from w3m_private.w3m_agreement_acceptances a
  where a.deal_id = p_deal_id;

  return jsonb_build_object(
    'binding', v_binding,
    'terms', v_terms,
    'acceptances', coalesce(v_acceptances, '[]'::jsonb)
  );
end;
$w3m$;

create or replace function public.w3m_get_deal_finalization_evidence(
  p_deal_id uuid
) returns table (
  deal_id uuid, project_id uuid, buyer_id uuid, seller_id uuid,
  deal_status text, dispute_status text, audit_id uuid, fingerprint_id uuid,
  fingerprint_digest text, repository text, commit_sha text, binding_hash text,
  terms_hash text, terms_version text, acceptance_rows jsonb
) language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_deal public.deals%rowtype;
  v_binding w3m_private.w3m_deal_audit_bindings%rowtype;
  v_fingerprint w3m_private.w3m_audit_fingerprints%rowtype;
  v_audit public.code_audits%rowtype;
  v_terms w3m_private.w3m_acquisition_terms_versions%rowtype;
  v_terms_count integer;
  v_acceptance_rows jsonb;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  select * into v_deal from public.deals d where d.id = p_deal_id;
  if not found or v_deal.buyer_id is null or v_deal.seller_id is null
    or v_deal.buyer_id = v_deal.seller_id then
    raise exception 'finalization_deal_or_parties_invalid' using errcode = 'P0002';
  end if;

  select * into v_binding from w3m_private.w3m_deal_audit_bindings b
    where b.deal_id = p_deal_id;
  if not found or v_binding.project_id is distinct from v_deal.project_id then
    raise exception 'finalization_audit_binding_missing' using errcode = 'P0002';
  end if;

  select * into v_fingerprint from w3m_private.w3m_audit_fingerprints f
    where f.id = v_binding.fingerprint_id;
  if not found or v_fingerprint.audit_id is distinct from v_binding.audit_id
    or v_fingerprint.fingerprint_digest is distinct from v_binding.fingerprint_digest
    or v_fingerprint.repository is distinct from v_binding.repository
    or v_fingerprint.commit_sha is distinct from v_binding.commit_sha then
    raise exception 'finalization_fingerprint_binding_mismatch' using errcode = '23503';
  end if;

  select * into v_audit from public.code_audits a where a.id = v_binding.audit_id;
  if not found or v_audit.project_id is distinct from v_deal.project_id
    or v_audit.status is distinct from 'completed'
    or lower(coalesce(v_audit.repo_owner || '/' || v_audit.repo_name,'')) <> v_binding.repository
    or lower(coalesce(v_audit.commit_sha,'')) <> v_binding.commit_sha then
    raise exception 'finalization_audit_no_longer_matches_binding' using errcode = '23503';
  end if;

  select count(*) into v_terms_count
    from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = p_deal_id and t.status = 'published';
  if v_terms_count <> 1 then
    raise exception 'finalization_current_terms_version_not_unique' using errcode = '23503';
  end if;
  select * into v_terms from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = p_deal_id and t.status = 'published';

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', a.deal_id::text,
    'project_id', a.project_id::text,
    'audit_id', a.audit_id::text,
    'fingerprint_id', a.fingerprint_id::text,
    'fingerprint_digest', '0x' || a.fingerprint_digest,
    'binding_hash', '0x' || a.binding_hash,
    'terms_hash', '0x' || a.terms_hash,
    'terms_version', a.terms_version::text,
    'party_role', a.party_role,
    'user_id', a.user_id::text,
    'wallet_address', a.wallet_address,
    'signature', a.signature,
    'nonce', a.nonce,
    'signature_deadline', a.signature_deadline,
    'accepted_at', to_char(a.accepted_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by a.terms_version, a.party_role), '[]'::jsonb)
  into v_acceptance_rows
  from w3m_private.w3m_agreement_acceptances a
  where a.deal_id = p_deal_id;

  return query select
    v_deal.id, v_deal.project_id, v_deal.buyer_id, v_deal.seller_id,
    v_deal.status, v_deal.dispute_status, v_binding.audit_id, v_binding.fingerprint_id,
    '0x' || v_binding.fingerprint_digest, v_binding.repository, v_binding.commit_sha,
    '0x' || v_binding.binding_hash, '0x' || v_terms.terms_hash,
    v_terms.terms_version::text, v_acceptance_rows;
end;
$w3m$;

revoke all on function public.w3m_get_deal_agreement_context(uuid)
  from public, anon, authenticated;
revoke all on function public.w3m_get_deal_finalization_evidence(uuid)
  from public, anon, authenticated;
revoke all on function public.w3m_publish_audit_fingerprint_and_binding(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.w3m_publish_acquisition_terms_version(uuid,bigint,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.w3m_issue_agreement_challenge(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint)
  from public, anon, authenticated;
revoke all on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.w3m_get_agreement_challenge_for_verification(uuid)
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_reject_protocol_mutation()
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_guard_terms_supersede()
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_guard_challenge_consumption()
  from public, anon, authenticated;
grant execute on function public.w3m_publish_audit_fingerprint_and_binding(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text) to service_role;
grant execute on function public.w3m_get_deal_agreement_context(uuid) to service_role;
grant execute on function public.w3m_get_deal_finalization_evidence(uuid) to service_role;
grant execute on function public.w3m_publish_acquisition_terms_version(uuid,bigint,text,jsonb) to service_role;
grant execute on function public.w3m_issue_agreement_challenge(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint) to service_role;
grant execute on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz) to service_role;
grant execute on function public.w3m_get_agreement_challenge_for_verification(uuid) to service_role;

comment on table w3m_private.w3m_audit_fingerprints is 'Immutable W3M V1 fingerprint manifest for a completed audit; server-only writes.';
comment on table w3m_private.w3m_agreement_acceptances is 'Append-only W3M V1 EIP-712 agreement acceptance evidence; server-only writes.';

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

create or replace function public.w3m_get_agreement_challenge_for_verification(
  p_challenge_id uuid
) returns table (
  id uuid, deal_id uuid, project_id uuid, audit_id uuid, fingerprint_id uuid,
  fingerprint_digest text, binding_hash text, terms_hash text, terms_version bigint,
  party_role text, user_id uuid, wallet_address text, nonce text,
  signature_deadline bigint, created_at timestamptz, consumed_at timestamptz
) language plpgsql security definer set search_path = ''
as $w3m$
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_challenge_id is null then
    raise exception 'challenge_id_required' using errcode = '22023';
  end if;
  return query
    select c.id, c.deal_id, c.project_id, c.audit_id, c.fingerprint_id,
      c.fingerprint_digest, c.binding_hash, c.terms_hash, c.terms_version,
      c.party_role, c.user_id, c.wallet_address, c.nonce,
      c.signature_deadline, c.created_at, c.consumed_at
    from w3m_private.w3m_agreement_challenges c
    where c.id = p_challenge_id;
end;
$w3m$;

create or replace function public.w3m_get_deal_agreement_context(
  p_deal_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_binding jsonb;
  v_terms jsonb;
  v_acceptances jsonb;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  -- Keep w3m_private outside the Data API. Return only the minimum trusted
  -- agreement context through this service-role-only public RPC.
  select jsonb_build_object(
    'deal_id', b.deal_id,
    'project_id', b.project_id,
    'audit_id', b.audit_id,
    'fingerprint_id', b.fingerprint_id,
    'fingerprint_digest', b.fingerprint_digest,
    'repository', b.repository,
    'commit_sha', b.commit_sha,
    'binding_hash', b.binding_hash
  ) into v_binding
  from w3m_private.w3m_deal_audit_bindings b
  where b.deal_id = p_deal_id;

  select jsonb_build_object(
    'id', t.id,
    'terms_version', t.terms_version,
    'terms_hash', t.terms_hash,
    'canonical_terms_json', t.canonical_terms_json,
    'status', t.status,
    'published_at', t.published_at
  ) into v_terms
  from w3m_private.w3m_acquisition_terms_versions t
  where t.deal_id = p_deal_id and t.status = 'published';

  select coalesce(jsonb_agg(jsonb_build_object(
    'party_role', a.party_role,
    'user_id', a.user_id,
    'terms_version', a.terms_version,
    'terms_hash', a.terms_hash,
    'accepted_at', a.accepted_at
  ) order by a.party_role, a.terms_version desc, a.accepted_at desc), '[]'::jsonb)
  into v_acceptances
  from w3m_private.w3m_agreement_acceptances a
  where a.deal_id = p_deal_id;

  return jsonb_build_object(
    'binding', v_binding,
    'terms', v_terms,
    'acceptances', coalesce(v_acceptances, '[]'::jsonb)
  );
end;
$w3m$;

create or replace function public.w3m_get_deal_finalization_evidence(
  p_deal_id uuid
) returns table (
  deal_id uuid, project_id uuid, buyer_id uuid, seller_id uuid,
  deal_status text, dispute_status text, audit_id uuid, fingerprint_id uuid,
  fingerprint_digest text, repository text, commit_sha text, binding_hash text,
  terms_hash text, terms_version text, acceptance_rows jsonb
) language plpgsql security definer set search_path = ''
as $w3m$
declare
  v_deal public.deals%rowtype;
  v_binding w3m_private.w3m_deal_audit_bindings%rowtype;
  v_fingerprint w3m_private.w3m_audit_fingerprints%rowtype;
  v_audit public.code_audits%rowtype;
  v_terms w3m_private.w3m_acquisition_terms_versions%rowtype;
  v_terms_count integer;
  v_acceptance_rows jsonb;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'deal_id_required' using errcode = '22023';
  end if;

  select * into v_deal from public.deals d where d.id = p_deal_id;
  if not found or v_deal.buyer_id is null or v_deal.seller_id is null
    or v_deal.buyer_id = v_deal.seller_id then
    raise exception 'finalization_deal_or_parties_invalid' using errcode = 'P0002';
  end if;

  select * into v_binding from w3m_private.w3m_deal_audit_bindings b
    where b.deal_id = p_deal_id;
  if not found or v_binding.project_id is distinct from v_deal.project_id then
    raise exception 'finalization_audit_binding_missing' using errcode = 'P0002';
  end if;

  select * into v_fingerprint from w3m_private.w3m_audit_fingerprints f
    where f.id = v_binding.fingerprint_id;
  if not found or v_fingerprint.audit_id is distinct from v_binding.audit_id
    or v_fingerprint.fingerprint_digest is distinct from v_binding.fingerprint_digest
    or v_fingerprint.repository is distinct from v_binding.repository
    or v_fingerprint.commit_sha is distinct from v_binding.commit_sha then
    raise exception 'finalization_fingerprint_binding_mismatch' using errcode = '23503';
  end if;

  select * into v_audit from public.code_audits a where a.id = v_binding.audit_id;
  if not found or v_audit.project_id is distinct from v_deal.project_id
    or v_audit.status is distinct from 'completed'
    or lower(coalesce(v_audit.repo_owner || '/' || v_audit.repo_name,'')) <> v_binding.repository
    or lower(coalesce(v_audit.commit_sha,'')) <> v_binding.commit_sha then
    raise exception 'finalization_audit_no_longer_matches_binding' using errcode = '23503';
  end if;

  select count(*) into v_terms_count
    from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = p_deal_id and t.status = 'published';
  if v_terms_count <> 1 then
    raise exception 'finalization_current_terms_version_not_unique' using errcode = '23503';
  end if;
  select * into v_terms from w3m_private.w3m_acquisition_terms_versions t
    where t.deal_id = p_deal_id and t.status = 'published';

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', a.deal_id::text,
    'project_id', a.project_id::text,
    'audit_id', a.audit_id::text,
    'fingerprint_id', a.fingerprint_id::text,
    'fingerprint_digest', '0x' || a.fingerprint_digest,
    'binding_hash', '0x' || a.binding_hash,
    'terms_hash', '0x' || a.terms_hash,
    'terms_version', a.terms_version::text,
    'party_role', a.party_role,
    'user_id', a.user_id::text,
    'wallet_address', a.wallet_address,
    'signature', a.signature,
    'nonce', a.nonce,
    'signature_deadline', a.signature_deadline,
    'accepted_at', to_char(a.accepted_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by a.terms_version, a.party_role), '[]'::jsonb)
  into v_acceptance_rows
  from w3m_private.w3m_agreement_acceptances a
  where a.deal_id = p_deal_id;

  return query select
    v_deal.id, v_deal.project_id, v_deal.buyer_id, v_deal.seller_id,
    v_deal.status, v_deal.dispute_status, v_binding.audit_id, v_binding.fingerprint_id,
    '0x' || v_binding.fingerprint_digest, v_binding.repository, v_binding.commit_sha,
    '0x' || v_binding.binding_hash, '0x' || v_terms.terms_hash,
    v_terms.terms_version::text, v_acceptance_rows;
end;
$w3m$;

revoke all on function public.w3m_get_deal_agreement_context(uuid)
  from public, anon, authenticated;
revoke all on function public.w3m_get_deal_finalization_evidence(uuid)
  from public, anon, authenticated;
revoke all on function public.w3m_publish_audit_fingerprint_and_binding(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.w3m_publish_acquisition_terms_version(uuid,bigint,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.w3m_issue_agreement_challenge(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint)
  from public, anon, authenticated;
revoke all on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.w3m_get_agreement_challenge_for_verification(uuid)
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_reject_protocol_mutation()
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_guard_terms_supersede()
  from public, anon, authenticated;
revoke all on function w3m_private.w3m_guard_challenge_consumption()
  from public, anon, authenticated;
grant execute on function public.w3m_publish_audit_fingerprint_and_binding(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text) to service_role;
grant execute on function public.w3m_get_deal_agreement_context(uuid) to service_role;
grant execute on function public.w3m_get_deal_finalization_evidence(uuid) to service_role;
grant execute on function public.w3m_publish_acquisition_terms_version(uuid,bigint,text,jsonb) to service_role;
grant execute on function public.w3m_issue_agreement_challenge(uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text,bigint) to service_role;
grant execute on function public.w3m_record_agreement_acceptance(uuid,uuid,text,text,text,text,timestamptz) to service_role;
grant execute on function public.w3m_get_agreement_challenge_for_verification(uuid) to service_role;

comment on table w3m_private.w3m_audit_fingerprints is 'Immutable W3M V1 fingerprint manifest for a completed audit; server-only writes.';
comment on table w3m_private.w3m_agreement_acceptances is 'Append-only W3M V1 EIP-712 agreement acceptance evidence; server-only writes.';
