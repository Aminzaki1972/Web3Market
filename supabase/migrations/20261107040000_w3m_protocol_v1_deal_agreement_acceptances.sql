-- W3M Protocol V1 — immutable buyer/seller EIP-712 agreement registry.
-- Isolated draft only. Never deploy this migration to production as part of this work.
begin;

create or replace function public.w3m_normalize_numeric_text(p_value numeric)
returns text language sql immutable strict set search_path = ''
as $normalize$
  select case
    when position('.' in p_value::text) = 0 then p_value::text
    else rtrim(rtrim(p_value::text, '0'), '.')
  end;
$normalize$;
revoke all on function public.w3m_normalize_numeric_text(numeric)
  from public, anon, authenticated, service_role;

create table public.w3m_deal_terms_versions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  terms_version bigint not null check (terms_version > 0),
  project_id uuid not null,
  buyer_id uuid not null,
  seller_id uuid not null,
  chain_id bigint not null check (chain_id = 56),
  safe_address text not null check (safe_address ~ '^0x[0-9a-fA-F]{40}$'),
  terms_hash text not null check (length(terms_hash) = 64 and terms_hash ~ '^[0-9a-f]+$'),
  canonical_terms jsonb not null check (jsonb_typeof(canonical_terms) = 'object'),
  created_at timestamptz not null default now(),
  unique (deal_id, terms_version),
  unique (deal_id, terms_hash, terms_version)
);
create index w3m_deal_terms_versions_latest_idx
  on public.w3m_deal_terms_versions (deal_id, terms_version desc);

create table public.w3m_deal_agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  terms_version_id uuid not null references public.w3m_deal_terms_versions(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  terms_version bigint not null check (terms_version > 0),
  party_role text not null check (party_role in ('buyer','seller')),
  party_id uuid not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id bigint not null check (chain_id = 56),
  safe_address text not null check (safe_address ~ '^0x[0-9a-fA-F]{40}$'),
  terms_hash text not null check (length(terms_hash) = 64 and terms_hash ~ '^[0-9a-f]+$'),
  typed_data_digest text not null check (typed_data_digest ~ '^0x[0-9a-fA-F]{64}$'),
  signature text not null check (signature ~ '^0x[0-9a-fA-F]{130}$'),
  accepted_at timestamptz not null default now(),
  unique (deal_id, terms_version, party_role),
  unique (terms_version_id, party_role)
);
create index w3m_deal_agreement_acceptances_latest_idx
  on public.w3m_deal_agreement_acceptances (deal_id, terms_version desc);

alter table public.w3m_deal_terms_versions enable row level security;
alter table public.w3m_deal_agreement_acceptances enable row level security;
revoke all on table public.w3m_deal_terms_versions from public, anon, authenticated, service_role;
revoke all on table public.w3m_deal_agreement_acceptances from public, anon, authenticated, service_role;
grant select on table public.w3m_deal_terms_versions to service_role;
grant select on table public.w3m_deal_agreement_acceptances to service_role;

-- Exact SQL representation of the same canonical terms object built in TypeScript.
-- Independent per-deal Code Audit snapshots are created before either party
-- signs. This removes the former first-report -> agreement -> first-report cycle.
create table public.w3m_deal_code_audit_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  snapshot_version bigint not null check (snapshot_version > 0),
  audit_id uuid not null references public.code_audits(id) on delete restrict,
  repository_owner text not null check (repository_owner ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  repository_name text not null check (repository_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' and repository_name not in ('.','..')),
  repository_url text not null,
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  audit_type text not null check (audit_type in ('code','smart_contract','complete')),
  completed_at timestamptz not null,
  manifest_version text not null check (manifest_version = 'w3m-audit-manifest-v1'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  file_count integer not null check (file_count > 0),
  finding_count integer not null check (finding_count >= 0),
  created_at timestamptz not null default now(),
  unique (deal_id, snapshot_version),
  unique (deal_id, audit_id, manifest_version, manifest_hash)
);
create index w3m_deal_code_audit_snapshots_latest_idx
  on public.w3m_deal_code_audit_snapshots (deal_id, snapshot_version desc);

comment on table public.w3m_deal_code_audit_snapshots is
  'Append-only, per-deal pre-agreement Code Audit manifest snapshots. Independent of acquisition report issuance.';

alter table public.w3m_deal_code_audit_snapshots enable row level security;
revoke all on table public.w3m_deal_code_audit_snapshots from public, anon, authenticated, service_role;
grant select on table public.w3m_deal_code_audit_snapshots to service_role;

create or replace function public.w3m_reject_deal_code_audit_snapshot_mutation()
returns trigger language plpgsql security definer set search_path = ''
as $immutable$
begin
  raise exception 'Deal Code Audit snapshots are append-only'
    using errcode = '55000';
end;
$immutable$;
revoke all on function public.w3m_reject_deal_code_audit_snapshot_mutation()
  from public, anon, authenticated, service_role;

create trigger w3m_deal_code_audit_snapshots_immutable
before update or delete on public.w3m_deal_code_audit_snapshots
for each row execute function public.w3m_reject_deal_code_audit_snapshot_mutation();

-- The caller supplies only the server-recomputed digest and counts. All source
-- identity, project binding, completion status and persisted row counts are
-- re-derived from trusted database rows inside this transaction.
create or replace function public.w3m_create_deal_code_audit_snapshot(
  p_deal_id uuid,
  p_audit_id uuid,
  p_manifest_version text,
  p_manifest_hash text,
  p_file_count integer,
  p_finding_count integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $create_snapshot$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit public.code_audits%rowtype;
  v_snapshot public.w3m_deal_code_audit_snapshots%rowtype;
  v_existing public.w3m_deal_code_audit_snapshots%rowtype;
  v_actual_files bigint;
  v_actual_findings bigint;
  v_expected_findings bigint;
  v_next_version bigint;
  v_repository_url text;
begin
  if p_deal_id is null or p_audit_id is null
     or p_manifest_version is distinct from 'w3m-audit-manifest-v1'
     or p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$'
     or p_file_count is null or p_file_count <= 0
     or p_finding_count is null or p_finding_count < 0 then
    raise exception 'Invalid independent Deal Code Audit snapshot request'
      using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Deal project not found' using errcode = 'P0002'; end if;
  select * into v_audit from public.code_audits where id = p_audit_id for share;
  if not found then raise exception 'Selected Code Audit not found' using errcode = 'P0002'; end if;

  if v_audit.project_id is distinct from v_deal.project_id
     or v_audit.status is distinct from 'completed'
     or v_audit.completed_at is null
     or v_audit.files_scanned is null
     or coalesce(v_audit.commit_sha,'') !~* '^[0-9a-f]{40}$'
     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or coalesce(v_audit.repo_name,'') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
     and a.commit_sha ~* '^[0-9a-f]{40}$'
     and a.repo_owner ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     and a.repo_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     and a.repo_name not in ('.','..')
     and a.analysis_progress->>'evidence_version' = 'w3m-audit-evidence-v1'
     and a.analysis_progress->>'tree_truncated' = 'false'
     and a.analysis_progress->>'persisted_file_count' ~ '^[1-9][0-9]*$'
     and lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       = lower('https://github.com/' || a.repo_owner || '/' || a.repo_name)
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No complete repository-matching Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',to_char(s.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and a.commit_sha = s.commit_sha
    and a.repo_owner = s.repository_owner
    and a.repo_name = s.repository_name
    and a.completed_at = s.completed_at
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     and a.repo_owner ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])? a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     and a.repo_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99} a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     and a.repo_name not in ('.','..')
     and a.analysis_progress->>'evidence_version' = 'w3m-audit-evidence-v1'
     and a.analysis_progress->>'tree_truncated' = 'false'
     and a.analysis_progress->>'persisted_file_count' ~ '^[1-9][0-9]* a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     and lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+ a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;
, ''), '\\.git a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;
, '', 'i'))
       = lower('https://github.com/' || a.repo_owner || '/' || a.repo_name)
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;

     or coalesce(v_audit.repo_owner,'') !~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
     or v_audit.repo_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
     or v_audit.repo_name in ('.','..')
     or coalesce(v_audit.analysis_progress->>'evidence_version','') <> 'w3m-audit-evidence-v1'
     or coalesce(v_audit.analysis_progress->>'tree_truncated','') <> 'false'
     or coalesce(v_audit.analysis_progress->>'persisted_file_count','') !~ '^[1-9][0-9]*$' then
    raise exception 'Selected Code Audit is incomplete or not bound to the deal project'
      using errcode = '23514';
  end if;

  v_repository_url := 'https://github.com/' || v_audit.repo_owner || '/' || v_audit.repo_name;
  if lower(regexp_replace(regexp_replace(btrim(coalesce(v_project.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url)
     or lower(regexp_replace(regexp_replace(btrim(coalesce(v_audit.repo_url,'')), '/+$', ''), '\.git$', '', 'i'))
       <> lower(v_repository_url) then
    raise exception 'Code Audit repository does not match the authoritative project GitHub URL'
      using errcode = '23514';
  end if;

  select count(*) into v_actual_files
    from public.code_audit_files f where f.audit_id = p_audit_id;
  select count(*) into v_actual_findings
    from public.code_audit_findings f where f.audit_id = p_audit_id;
  v_expected_findings := coalesce(v_audit.critical_count,0)
    + coalesce(v_audit.high_count,0)
    + coalesce(v_audit.medium_count,0)
    + coalesce(v_audit.low_count,0)
    + coalesce(v_audit.info_count,0);

  if v_actual_files <> p_file_count
     or v_actual_files <> v_audit.files_scanned
     or v_actual_files <> (v_audit.analysis_progress->>'persisted_file_count')::integer
     or v_actual_findings <> p_finding_count
     or v_actual_findings <> v_expected_findings then
    raise exception 'Persisted Code Audit rows do not match the recomputed manifest counts'
      using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id
     and s.audit_id = p_audit_id
     and s.manifest_version = p_manifest_version
     and s.manifest_hash = p_manifest_hash;
  if found then
    return jsonb_build_object(
      'id',v_existing.id,'deal_id',v_existing.deal_id,'project_id',v_existing.project_id,
      'snapshot_version',v_existing.snapshot_version,'audit_id',v_existing.audit_id,
      'repository_owner',v_existing.repository_owner,'repository_name',v_existing.repository_name,
      'repository_url',v_existing.repository_url,'commit_sha',v_existing.commit_sha,
      'audit_type',v_existing.audit_type,'completed_at',v_existing.completed_at,
      'manifest_version',v_existing.manifest_version,'manifest_hash',v_existing.manifest_hash,
      'file_count',v_existing.file_count,'finding_count',v_existing.finding_count,
      'idempotent_replay',true
    );
  end if;

  select coalesce(max(s.snapshot_version),0) + 1 into v_next_version
    from public.w3m_deal_code_audit_snapshots s
   where s.deal_id = p_deal_id;

  insert into public.w3m_deal_code_audit_snapshots (
    deal_id,project_id,snapshot_version,audit_id,repository_owner,repository_name,
    repository_url,commit_sha,audit_type,completed_at,manifest_version,manifest_hash,
    file_count,finding_count
  ) values (
    p_deal_id,v_deal.project_id,v_next_version,p_audit_id,v_audit.repo_owner,v_audit.repo_name,
    v_repository_url,lower(v_audit.commit_sha),'code',v_audit.completed_at,
    p_manifest_version,p_manifest_hash,p_file_count,p_finding_count
  ) returning * into v_snapshot;

  return jsonb_build_object(
    'id',v_snapshot.id,'deal_id',v_snapshot.deal_id,'project_id',v_snapshot.project_id,
    'snapshot_version',v_snapshot.snapshot_version,'audit_id',v_snapshot.audit_id,
    'repository_owner',v_snapshot.repository_owner,'repository_name',v_snapshot.repository_name,
    'repository_url',v_snapshot.repository_url,'commit_sha',v_snapshot.commit_sha,
    'audit_type',v_snapshot.audit_type,'completed_at',v_snapshot.completed_at,
    'manifest_version',v_snapshot.manifest_version,'manifest_hash',v_snapshot.manifest_hash,
    'file_count',v_snapshot.file_count,'finding_count',v_snapshot.finding_count,
    'idempotent_replay',false
  );
end;
$create_snapshot$;

revoke all on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_create_deal_code_audit_snapshot(uuid,uuid,text,text,integer,integer)
  to service_role;

create or replace function public.w3m_read_deal_audit_snapshot_context(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $snapshot_context$
declare
  v_deal public.deals%rowtype;
  v_project public.projects%rowtype;
  v_audit_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  if not found then return null; end if;

  select a.id into v_audit_id
    from public.code_audits a
   where a.project_id = v_project.id
     and a.status = 'completed'
     and a.completed_at is not null
   order by a.completed_at desc, a.id desc
   limit 1;

  if v_audit_id is null then
    raise exception 'No completed Code Audit is available for this project'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'deal_id',v_deal.id,'project_id',v_project.id,
    'project_github_url',v_project.github_url,'audit_id',v_audit_id
  );
end;
$snapshot_context$;

revoke all on function public.w3m_read_deal_audit_snapshot_context(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_deal_audit_snapshot_context(uuid)
  to service_role;

create or replace function public.w3m_current_deal_code_audit_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $audit$
  select jsonb_build_object(
    'auditId',s.audit_id,
    'repositoryOwner',s.repository_owner,
    'repositoryName',s.repository_name,
    'repositoryUrl',s.repository_url,
    'commitSha',s.commit_sha,
    'auditType',s.audit_type,
    'completedAt',s.completed_at,
    'auditEvidenceHash',s.manifest_hash
  )
  from public.w3m_deal_code_audit_snapshots s
  join public.deals d on d.id = s.deal_id and d.project_id = s.project_id
  join public.projects p on p.id = s.project_id
  join public.code_audits a on a.id = s.audit_id
  where s.deal_id = p_deal_id
    and a.status = 'completed'
    and lower(regexp_replace(regexp_replace(btrim(coalesce(p.github_url,'')), '/+$', ''), '\.git$', '', 'i'))
      = lower(s.repository_url)
  order by s.snapshot_version desc
  limit 1;
$audit$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_current_deal_terms_json(p_deal_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $current$
  select jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', d.id::text,
    'projectId', d.project_id::text,
    'buyerId', d.buyer_id::text,
    'sellerId', d.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(d.amount),
    'currency', upper(btrim(d.currency)),
    'expectedAmount', case when d.expected_amount is null then null
      else public.w3m_normalize_numeric_text(d.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(d.safe_address),
    'tokenContract', lower(d.token_contract),
    'codeAudit', public.w3m_current_deal_code_audit_json(d.id),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(p.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(p.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(p.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(p.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(p.safe_address),
      'tokenContract', lower(p.token_contract),
      'sellerWallet', lower(p.seller_wallet),
      'platformWallet', lower(p.platform_wallet),
      'safeNonce', p.safe_nonce::text,
      'status', p.status
    )
  )
  from public.deals d
  join public.deal_release_policies p on p.deal_id = d.id
  where d.id = p_deal_id;
$current$;
revoke all on function public.w3m_current_deal_code_audit_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid, p_terms_hash text, p_canonical_terms jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
begin
  if p_deal_id is null or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$' or p_canonical_terms is null
     or jsonb_typeof(p_canonical_terms) <> 'object' then
    raise exception 'Invalid deal terms registration request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Locked release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id;
  select * into v_buyer from public.profiles where id = v_deal.buyer_id;
  select * into v_seller from public.profiles where id = v_deal.seller_id;

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_buyer.wallet_address) = lower(v_seller.wallet_address)
     or v_buyer.wallet_verified_at is null or v_seller.wallet_verified_at is null
     or v_buyer.wallet_verified_at > now() or v_seller.wallet_verified_at > now()
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement signing' using errcode = '23514';
  end if;
  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest from public.w3m_deal_terms_versions
   where deal_id = p_deal_id order by terms_version desc limit 1;
  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_latest.terms_version,
      'terms_version_id',v_latest.id,'terms_hash',v_latest.terms_hash,'idempotent_replay',true);
  end if;

  v_next_version := coalesce(v_latest.terms_version,0) + 1;
  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    p_deal_id,v_next_version,v_deal.project_id,v_deal.buyer_id,v_deal.seller_id,
    56,v_deal.safe_address,p_terms_hash,v_current_terms
  ) returning * into v_version;
  return jsonb_build_object('deal_id',p_deal_id,'terms_version',v_version.terms_version,
    'terms_version_id',v_version.id,'terms_hash',v_version.terms_hash,'idempotent_replay',false);
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid, p_terms_version bigint, p_party_role text, p_party_id uuid,
  p_wallet_address text, p_terms_hash text, p_canonical_terms jsonb,
  p_typed_data_digest text, p_signature text
)
returns jsonb language plpgsql security definer set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_project public.projects%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version is null or p_terms_version < 1
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null or p_wallet_address is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash is null or length(p_terms_hash) <> 64
     or p_terms_hash !~ '^[0-9a-f]+$'
     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects where id = v_deal.project_id for share;
  if not found then raise exception 'Project not found' using errcode = 'P0002'; end if;

  if v_deal.chain_id <> 56 or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id then
    raise exception 'Deal, project ownership, or locked Safe policy changed before agreement acceptance'
      using errcode = '23514';
  end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_address is null or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or lower(v_profile.wallet_address) <> lower(p_wallet_address)
     or not exists (
       select 1
         from public.profiles buyer_profile
         join public.profiles seller_profile on seller_profile.id = v_deal.seller_id
        where buyer_profile.id = v_deal.buyer_id
          and buyer_profile.wallet_verified is true
          and seller_profile.wallet_verified is true
          and buyer_profile.wallet_address is not null
          and seller_profile.wallet_address is not null
          and buyer_profile.wallet_verified_at is not null
          and seller_profile.wallet_verified_at is not null
          and buyer_profile.wallet_verified_at <= now()
          and seller_profile.wallet_verified_at <= now()
          and lower(buyer_profile.wallet_address) <> lower(seller_profile.wallet_address)
          and lower(v_policy.seller_wallet) = lower(seller_profile.wallet_address)
     ) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;
  v_current_terms := public.w3m_current_deal_terms_json(p_deal_id);
  if v_current_terms->'codeAudit' is null or v_current_terms->'codeAudit' = 'null'::jsonb then
    raise exception 'A current complete Code Audit manifest is required before agreement acceptance' using errcode = '23514';
  end if;
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
        'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',true);
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,
    chain_id,safe_address,terms_hash,typed_data_digest,signature
  ) values (
    v_version.id,p_deal_id,p_terms_version,p_party_role,p_party_id,lower(p_wallet_address),
    56,lower(v_policy.safe_address),p_terms_hash,lower(p_typed_data_digest),lower(p_signature)
  ) returning * into v_existing;
  return jsonb_build_object('accepted',true,'acceptance_id',v_existing.id,
    'terms_version',p_terms_version,'party_role',p_party_role,'idempotent_replay',false);
end;
$accept$;

create or replace function public.w3m_read_deal_agreement_signing_snapshot(p_deal_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $read$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_code_audit jsonb;
begin
  if p_deal_id is null then raise exception 'Deal ID is required' using errcode = '22023'; end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;
  if not found then return null; end if;
  select jsonb_build_object('id',p.id::text,'owner_id',p.owner_id::text,'status',p.status)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id',p.id::text,'wallet_address',p.wallet_address,
    'wallet_verified',p.wallet_verified,'wallet_verified_at',p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;
  v_code_audit := public.w3m_current_deal_code_audit_json(v_deal.id);
  return jsonb_build_object(
    'deal',jsonb_build_object('id',v_deal.id::text,'project_id',v_deal.project_id::text,
      'buyer_id',v_deal.buyer_id::text,'seller_id',v_deal.seller_id::text,
      'amount',v_deal.amount::text,'currency',v_deal.currency,
      'expected_amount',v_deal.expected_amount::text,'chain_id',v_deal.chain_id::text,
      'safe_address',v_deal.safe_address,'token_contract',v_deal.token_contract,
      'updated_at',v_deal.updated_at::text),
    'policy',jsonb_build_object('deal_id',v_policy.deal_id::text,
      'deal_amount',v_policy.deal_amount::text,'fee_percent',v_policy.fee_percent::text,
      'fee_amount',v_policy.fee_amount::text,'seller_net_amount',v_policy.seller_net_amount::text,
      'chain_id',v_policy.chain_id::text,'safe_address',v_policy.safe_address,
      'token_contract',v_policy.token_contract,'seller_wallet',v_policy.seller_wallet,
      'platform_wallet',v_policy.platform_wallet,'safe_nonce',v_policy.safe_nonce::text,
      'status',v_policy.status,'updated_at',v_policy.updated_at::text),
    'project',v_project,'buyer_profile',v_buyer_profile,'seller_profile',v_seller_profile,
    'code_audit',v_code_audit
  );
end;
$read$;

revoke all on function public.w3m_current_deal_terms_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.w3m_read_deal_agreement_signing_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb) to service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(uuid,bigint,text,uuid,text,text,jsonb,text,text) to service_role;
grant execute on function public.w3m_read_deal_agreement_signing_snapshot(uuid) to service_role;

commit;
