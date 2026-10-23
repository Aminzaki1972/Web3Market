-- W3M executive audit indicators; additive and backward-compatible.
-- Apply only after reviewing the matching Edge Function/UI changes in this branch.
ALTER TABLE public.code_audits
  ADD COLUMN IF NOT EXISTS scalability_score integer,
  ADD COLUMN IF NOT EXISTS ai_fit_score integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'code_audits_scalability_score_range') THEN
    ALTER TABLE public.code_audits ADD CONSTRAINT code_audits_scalability_score_range CHECK (scalability_score IS NULL OR scalability_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'code_audits_ai_fit_score_range') THEN
    ALTER TABLE public.code_audits ADD CONSTRAINT code_audits_ai_fit_score_range CHECK (ai_fit_score IS NULL OR ai_fit_score BETWEEN 0 AND 100);
  END IF;
END $$;

COMMENT ON COLUMN public.code_audits.scalability_score IS 'AI-assisted static estimate from repository evidence; not a load-test result.';
COMMENT ON COLUMN public.code_audits.ai_fit_score IS 'AI-fit estimate based on available project evidence; NULL for historical audits without this metric.';
