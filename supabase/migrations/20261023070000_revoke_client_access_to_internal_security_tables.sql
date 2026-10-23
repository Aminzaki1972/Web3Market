-- Keep internal audit, admin-event, and view-counter tables inaccessible to client roles.
-- These tables are accessed only by trusted server-side functions/service_role.
ALTER TABLE public.admin_project_email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_audit_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_view_counts ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.admin_project_email_events FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.code_audit_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.project_view_counts FROM PUBLIC, anon, authenticated;
