-- Move the SECURITY DEFINER role lookup behind a non-exposed schema.
-- Safe to run after the original private support chat migration.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.support_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and lower(coalesce(p.role, '')) = 'admin'
  )
$$;
revoke all on function private.support_is_admin() from public, anon;
grant execute on function private.support_is_admin() to authenticated;

-- Preserve the boolean API contract but remove SECURITY DEFINER from public RPC.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.support_is_admin() $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
