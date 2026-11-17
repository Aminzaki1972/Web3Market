-- W3M Protocol V1: isolated acquisition evidence registry.
-- Draft migration for the feature branch only.
-- NOT applied to any Supabase project. Do not deploy until reviewed and tested
-- against a disposable staging database and the existing Deal Room/Safe schemas.

begin;

create table if not exists public.w3m_acquisition_reports (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null check (length(btrim(deal_id)) between 1 and 160),
  project_id text not null check (length(btrim(project_id)) between 1 and 160),
  report_version integer not null check (report_version > 0),
  supersedes_report_id uuid null
    references public.w3m_acquisition_reports(id) on delete restrict,
  buyer_id text null check (buyer_id is null or length(btrim(buyer_id)) between 1 and 160),
  seller_id text null check (seller_id is null or length(btrim(seller_id)) between 1 and 160),
  status text not null
    check (status in ('PASS','INCOMPLETE','BLOCKED','REVIEW_REQUIRED')),
  engine_version text not null check (length(btrim(engine_version)) between 1 and 80),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  report_hash text not null check (report_hash ~ '^[0-9a-f]{64}$'),
  report_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(report_payload) = 'object'),
  signer_key_id text null check (signer_key_id is null or length(btrim(signer_key_id)) <= 120),
  report_signature text null check (report_signature is null or report_signature ~ '^0x[0-9a-fA-F]{130}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint w3m_acquisition_report_expiry_check check (expires_at > issued_at),
  constraint w3m_acquisition_report_version_unique unique (deal_id, report_version),
  constraint w3m_acquisition_report_supersedes_not_self check
    (supersedes_report_id is null or supersedes_report_id <> id),
  constraint w3m_acquisition_pass_requires_signature check
    (status <> 'PASS' or (report_signature is not null and signer_key_id is not null))
);

comment on table public.w3m_acquisition_reports is
  'Append-only, deal-specific W3M acquisition verification report ledger. Draft V1 schema; not yet integrated with settlement.';
comment on column public.w3m_acquisition_reports.report_payload is
  'Canonical, minimized report snapshot. Store evidence references and outcomes, never secrets, private source code, raw credentials, or payment signing material.';
comment on column public.w3m_acquisition_reports.evidence_hash is
  'SHA-256 digest of canonicalized evidence manifest. It proves integrity of the manifest, not the truth of the underlying claims.';
comment on column public.w3m_acquisition_reports.report_hash is
  'SHA-256 digest of the canonical report envelope that is signed by the configured verification authority.';

create index if not exists w3m_acquisition_reports_deal_latest_idx
  on public.w3m_acquisition_reports (deal_id, report_version desc, issued_at desc);

create index if not exists w3m_acquisition_reports_status_expiry_idx
  on public.w3m_acquisition_reports (status, expires_at);

create table if not exists public.w3m_acquisition_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null
    references public.w3m_acquisition_reports(id) on delete restrict,
  evidence_type text not null check (evidence_type in (
    'PROJECT_IDENTITY',
    'CODE_AUDIT',
    'OWNERSHIP_CONTROL',
    'ASSET_TRANSFER',
    'DEAL_AGREEMENT',
    'PAYMENT',
    'BUYER_ACCEPTANCE',
    'DISPUTE_CHECK',
    'REVENUE_VERIFICATION'
  )),
  source_table text null check (source_table is null or length(btrim(source_table)) <= 120),
  source_record_id text null check (source_record_id is null or length(btrim(source_record_id)) <= 200),
  source_version text null check (source_version is null or length(btrim(source_version)) <= 200),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  result text not null check (result in ('PASS','MISSING','FAILED','STALE','REVIEW_REQUIRED')),
  mandatory boolean not null default true,
  observed_at timestamptz not null default now(),
  valid_until timestamptz null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.w3m_acquisition_evidence is
  'Append-only evidence references and verification outcomes for each immutable report version.';

create index if not exists w3m_acquisition_evidence_report_idx
  on public.w3m_acquisition_evidence (report_id, evidence_type);

create table if not exists public.w3m_acquisition_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null
    references public.w3m_acquisition_reports(id) on delete restrict,
  deal_id text not null check (length(btrim(deal_id)) between 1 and 160),
  event_type text not null check (event_type in (
    'REPORT_CREATED',
    'EVIDENCE_ATTACHED',
    'REPORT_SIGNED',
    'REPORT_SUPERSEDED',
    'REPORT_EXPIRED',
    'SETTLEMENT_GATE_CHECKED',
    'SETTLEMENT_AUTHORIZED',
    'SETTLEMENT_BLOCKED',
    'SETTLEMENT_CONFIRMED'
  )),
  actor_type text not null check (actor_type in ('SYSTEM','VERIFIER','BUYER','SELLER','SAFE_BACKEND','ADMIN')),
  actor_ref text null check (actor_ref is null or length(btrim(actor_ref)) <= 200),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.w3m_acquisition_report_events is
  'Append-only lifecycle event ledger for W3M acquisition reports and settlement gate decisions.';

create index if not exists w3m_acquisition_report_events_report_idx
  on public.w3m_acquisition_report_events (report_id, created_at);

create index if not exists w3m_acquisition_report_events_deal_idx
  on public.w3m_acquisition_report_events (deal_id, created_at);

-- No browser/client access. Writes and reads must occur only through trusted
-- server-side Edge Functions using the service role key stored as a secret.
alter table public.w3m_acquisition_reports enable row level security;
alter table public.w3m_acquisition_evidence enable row level security;
alter table public.w3m_acquisition_report_events enable row level security;

revoke all on table public.w3m_acquisition_reports from public, anon, authenticated, service_role;
revoke all on table public.w3m_acquisition_evidence from public, anon, authenticated, service_role;
revoke all on table public.w3m_acquisition_report_events from public, anon, authenticated, service_role;

-- The service role may read registry state and invoke the atomic RPC, but
-- cannot bypass the RPC with direct table inserts.
grant select on table public.w3m_acquisition_reports to service_role;
grant select on table public.w3m_acquisition_evidence to service_role;
grant select on table public.w3m_acquisition_report_events to service_role;


-- Atomic server-side append operation. A single function invocation is one
-- PostgreSQL transaction: any invalid row rolls back the report, evidence,
-- and event inserts together. The caller must verify the report signature
-- and signer-key status before invoking this function.
create or replace function public.w3m_insert_acquisition_registry_batch(
  p_report jsonb,
  p_evidence jsonb,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_report_id uuid;
  v_deal_id text;
  v_project_id text;
  v_item jsonb;
  v_evidence_count integer := 0;
  v_event_count integer := 0;
  v_report_created_count integer := 0;
  v_evidence_attached_count integer := 0;
  v_report_payload jsonb;
begin
  if jsonb_typeof(p_report) <> 'object'
     or jsonb_typeof(p_evidence) <> 'array'
     or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Registry batch must contain one report object and evidence/event arrays'
      using errcode = '22023';
  end if;

  v_report_id := (p_report->>'id')::uuid;
  v_deal_id := p_report->>'deal_id';
  v_project_id := p_report->>'project_id';
  v_report_payload := p_report->'report_payload';

  if v_deal_id is null or length(btrim(v_deal_id)) = 0
     or v_project_id is null or length(btrim(v_project_id)) = 0
     or v_report_payload is null or jsonb_typeof(v_report_payload) <> 'object' then
    raise exception 'Registry report binding or canonical payload is missing'
      using errcode = '22023';
  end if;

  if v_report_payload->>'reportId' is distinct from v_report_id::text
     or v_report_payload->>'dealId' is distinct from v_deal_id
     or v_report_payload->>'projectId' is distinct from v_project_id
     or v_report_payload->>'reportVersion' is distinct from p_report->>'report_version'
     or v_report_payload->>'status' is distinct from p_report->>'status'
     or v_report_payload->>'evidenceHash' is distinct from p_report->>'evidence_hash' then
    raise exception 'Canonical report payload does not match registry columns'
      using errcode = '22023';
  end if;

  insert into public.w3m_acquisition_reports (
    id, deal_id, project_id, report_version, supersedes_report_id,
    buyer_id, seller_id, status, engine_version, evidence_hash, report_hash,
    report_payload, signer_key_id, report_signature, issued_at, expires_at
  ) values (
    v_report_id, v_deal_id, v_project_id,
    (p_report->>'report_version')::integer,
    nullif(p_report->>'supersedes_report_id', '')::uuid,
    p_report->>'buyer_id', p_report->>'seller_id',
    p_report->>'status', p_report->>'engine_version',
    p_report->>'evidence_hash', p_report->>'report_hash',
    v_report_payload, p_report->>'signer_key_id',
    p_report->>'report_signature',
    (p_report->>'issued_at')::timestamptz,
    (p_report->>'expires_at')::timestamptz
  );

  for v_item in select value from jsonb_array_elements(p_evidence)
  loop
    if v_item->>'report_id' is distinct from v_report_id::text then
      raise exception 'Evidence row references a different report'
        using errcode = '23514';
    end if;

    insert into public.w3m_acquisition_evidence (
      id, report_id, evidence_type, source_table, source_record_id,
      source_version, evidence_hash, result, mandatory, observed_at,
      valid_until, details
    ) values (
      (v_item->>'id')::uuid,
      v_report_id,
      v_item->>'evidence_type',
      v_item->>'source_table',
      v_item->>'source_record_id',
      v_item->>'source_version',
      v_item->>'evidence_hash',
      v_item->>'result',
      coalesce((v_item->>'mandatory')::boolean, true),
      (v_item->>'observed_at')::timestamptz,
      nullif(v_item->>'valid_until', '')::timestamptz,
      coalesce(v_item->'details', '{}'::jsonb)
    );
    v_evidence_count := v_evidence_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(p_events)
  loop
    if v_item->>'report_id' is distinct from v_report_id::text
       or v_item->>'deal_id' is distinct from v_deal_id then
      raise exception 'Event row references a different report or deal'
        using errcode = '23514';
    end if;

    insert into public.w3m_acquisition_report_events (
      id, report_id, deal_id, event_type, actor_type, actor_ref,
      event_hash, metadata, created_at
    ) values (
      (v_item->>'id')::uuid,
      v_report_id,
      v_deal_id,
      v_item->>'event_type',
      v_item->>'actor_type',
      v_item->>'actor_ref',
      v_item->>'event_hash',
      coalesce(v_item->'metadata', '{}'::jsonb),
      (v_item->>'created_at')::timestamptz
    );
    v_event_count := v_event_count + 1;
  end loop;

  select count(*) filter (where event_type = 'REPORT_CREATED'),
         count(*) filter (where event_type = 'EVIDENCE_ATTACHED')
    into v_report_created_count, v_evidence_attached_count
    from public.w3m_acquisition_report_events
   where report_id = v_report_id;

  if v_event_count <> v_evidence_count + 1
     or v_report_created_count <> 1
     or v_evidence_attached_count <> v_evidence_count then
    raise exception 'Registry batch must contain exactly one REPORT_CREATED and one EVIDENCE_ATTACHED per evidence row'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
      from public.w3m_acquisition_report_events
     where report_id = v_report_id
       and event_type = 'REPORT_CREATED'
       and metadata->>'reportHash' = p_report->>'report_hash'
       and metadata->>'reportVersion' = p_report->>'report_version'
       and metadata->>'status' = p_report->>'status'
  ) then
    raise exception 'REPORT_CREATED event metadata does not match the signed report'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.w3m_acquisition_evidence e
     where e.report_id = v_report_id
       and (
         select count(*)
           from public.w3m_acquisition_report_events ev
          where ev.report_id = e.report_id
            and ev.event_type = 'EVIDENCE_ATTACHED'
            and ev.metadata->>'evidenceRowId' = e.id::text
            and ev.metadata->>'evidenceType' = e.evidence_type
            and ev.metadata->>'evidenceHash' = e.evidence_hash
       ) <> 1
  ) then
    raise exception 'Each evidence row must have exactly one matching EVIDENCE_ATTACHED event'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'report_id', v_report_id,
    'evidence_rows', v_evidence_count,
    'event_rows', v_event_count,
    'atomic', true
  );
end;
$function$;

revoke all on function public.w3m_insert_acquisition_registry_batch(jsonb, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_insert_acquisition_registry_batch(jsonb, jsonb, jsonb)
  to service_role;

commit;
