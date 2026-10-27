-- Security hardening based on the 2026-10-28 Supabase advisor review.
-- Do not add client RLS policies to internal tables: they are backend-only.
-- The public 24-hour traffic counter is intentionally used by js/traffic-counter.js;
-- its existing RPC grants and behavior must remain unchanged to preserve the homepage.

BEGIN;

-- The onboarding function validates auth.uid(), the OAuth provider, and the short
-- onboarding window. Pin its search_path to prevent object shadowing. Its body uses
-- schema-qualified references, so the empty search_path is compatible.
ALTER FUNCTION public.complete_social_registration(text, text)
  SET search_path = '';

-- These tables are deliberately backend-only and have RLS enabled with no client
-- policies. Explicitly remove API-role table privileges as defense in depth.
REVOKE ALL PRIVILEGES ON TABLE
  public.admin_audit_log,
  public.admin_project_email_events,
  public.code_audit_rate_limits,
  public.project_view_counts
FROM PUBLIC, anon, authenticated;

-- Support-agent assignment lookups need an index on the referencing FK column.
CREATE INDEX IF NOT EXISTS support_agents_assigned_by_idx
  ON public.support_agents (assigned_by);

COMMIT;
