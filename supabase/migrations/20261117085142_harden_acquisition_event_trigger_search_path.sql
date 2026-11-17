alter function public.w3m_reject_acquisition_event_mutation()
  set search_path = '';
revoke all on function public.w3m_reject_acquisition_event_mutation()
  from public, anon, authenticated, service_role;
