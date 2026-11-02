-- Guest checkout for paid W3M AI Code Audits.
-- Additive and review-only: do not apply to production until the full flow is tested.

ALTER TABLE public.audit_payment_orders
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.code_audits
  ALTER COLUMN requested_by DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.guest_audit_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL UNIQUE REFERENCES public.audit_payment_orders(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (length(email) BETWEEN 5 AND 254 AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  order_token_hash text NOT NULL CHECK (order_token_hash ~ '^[0-9a-f]{64}$'),
  report_token_hash text NULL CHECK (report_token_hash IS NULL OR report_token_hash ~ '^[0-9a-f]{64}$'),
  report_token_expires_at timestamptz NULL,
  report_token_used_at timestamptz NULL,
  session_token_hash text NULL CHECK (session_token_hash IS NULL OR session_token_hash ~ '^[0-9a-f]{64}$'),
  session_expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  email_sent_at timestamptz NULL,
  email_last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_access_at timestamptz NULL,
  CONSTRAINT guest_audit_access_report_token_pair CHECK (
    (report_token_hash IS NULL AND report_token_expires_at IS NULL)
    OR (report_token_hash IS NOT NULL AND report_token_expires_at IS NOT NULL)
  ),
  CONSTRAINT guest_audit_access_session_token_pair CHECK (
    (session_token_hash IS NULL AND session_expires_at IS NULL)
    OR (session_token_hash IS NOT NULL AND session_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS guest_audit_access_email_created_idx
  ON public.guest_audit_access(lower(email), created_at DESC);

ALTER TABLE public.guest_audit_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_audit_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.guest_audit_access TO service_role;

CREATE TABLE IF NOT EXISTS public.guest_audit_order_rate_limits (
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 10),
  PRIMARY KEY (fingerprint, window_started_at)
);
ALTER TABLE public.guest_audit_order_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_audit_order_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.guest_audit_order_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_guest_audit_order_rate_limit(p_fingerprint text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window timestamptz := date_trunc('hour', now());
  v_count integer;
BEGIN
  IF p_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  INSERT INTO public.guest_audit_order_rate_limits(fingerprint, window_started_at, request_count)
  VALUES (p_fingerprint, v_window, 1)
  ON CONFLICT (fingerprint, window_started_at)
  DO UPDATE SET request_count = public.guest_audit_order_rate_limits.request_count + 1
  RETURNING request_count INTO v_count;
  RETURN v_count <= 5;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_guest_audit_order_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_guest_audit_order_rate_limit(text) TO service_role;

COMMENT ON TABLE public.guest_audit_access IS
  'Server-only guest access for paid audits. Stores SHA-256 token hashes only; report links are exchanged once for short-lived sessions and can be revoked.';
COMMENT ON COLUMN public.audit_payment_orders.user_id IS
  'Authenticated buyer for member orders; NULL for guest checkout. Guest ownership is held in guest_audit_access.';
COMMENT ON COLUMN public.code_audits.requested_by IS
  'Authenticated requester; NULL only for a paid guest audit whose ownership is validated through guest_audit_access.';
