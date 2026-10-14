-- Atomic commit for AI review results.
-- Keep project status, project intelligence, and valuation history in one transaction.
-- This migration is proposed only; do not apply to production until reviewed and tested.

create or replace function public.commit_ai_review_result(
  p_project_id uuid,
  p_ai_score numeric,
  p_ai_status text,
  p_verification jsonb,
  p_project_status text,
  p_intelligence jsonb,
  p_valuation jsonb,
  p_request_fingerprint text,
  p_write_valuation boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_project_status text;
  v_ai_status text;
  v_verification jsonb;
  v_existing_fingerprint text;
  v_result jsonb;
begin
  select p.status, p.project_status, p.ai_status, p.verification
    into v_status, v_project_status, v_ai_status, v_verification
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found' using errcode = 'P0002';
  end if;

  v_existing_fingerprint := v_verification->'ai'->>'request_fingerprint';

  -- A retry of the same payload returns the committed result without writing
  -- a second valuation-history row. A changed payload gets a new fingerprint.
  if p_request_fingerprint is not null
     and p_request_fingerprint <> ''
     and v_existing_fingerprint = p_request_fingerprint
  then
    select jsonb_build_object(
      'id', p.id,
      'ai_score', p.ai_score,
      'ai_status', p.ai_status,
      'verification', p.verification,
      'project_status', p.project_status,
      'status', p.status
    )
    into v_result
    from public.projects p
    where p.id = p_project_id;

    return jsonb_build_object('duplicate', true, 'result', v_result);
  end if;

  -- status alone is not enough: submitted listings can still have status='draft'
  -- while project_status='admin_review'. This lock also serializes concurrent submits.
  if v_status is distinct from 'draft'
     or coalesce(v_project_status, '') = 'admin_review'
     or coalesce(v_ai_status, '') = 'recommended_for_admin_review'
  then
    raise exception 'Project is not an editable AI-review draft'
      using errcode = '40001';
  end if;

  update public.projects
  set ai_score = p_ai_score,
      ai_status = p_ai_status,
      verification = p_verification,
      project_status = p_project_status
  where id = p_project_id;

  insert into public.project_intelligence (
    project_id, overall_score, investment_score, technical_score,
    security_score, revenue_score, market_score, acquisition_readiness_score,
    score_version, confidence_score, score_explanation, calculated_at,
    updated_at, ai_summary, risk_level, risk_signals, strengths, data_gaps,
    valuation_low, valuation_mid, valuation_high, valuation_method, price_position
  ) values (
    p_project_id,
    nullif(p_intelligence->>'overall_score', '')::numeric,
    nullif(p_intelligence->>'investment_score', '')::numeric,
    nullif(p_intelligence->>'technical_score', '')::numeric,
    nullif(p_intelligence->>'security_score', '')::numeric,
    nullif(p_intelligence->>'revenue_score', '')::numeric,
    nullif(p_intelligence->>'market_score', '')::numeric,
    nullif(p_intelligence->>'acquisition_readiness_score', '')::numeric,
    p_intelligence->>'score_version',
    nullif(p_intelligence->>'confidence_score', '')::numeric,
    coalesce(p_intelligence->'score_explanation', '{}'::jsonb),
    coalesce(nullif(p_intelligence->>'calculated_at', '')::timestamptz, now()),
    coalesce(nullif(p_intelligence->>'updated_at', '')::timestamptz, now()),
    p_intelligence->>'ai_summary',
    p_intelligence->>'risk_level',
    coalesce(p_intelligence->'risk_signals', '[]'::jsonb),
    coalesce(p_intelligence->'strengths', '[]'::jsonb),
    coalesce(p_intelligence->'data_gaps', '[]'::jsonb),
    nullif(p_intelligence->>'valuation_low', '')::numeric,
    nullif(p_intelligence->>'valuation_mid', '')::numeric,
    nullif(p_intelligence->>'valuation_high', '')::numeric,
    p_intelligence->>'valuation_method',
    p_intelligence->>'price_position'
  )
  on conflict (project_id) do update set
    overall_score = excluded.overall_score,
    investment_score = excluded.investment_score,
    technical_score = excluded.technical_score,
    security_score = excluded.security_score,
    revenue_score = excluded.revenue_score,
    market_score = excluded.market_score,
    acquisition_readiness_score = excluded.acquisition_readiness_score,
    score_version = excluded.score_version,
    confidence_score = excluded.confidence_score,
    score_explanation = excluded.score_explanation,
    calculated_at = excluded.calculated_at,
    updated_at = excluded.updated_at,
    ai_summary = excluded.ai_summary,
    risk_level = excluded.risk_level,
    risk_signals = excluded.risk_signals,
    strengths = excluded.strengths,
    data_gaps = excluded.data_gaps,
    valuation_low = excluded.valuation_low,
    valuation_mid = excluded.valuation_mid,
    valuation_high = excluded.valuation_high,
    valuation_method = excluded.valuation_method,
    price_position = excluded.price_position;

  if coalesce(p_write_valuation, false) then
    insert into public.project_valuation_history (
      project_id, valuation_low, valuation_high, fair_value, asking_price,
      price_position, confidence_score, methodology, valuation_explanation
    ) values (
      p_project_id,
      nullif(p_valuation->>'valuation_low', '')::numeric,
      nullif(p_valuation->>'valuation_high', '')::numeric,
      nullif(p_valuation->>'fair_value', '')::numeric,
      nullif(p_valuation->>'asking_price', '')::numeric,
      p_valuation->>'price_position',
      nullif(p_valuation->>'confidence_score', '')::numeric,
      p_valuation->>'methodology',
      coalesce(p_valuation->'valuation_explanation', '{}'::jsonb)
    );
  end if;

  select jsonb_build_object(
    'id', p.id,
    'ai_score', p.ai_score,
    'ai_status', p.ai_status,
    'verification', p.verification,
    'project_status', p.project_status,
    'status', p.status
  )
  into v_result
  from public.projects p
  where p.id = p_project_id;

  return v_result;
end;
$function$;

revoke all on function public.commit_ai_review_result(uuid, numeric, text, jsonb, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.commit_ai_review_result(uuid, numeric, text, jsonb, text, jsonb, jsonb, text, boolean) to service_role;
