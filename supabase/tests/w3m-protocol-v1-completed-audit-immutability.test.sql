-- Isolated PostgreSQL test: completed Code Audit source rows cannot change.
BEGIN;
CREATE TABLE public.code_audits (
  id uuid PRIMARY KEY,
  status text NOT NULL
);
CREATE TABLE public.code_audit_files (
  id uuid PRIMARY KEY,
  audit_id uuid NOT NULL REFERENCES public.code_audits(id),
  path text NOT NULL
);
CREATE TABLE public.code_audit_findings (
  id uuid PRIMARY KEY,
  audit_id uuid NOT NULL REFERENCES public.code_audits(id),
  title text NOT NULL
);

\i supabase/migrations/20261107066000_w3m_protocol_v1_completed_audit_immutability.sql

INSERT INTO public.code_audits(id,status) VALUES
 ('75000000-0000-4000-8000-000000000001','processing'),
 ('75000000-0000-4000-8000-000000000002','processing');
INSERT INTO public.code_audit_files(id,audit_id,path) VALUES
 ('76000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','src/a.ts');
INSERT INTO public.code_audit_findings(id,audit_id,title) VALUES
 ('77000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','finding'),
 ('77000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000002','open finding');

-- The final transition to completed is allowed; subsequent source mutation is not.
UPDATE public.code_audits SET status='completed'
 WHERE id='75000000-0000-4000-8000-000000000001';

DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    UPDATE public.code_audits SET status='processing'
     WHERE id='75000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Completed audit row update was not blocked'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM public.code_audits
     WHERE id='75000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Completed audit row deletion was not blocked'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.code_audit_files(id,audit_id,path)
    VALUES ('76000000-0000-4000-8000-000000000002',
      '75000000-0000-4000-8000-000000000001','src/b.ts');
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'File insertion after completion was not blocked'; END IF;

  rejected := false;
  BEGIN
    UPDATE public.code_audit_files SET path='src/changed.ts'
     WHERE id='76000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'File update after completion was not blocked'; END IF;

  rejected := false;
  BEGIN
    DELETE FROM public.code_audit_findings
     WHERE id='77000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '55000' THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Finding deletion after completion was not blocked'; END IF;

  -- Audits that have not completed remain writable.
  INSERT INTO public.code_audit_files(id,audit_id,path)
  VALUES ('76000000-0000-4000-8000-000000000003',
    '75000000-0000-4000-8000-000000000002','src/open.ts');
  UPDATE public.code_audit_findings SET title='updated'
   WHERE id='77000000-0000-4000-8000-000000000002';
  IF NOT EXISTS (SELECT 1 FROM public.code_audit_findings
    WHERE id='77000000-0000-4000-8000-000000000002' AND title='updated') THEN
    RAISE EXCEPTION 'In-progress audit findings must remain writable';
  END IF;
END $$;

ROLLBACK;
