-- W3M Protocol V1: acquisition verification data foundation.
-- Isolated-branch migration only. Do not apply to production without review.
-- All writes are intended to be performed by authenticated Edge Functions using service_role.

CREATE TABLE IF NOT EXISTS public.acquisition_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE RESTRICT,
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  buyer_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  seller_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  report_version integer NOT NULL DEFAULT 1 CHECK (report_version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_review','pass','blocked','rejected','expired','revalidation_required')),
  decision_reason text NULL,
  evidence_manifest_hash text NULL
    CHECK (evidence_manifest_hash IS NULL OR evidence_manifest_hash ~* '^0x[a-f0-9]{64}$'),
  source_commit_sha text NULL
    CHECK (source_commit_sha IS NULL OR source_commit_sha ~* '^[a-f0-9]{40}$'),
  verified_at timestamptz NULL,
  expires_at timestamptz NULL,
  supersedes_report_id uuid NULL REFERENCES public.acquisition_reports(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_reports_pass_requires_hash
    CHECK (status <> 'pass' OR evidence_manifest_hash IS NOT NULL),
  CONSTRAINT acquisition_reports_verified_time_consistency
    CHECK (status <> 'pass' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS acquisition_reports_deal_created_idx
  ON public.acquisition_reports(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS acquisition_reports_status_expiry_idx
  ON public.acquisition_reports(status, expires_at);

CREATE TABLE IF NOT EXISTS public.acquisition_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.acquisition_reports(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL
    CHECK (evidence_type IN ('project_passport','code_audit','repository_commit','ownership','delivery','payment','agreement','wallet_signature','other')),
  source_uri text NULL,
  content_hash text NOT NULL CHECK (content_hash ~* '^0x[a-f0-9]{64}$'),
  source_commit_sha text NULL CHECK (source_commit_sha IS NULL OR source_commit_sha ~* '^[a-f0-9]{40}$'),
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','verified','failed','stale','unavailable')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, evidence_type, content_hash)
);

CREATE INDEX IF NOT EXISTS acquisition_evidence_report_idx
  ON public.acquisition_evidence(report_id, created_at);

CREATE TABLE IF NOT EXISTS public.acquisition_report_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.acquisition_reports(id) ON DELETE RESTRICT,
  signer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL CHECK (wallet_address ~* '^0x[a-f0-9]{40}$'),
  signature_scheme text NOT NULL DEFAULT 'eip712' CHECK (signature_scheme = 'eip712'),
  typed_data_hash text NOT NULL CHECK (typed_data_hash ~* '^0x[a-f0-9]{64}$'),
  signature text NOT NULL CHECK (signature ~* '^0x[a-f0-9]+$'),
  nonce text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','valid','invalid','revoked')),
  verified_at timestamptz NULL,
  UNIQUE (report_id, signer_user_id, typed_data_hash),
  UNIQUE (nonce)
);

CREATE INDEX IF NOT EXISTS acquisition_report_signatures_report_idx
  ON public.acquisition_report_signatures(report_id, signed_at);

CREATE TABLE IF NOT EXISTS public.acquisition_report_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.acquisition_reports(id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN ('created','evidence_added','submitted','evidence_verified','signature_verified','passed','blocked','rejected','expired','revalidation_required','superseded')),
  from_status text NULL,
  to_status text NULL,
  event_hash text NOT NULL CHECK (event_hash ~* '^0x[a-f0-9]{64}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acquisition_report_events_report_idx
  ON public.acquisition_report_events(report_id, id);

-- Event history is append-only, including for service_role.
CREATE OR REPLACE FUNCTION public.w3m_reject_acquisition_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'acquisition_report_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS acquisition_report_events_no_update ON public.acquisition_report_events;
CREATE TRIGGER acquisition_report_events_no_update
  BEFORE UPDATE OR DELETE ON public.acquisition_report_events
  FOR EACH ROW EXECUTE FUNCTION public.w3m_reject_acquisition_event_mutation();

ALTER TABLE public.acquisition_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_report_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_report_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.acquisition_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.acquisition_report_signatures FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.acquisition_report_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_reports TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_evidence TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_report_signatures TO service_role;
GRANT SELECT, INSERT ON TABLE public.acquisition_report_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.acquisition_report_events_id_seq TO service_role;

COMMENT ON TABLE public.acquisition_reports IS
  'W3M Protocol V1 report envelope. PASS is a verification result, not proof of legal title or a substitute for independent review.';
COMMENT ON TABLE public.acquisition_evidence IS
  'Content-hashed evidence references supporting an acquisition report; raw evidence is not copied into this table.';
COMMENT ON TABLE public.acquisition_report_signatures IS
  'EIP-712 report acknowledgements. A signature confirms the exact report digest and does not authorize a Safe transaction.';
COMMENT ON TABLE public.acquisition_report_events IS
  'Append-only audit trail for acquisition verification state transitions.';
