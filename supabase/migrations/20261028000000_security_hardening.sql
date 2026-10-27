-- Security hardening based on the 2026-10-28 Supabase advisor review.
-- This migration intentionally does not add client RLS policies to internal tables:
-- they are backend-only tables and should remain inaccessible through the public API.

BEGIN;

-- Prevent unauthenticated users from querying arbitrary per-path traffic counts.
-- This metric is for the admin dashboard only.
CREATE OR REPLACE FUNCTION public.get_page_views_last_24h(p_path text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.admin_users AS au
    WHERE au.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Administrator access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_path IS NULL OR length(p_path) < 1 OR length(p_path) > 500
     OR left(p_path, 1) <> '/' OR p_path LIKE '%://%' THEN
    RAISE EXCEPTION 'Invalid path'
      USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT count(*)::bigint
    FROM public.page_view_events AS pve
    WHERE pve.path = p_path
      AND pve.visited_at >= now() - interval '24 hours'
  );
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_page_views_last_24h(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_page_views_last_24h(text)
  TO authenticated, service_role;

-- This onboarding function already validates auth.uid(), the OAuth provider,
-- and the short onboarding window. Pin its search_path to prevent object shadowing.
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
