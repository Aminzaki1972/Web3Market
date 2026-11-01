-- Disposable PostgreSQL test for 20261101190000_guard_profile_privileged_fields.sql.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create or replace function public.is_admin()
returns boolean language sql stable
as $$ select coalesce(current_setting('test.is_admin', true), 'false') = 'true' $$;

create table public.profiles (
  id uuid primary key,
  role text not null,
  wallet_address text,
  wallet_verified boolean not null default false,
  wallet_verified_at timestamptz,
  wallet_provider text,
  wallet_route text,
  display_name text
);
grant select, update on public.profiles to authenticated, service_role;

\i supabase/migrations/20261101190000_guard_profile_privileged_fields.sql
\i supabase/migrations/20261101190000_guard_profile_privileged_fields.sql

insert into public.profiles(id, role, wallet_address, wallet_verified, display_name)
values ('11111111-1111-4111-8111-111111111111', 'buyer', null, false, 'Test Buyer');

-- Ordinary authenticated users may update ordinary profile fields.
set role authenticated;
set test.is_admin = 'false';
update public.profiles set display_name = 'Updated Buyer' where id = '11111111-1111-4111-8111-111111111111';

-- Direct authenticated updates are denied; trusted onboarding and wallet workflows are tested separately below.
do $test$
begin
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'FAILED: authenticated user changed own role';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set wallet_verified = true where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'FAILED: authenticated user forged wallet verification';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set wallet_address = '0x1111111111111111111111111111111111111111' where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'FAILED: authenticated user set wallet identity directly';
  exception when insufficient_privilege then null;
  end;
end;
$test$;

-- Admin-authorized updates remain possible.
set test.is_admin = 'true';
update public.profiles set role = 'seller' where id = '11111111-1111-4111-8111-111111111111';

-- Trusted SECURITY DEFINER onboarding/wallet functions remain able to update guarded fields.
reset role;
create or replace function public.test_trusted_wallet_update()
returns void language plpgsql security definer
as $function$
begin
  update public.profiles
  set wallet_address = '0x2222222222222222222222222222222222222222',
      wallet_verified = true,
      wallet_verified_at = now()
  where id = '11111111-1111-4111-8111-111111111111';
end;
$function$;
grant execute on function public.test_trusted_wallet_update() to authenticated;

set role authenticated;
set test.is_admin = 'false';
select public.test_trusted_wallet_update();

reset role;
do $assert$
begin
  if not exists (
    select 1 from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'
      and role = 'seller'
      and wallet_verified = true
      and wallet_address = '0x2222222222222222222222222222222222222222'
  ) then
    raise exception 'FAILED: trusted workflow update did not persist';
  end if;
end;
$assert$;

select 'profile guard migration tests passed' as result;
