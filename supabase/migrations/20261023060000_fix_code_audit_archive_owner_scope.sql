-- Restrict audit archive results to the requesting user; admins may review all records.
-- Keep the existing bounded time window and GitHub repository URL validation.
CREATE OR REPLACE FUNCTION public.get_code_audit_archive(p_start timestamp with time zone, p_end timestamp with time zone)
RETURNS TABLE(id uuid, repo_owner text, repo_name text, status text, files_scanned integer, overall_score numeric, risk_level text, created_at timestamp with time zone, completed_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start OR p_end - p_start > interval '2 days' THEN
    RAISE EXCEPTION 'Invalid archive date range' USING errcode = '22023';
  END IF;
  RETURN QUERY
    SELECT a.id, a.repo_owner, a.repo_name,
      CASE
        WHEN lower(coalesce(a.status,'')) IN ('completed','failed','paused','running','pending','processing','queued','scanning','analyzing','retrying')
          THEN lower(a.status)
        ELSE 'unknown'
      END::text,
      greatest(coalesce(a.files_scanned,0),0),
      a.overall_score,
      CASE WHEN lower(coalesce(a.risk_level,'')) IN ('critical','high','moderate','medium','low','informational','unknown','pending')
        THEN a.risk_level ELSE 'Not rated' END::text,
      a.created_at, a.completed_at
    FROM public.code_audits a
    WHERE a.created_at >= p_start AND a.created_at < p_end
      AND coalesce(a.repo_url,'') ~* '^https://github[.]com/[^/]+/[^/]+/?$'
      AND (
        a.requested_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid())
      )
    ORDER BY a.created_at DESC
    LIMIT 500;
END;
$function$;
