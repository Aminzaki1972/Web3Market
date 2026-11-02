-- Isolated PostgreSQL contract test for the V2 free-audit entitlement index.
BEGIN;
CREATE TABLE public.code_audits (
  id uuid PRIMARY KEY,
  project_id uuid,
  payment_order_id uuid,
  engine_version text NOT NULL,
  status text NOT NULL
);
CREATE UNIQUE INDEX code_audits_one_free_v2_per_project_unique
  ON public.code_audits(project_id)
  WHERE project_id IS NOT NULL
    AND payment_order_id IS NULL
    AND engine_version = 'w3m-code-audit-2.0'
    AND status IN ('queued','scanning','analyzing','retrying','paused','completed');

-- A failed free audit releases the entitlement so a retry can be created.
INSERT INTO public.code_audits VALUES
('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',NULL,'w3m-code-audit-2.0','failed');
INSERT INTO public.code_audits VALUES
('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',NULL,'w3m-code-audit-2.0','queued');

-- A second active/completed free audit for the same project must be rejected.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.code_audits VALUES
    ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',NULL,'w3m-code-audit-2.0','queued');
    RAISE EXCEPTION 'FAIL: duplicate active free audit was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: duplicate active free audit rejected';
  END;
END $$;

-- Paid audits and older engine records do not consume the V2 free entitlement.
INSERT INTO public.code_audits VALUES
('00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','w3m-code-audit-2.0','queued');
INSERT INTO public.code_audits VALUES
('00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001',NULL,'w3m-code-audit-1.0','completed');

-- A completed free audit reserves its project permanently.
INSERT INTO public.code_audits VALUES
('00000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002',NULL,'w3m-code-audit-2.0','completed');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.code_audits VALUES
    ('00000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002',NULL,'w3m-code-audit-2.0','queued');
    RAISE EXCEPTION 'FAIL: second free audit after completion was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: completed free entitlement remains reserved';
  END;
END $$;

-- Paused audits remain reserved to prevent bypassing the one-free-audit limit.
INSERT INTO public.code_audits VALUES
('00000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000003',NULL,'w3m-code-audit-2.0','paused');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.code_audits VALUES
    ('00000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000003',NULL,'w3m-code-audit-2.0','scanning');
    RAISE EXCEPTION 'FAIL: duplicate while paused audit was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: paused audit remains reserved';
  END;
END $$;
ROLLBACK;
