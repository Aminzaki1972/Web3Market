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
  if p_deal_id is null or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}
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
     or p_party_role is null or p_party_role not in ('buyer','seller')
     or p_party_id is null
     or p_wallet_address is null or p_wallet_address !~ '^0x[0-9a-fA-F]{40}
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
     or v_profile.wallet_address is null
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

     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object' then
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

     or p_terms_hash is null or p_terms_hash !~ '^[0-9a-f]{64}
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

     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object' then
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

     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object'
     or p_typed_data_digest is null or p_typed_data_digest !~ '^0x[0-9a-fA-F]{64}
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

     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object' then
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

     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}
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

     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object' then
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
 then
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

     or p_canonical_terms is null or jsonb_typeof(p_canonical_terms) <> 'object' then
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


-- Extend the isolated EXECUTE snapshot with the latest canonical terms version
-- and immutable EIP-712 acceptances. The application independently recomputes
-- the canonical hash and recovers both party signatures before clearing blockers.
create or replace function public.w3m_read_safe_execution_snapshot(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $snapshot$
declare
  v_deal public.deals%rowtype;
  v_policy public.deal_release_policies%rowtype;
  v_project jsonb;
  v_buyer_profile jsonb;
  v_seller_profile jsonb;
  v_transactions jsonb;
  v_signers jsonb;
  v_agreements jsonb;
  v_dispute jsonb;
  v_terms_version jsonb;
  v_acceptances jsonb;
  v_terms_version_id uuid;
begin
  if p_deal_id is null then
    raise exception 'Deal ID is required' using errcode = '22023';
  end if;
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then return null; end if;
  select * into v_policy from public.deal_release_policies where deal_id = p_deal_id;

  select jsonb_build_object('id', p.id::text, 'owner_id', p.owner_id::text,
    'status', p.status, 'updated_at', p.updated_at::text)
    into v_project from public.projects p where p.id = v_deal.project_id;
  select jsonb_build_object('id', p.id::text, 'wallet_address', p.wallet_address,
    'wallet_verified', p.wallet_verified, 'wallet_verified_at', p.wallet_verified_at::text)
    into v_buyer_profile from public.profiles p where p.id = v_deal.buyer_id;
  select jsonb_build_object('id', p.id::text, 'wallet_address', p.wallet_address,
    'wallet_verified', p.wallet_verified, 'wallet_verified_at', p.wallet_verified_at::text)
    into v_seller_profile from public.profiles p where p.id = v_deal.seller_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id::text, 'deal_id', t.deal_id::text, 'action', t.action,
    'safe_tx_hash', t.safe_tx_hash, 'tx_hash', t.tx_hash, 'status', t.status,
    'confirmations_count', t.confirmations_count, 'required_signatures', t.required_signatures,
    'safe_nonce', t.safe_nonce::text, 'to_address', t.to_address, 'data', t.data,
    'value_wei', t.value_wei::text, 'operation', t.operation,
    'safe_tx_gas', t.safe_tx_gas::text, 'base_gas', t.base_gas::text,
    'gas_price', t.gas_price::text, 'gas_token', t.gas_token,
    'refund_receiver', t.refund_receiver, 'signatures', t.signatures,
    'amount', t.amount::text, 'token_symbol', t.token_symbol,
    'chain_id', t.chain_id::text, 'safe_address', t.safe_address,
    'updated_at', t.updated_at::text
  ) order by t.created_at desc), '[]'::jsonb)
  into v_transactions
  from public.deal_multisig_transactions t
  where t.deal_id = p_deal_id and t.action = 'release_to_seller';

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', s.deal_id::text, 'signer_role', s.signer_role,
    'signer_id', s.signer_id::text, 'wallet_address', s.wallet_address,
    'signature_status', s.signature_status, 'signed_at', s.signed_at::text,
    'safe_tx_hash', s.safe_tx_hash, 'signature', s.signature
  ) order by s.signer_role), '[]'::jsonb)
  into v_signers from public.deal_multisig_signers s where s.deal_id = p_deal_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'party_role', a.party_role, 'party_id', a.party_id::text, 'agreed_at', a.agreed_at::text
  ) order by a.party_role), '[]'::jsonb)
  into v_agreements from public.deal_party_agreements a where a.deal_id = p_deal_id;

  select jsonb_build_object(
    'id', d.id::text, 'deal_id', d.deal_id::text, 'status', d.status,
    'resolution', d.resolution, 'resolved_by', d.resolved_by::text,
    'resolved_at', d.resolved_at::text
  ) into v_dispute from public.deal_disputes d where d.deal_id = p_deal_id;

  select id into v_terms_version_id
    from public.w3m_deal_terms_versions
   where deal_id = p_deal_id
   order by terms_version desc limit 1;
  if v_terms_version_id is not null then
    select jsonb_build_object(
      'id', tv.id::text, 'deal_id', tv.deal_id::text,
      'terms_version', tv.terms_version::text, 'project_id', tv.project_id::text,
      'buyer_id', tv.buyer_id::text, 'seller_id', tv.seller_id::text,
      'chain_id', tv.chain_id::text, 'safe_address', tv.safe_address,
      'terms_hash', tv.terms_hash, 'canonical_terms', tv.canonical_terms,
      'created_at', tv.created_at::text
    ) into v_terms_version
    from public.w3m_deal_terms_versions tv where tv.id = v_terms_version_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id::text, 'terms_version_id', a.terms_version_id::text,
      'deal_id', a.deal_id::text, 'terms_version', a.terms_version::text,
      'party_role', a.party_role, 'party_id', a.party_id::text,
      'wallet_address', a.wallet_address, 'chain_id', a.chain_id::text,
      'safe_address', a.safe_address, 'terms_hash', a.terms_hash,
      'typed_data_digest', a.typed_data_digest, 'signature', a.signature,
      'accepted_at', a.accepted_at::text
    ) order by a.party_role), '[]'::jsonb)
    into v_acceptances
    from public.w3m_deal_agreement_acceptances a
    where a.terms_version_id = v_terms_version_id;
  else
    v_acceptances := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'deal', jsonb_build_object(
      'id', v_deal.id::text, 'project_id', v_deal.project_id::text,
      'buyer_id', v_deal.buyer_id::text, 'seller_id', v_deal.seller_id::text,
      'amount', v_deal.amount::text, 'currency', v_deal.currency,
      'status', v_deal.status, 'payment_status', v_deal.payment_status,
      'payment_tx_hash', v_deal.payment_tx_hash, 'chain_id', v_deal.chain_id::text,
      'safe_address', v_deal.safe_address, 'token_contract', v_deal.token_contract,
      'token_symbol', v_deal.token_symbol, 'expected_amount', v_deal.expected_amount::text,
      'platform_fee', v_deal.platform_fee::text, 'platform_fee_percent', v_deal.platform_fee_percent::text,
      'seller_net_amount', v_deal.seller_net_amount::text, 'platform_fee_amount', v_deal.platform_fee_amount::text,
      'delivery_status', v_deal.delivery_status, 'buyer_approved_at', v_deal.buyer_approved_at::text,
      'delivery_accepted_at', v_deal.delivery_accepted_at::text, 'dispute_status', v_deal.dispute_status,
      'release_tx_hash', v_deal.release_tx_hash, 'buyer_agreed_at', v_deal.buyer_agreed_at::text,
      'seller_agreed_at', v_deal.seller_agreed_at::text, 'updated_at', v_deal.updated_at::text
    ),
    'policy', case when v_policy.id is null then null else jsonb_build_object(
      'id', v_policy.id::text, 'deal_id', v_policy.deal_id::text,
      'deal_amount', v_policy.deal_amount::text, 'fee_percent', v_policy.fee_percent::text,
      'fee_amount', v_policy.fee_amount::text, 'seller_net_amount', v_policy.seller_net_amount::text,
      'seller_wallet', v_policy.seller_wallet, 'platform_wallet', v_policy.platform_wallet,
      'safe_address', v_policy.safe_address, 'token_contract', v_policy.token_contract,
      'token_symbol', v_policy.token_symbol, 'chain_id', v_policy.chain_id::text,
      'safe_nonce', v_policy.safe_nonce::text, 'status', v_policy.status,
      'locked_at', v_policy.locked_at::text, 'released_at', v_policy.released_at::text,
      'release_tx_hash', v_policy.release_tx_hash, 'updated_at', v_policy.updated_at::text
    ) end,
    'project', v_project, 'buyer_profile', v_buyer_profile, 'seller_profile', v_seller_profile,
    'release_transactions', v_transactions, 'signers', v_signers,
    'party_agreements', v_agreements, 'dispute', v_dispute,
    'terms_version', v_terms_version, 'agreement_acceptances', v_acceptances,
    'agreement_binding_supported', v_terms_version is not null
  );
end;
$snapshot$;

revoke all on function public.w3m_read_safe_execution_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.w3m_read_safe_execution_snapshot(uuid)
  to service_role;

commit;
