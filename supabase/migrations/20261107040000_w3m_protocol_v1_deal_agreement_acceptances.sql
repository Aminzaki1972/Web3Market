-- W3M Protocol V1 — immutable buyer/seller EIP-712 agreement registry.
-- Isolated draft only. Never deploy this migration to production as part of this work.

begin;

create or replace function public.w3m_normalize_numeric_text(p_value numeric)
returns text
language sql
immutable
strict
set search_path = ''
as $normalize$
  select case
    when position('.' in p_value::text) = 0 then p_value::text
    else regexp_replace(regexp_replace(p_value::text, '0+$', ''), '\\.$', '')
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
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
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
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
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

create or replace function public.w3m_register_deal_terms_version(
  p_deal_id uuid,
  p_terms_hash text,
  p_canonical_terms jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $register$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project public.projects%rowtype;
  v_buyer public.profiles%rowtype;
  v_seller public.profiles%rowtype;
  v_current_terms jsonb;
  v_latest public.w3m_deal_terms_versions%rowtype;
  v_next_version bigint;
  v_version public.w3m_deal_terms_versions%rowtype;
begin
  if p_deal_id is null or p_terms_hash !~ '^[0-9a-f]{64}$'
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

  if v_deal.buyer_id = v_deal.seller_id or v_deal.chain_id <> 56
     or v_policy.chain_id <> 56
     or lower(v_deal.safe_address) <> lower(v_policy.safe_address)
     or lower(v_deal.token_contract) <> lower(v_policy.token_contract)
     or v_policy.status not in ('locked','ready')
     or v_project.owner_id <> v_deal.seller_id
     or v_buyer.wallet_verified is distinct from true
     or v_seller.wallet_verified is distinct from true
     or v_buyer.wallet_address is null or v_seller.wallet_address is null
     or lower(v_policy.seller_wallet) <> lower(v_seller.wallet_address) then
    raise exception 'Deal is not eligible for immutable agreement signing' using errcode = '23514';
  end if;

  v_current_terms := jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', v_deal.id::text,
    'projectId', v_deal.project_id::text,
    'buyerId', v_deal.buyer_id::text,
    'sellerId', v_deal.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(v_deal.amount),
    'currency', upper(btrim(v_deal.currency)),
    'expectedAmount', case when v_deal.expected_amount is null then null
      else public.w3m_normalize_numeric_text(v_deal.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(v_deal.safe_address),
    'tokenContract', lower(v_deal.token_contract),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(v_policy.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(v_policy.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(v_policy.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(v_policy.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(v_policy.safe_address),
      'tokenContract', lower(v_policy.token_contract),
      'sellerWallet', lower(v_policy.seller_wallet),
      'platformWallet', lower(v_policy.platform_wallet),
      'safeNonce', v_policy.safe_nonce::text,
      'status', v_policy.status
    )
  );

  if p_canonical_terms is distinct from v_current_terms then
    raise exception 'Submitted canonical terms do not match current locked database terms' using errcode = '23514';
  end if;

  select * into v_latest
    from public.w3m_deal_terms_versions
   where deal_id = p_deal_id
   order by terms_version desc
   limit 1;

  if found and v_latest.terms_hash = p_terms_hash
     and v_latest.canonical_terms = v_current_terms then
    return jsonb_build_object(
      'deal_id', p_deal_id, 'terms_version', v_latest.terms_version,
      'terms_version_id', v_latest.id, 'terms_hash', v_latest.terms_hash,
      'idempotent_replay', true
    );
  end if;

  v_next_version := coalesce(v_latest.terms_version, 0) + 1;
  insert into public.w3m_deal_terms_versions (
    deal_id, terms_version, project_id, buyer_id, seller_id, chain_id,
    safe_address, terms_hash, canonical_terms
  ) values (
    p_deal_id, v_next_version, v_deal.project_id, v_deal.buyer_id, v_deal.seller_id,
    56, v_deal.safe_address, p_terms_hash, v_current_terms
  ) returning * into v_version;

  return jsonb_build_object(
    'deal_id', p_deal_id, 'terms_version', v_version.terms_version,
    'terms_version_id', v_version.id, 'terms_hash', v_version.terms_hash,
    'idempotent_replay', false
  );
end;
$register$;

create or replace function public.w3m_insert_deal_agreement_acceptance(
  p_deal_id uuid,
  p_terms_version bigint,
  p_party_role text,
  p_party_id uuid,
  p_wallet_address text,
  p_terms_hash text,
  p_canonical_terms jsonb,
  p_typed_data_digest text,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $accept$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_profile public.profiles%rowtype;
  v_version public.w3m_deal_terms_versions%rowtype;
  v_current_terms jsonb;
  v_existing public.w3m_deal_agreement_acceptances%rowtype;
  v_expected_party uuid;
begin
  if p_deal_id is null or p_terms_version < 1
     or p_party_role not in ('buyer','seller')
     or p_party_id is null
     or p_wallet_address !~ '^0x[0-9a-fA-F]{40}$'
     or p_terms_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature !~ '^0x[0-9a-fA-F]{130}$' then
    raise exception 'Invalid agreement acceptance request' using errcode = '22023';
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id for update;
  if not found then raise exception 'Release policy not found' using errcode = 'P0002'; end if;

  v_expected_party := case when p_party_role = 'buyer' then v_deal.buyer_id else v_deal.seller_id end;
  if p_party_id <> v_expected_party then
    raise exception 'Authenticated party does not match requested agreement role' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_expected_party;
  if not found or v_profile.wallet_verified is distinct from true
     or lower(v_profile.wallet_address) <> lower(p_wallet_address) then
    raise exception 'Wallet is not the currently verified party wallet' using errcode = '42501';
  end if;

  select * into v_version
    from public.w3m_deal_terms_versions
   where deal_id = p_deal_id and terms_version = p_terms_version
   for update;
  if not found or v_version.terms_hash <> p_terms_hash
     or v_version.canonical_terms <> p_canonical_terms
     or v_version.project_id <> v_deal.project_id
     or v_version.buyer_id <> v_deal.buyer_id
     or v_version.seller_id <> v_deal.seller_id
     or v_version.chain_id <> 56
     or lower(v_version.safe_address) <> lower(v_policy.safe_address) then
    raise exception 'Agreement terms version is stale or misbound' using errcode = '23514';
  end if;

  v_current_terms := jsonb_build_object(
    'protocol', 'W3M Protocol V1',
    'dealId', v_deal.id::text,
    'projectId', v_deal.project_id::text,
    'buyerId', v_deal.buyer_id::text,
    'sellerId', v_deal.seller_id::text,
    'amount', public.w3m_normalize_numeric_text(v_deal.amount),
    'currency', upper(btrim(v_deal.currency)),
    'expectedAmount', case when v_deal.expected_amount is null then null
      else public.w3m_normalize_numeric_text(v_deal.expected_amount) end,
    'chainId', 56,
    'safeAddress', lower(v_deal.safe_address),
    'tokenContract', lower(v_deal.token_contract),
    'releasePolicy', jsonb_build_object(
      'dealAmount', public.w3m_normalize_numeric_text(v_policy.deal_amount),
      'feePercent', public.w3m_normalize_numeric_text(v_policy.fee_percent),
      'feeAmount', public.w3m_normalize_numeric_text(v_policy.fee_amount),
      'sellerNetAmount', public.w3m_normalize_numeric_text(v_policy.seller_net_amount),
      'chainId', 56,
      'safeAddress', lower(v_policy.safe_address),
      'tokenContract', lower(v_policy.token_contract),
      'sellerWallet', lower(v_policy.seller_wallet),
      'platformWallet', lower(v_policy.platform_wallet),
      'safeNonce', v_policy.safe_nonce::text,
      'status', v_policy.status
    )
  );
  if v_current_terms is distinct from v_version.canonical_terms
     or p_canonical_terms is distinct from v_current_terms then
    raise exception 'Deal terms changed after wallet signing' using errcode = '23514';
  end if;

  select * into v_existing
    from public.w3m_deal_agreement_acceptances
   where deal_id = p_deal_id and terms_version = p_terms_version
     and party_role = p_party_role
   for update;
  if found then
    if v_existing.party_id = p_party_id
       and lower(v_existing.wallet_address) = lower(p_wallet_address)
       and v_existing.terms_hash = p_terms_hash
       and lower(v_existing.typed_data_digest) = lower(p_typed_data_digest)
       and lower(v_existing.signature) = lower(p_signature) then
      return jsonb_build_object(
        'accepted', true, 'acceptance_id', v_existing.id,
        'terms_version', p_terms_version, 'party_role', p_party_role,
        'idempotent_replay', true
      );
    end if;
    raise exception 'Conflicting agreement signature already exists for this party and version'
      using errcode = '23505';
  end if;

  insert into public.w3m_deal_agreement_acceptances (
    terms_version_id, deal_id, terms_version, party_role, party_id,
    wallet_address, chain_id, safe_address, terms_hash,
    typed_data_digest, signature
  ) values (
    v_version.id, p_deal_id, p_terms_version, p_party_role, p_party_id,
    lower(p_wallet_address), 56, lower(v_policy.safe_address), p_terms_hash,
    lower(p_typed_data_digest), lower(p_signature)
  ) returning * into v_existing;

  return jsonb_build_object(
    'accepted', true, 'acceptance_id', v_existing.id,
    'terms_version', p_terms_version, 'party_role', p_party_role,
    'idempotent_replay', false
  );
end;
$accept$;

revoke all on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_register_deal_terms_version(uuid,text,jsonb)
  to service_role;

revoke all on function public.w3m_insert_deal_agreement_acceptance(
  uuid,bigint,text,uuid,text,text,jsonb,text,text
) from public, anon, authenticated, service_role;
grant execute on function public.w3m_insert_deal_agreement_acceptance(
  uuid,bigint,text,uuid,text,text,jsonb,text,text
) to service_role;

commit;
