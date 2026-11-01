alter table public.code_audits
  add column if not exists public_rate_window_started_at timestamptz;

-- Atomic per-account hourly quota for W3M Code Audit.
-- This migration is intentionally separate from deployment; review before applying.

create or replace function public.reserve_code_audit_slot(
  p_fingerprint text,
  p_window_started_at timestamptz,
  p_max_requests integer default 3
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_count integer;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid audit quota fingerprint';
  end if;
  if p_window_started_at is null
     or extract(minute from p_window_started_at) <> 0
     or extract(second from p_window_started_at) <> 0 then
    raise exception 'Invalid audit quota window';
  end if;
  if p_max_requests is null or p_max_requests < 1 or p_max_requests > 100 then
    raise exception 'Invalid audit quota maximum';
  end if;

  insert into public.code_audit_rate_limits (fingerprint, window_started_at, request_count)
  values (p_fingerprint, p_window_started_at, 1)
  on conflict (fingerprint, window_started_at)
  do update
    set request_count = public.code_audit_rate_limits.request_count + 1
    where public.code_audit_rate_limits.request_count < p_max_requests
  returning request_count into v_request_count;

  return coalesce(v_request_count, 0);
end;
$$;

create or replace function public.refund_code_audit_slot(
  p_fingerprint text,
  p_window_started_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_count integer;
begin
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
     or p_window_started_at is null then
    raise exception 'Invalid audit quota refund parameters';
  end if;

  update public.code_audit_rate_limits
     set request_count = greatest(0, request_count - 1)
   where fingerprint = p_fingerprint
     and window_started_at = p_window_started_at
  returning request_count into v_request_count;

  return coalesce(v_request_count, 0);
end;
$$;

revoke all on function public.reserve_code_audit_slot(text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.refund_code_audit_slot(text, timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_code_audit_slot(text, timestamptz, integer) to service_role;
grant execute on function public.refund_code_audit_slot(text, timestamptz) to service_role;
