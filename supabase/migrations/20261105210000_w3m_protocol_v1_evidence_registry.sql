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
  report_signature text null check (report_signature is null or report_signature ~ '^0x[0-9a-fA-F]+$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint w3m_acquisition_report_expiry_check check (expires_at > issued_at),
  constraint w3m_acquisition_report_version_unique unique (deal_id, report_version),
  constraint w3m_acquisition_report_supersedes_not_self check
    (supersedes_report_id is null or supersedes_report_id <> id)
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
    'DISPUTE_CHECK'
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

grant select, insert on table public.w3m_acquisition_reports to service_role;
grant select, insert on table public.w3m_acquisition_evidence to service_role;
grant select, insert on table public.w3m_acquisition_report_events to service_role;

commit;
