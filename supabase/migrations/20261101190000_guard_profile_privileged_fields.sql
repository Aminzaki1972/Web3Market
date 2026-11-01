-- Prevent authenticated users from self-assigning privileged profile roles or wallet-verification state.
-- Admins and trusted SECURITY DEFINER / service-role workflows remain able to perform
-- legitimate onboarding and wallet-verification updates.
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('anon', 'authenticated')
     and not public.is_admin()
     and (
       new.role is distinct from old.role
       or new.wallet_address is distinct from old.wallet_address
       or new.wallet_verified is distinct from old.wallet_verified
       or new.wallet_verified_at is distinct from old.wallet_verified_at
       or new.wallet_provider is distinct from old.wallet_provider
       or new.wallet_route is distinct from old.wallet_route
     )
  then
    raise exception 'Role and verified wallet identity fields can only be changed by trusted Web3Market workflows.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists profiles_guard_privileged_fields on public.profiles;

create trigger profiles_guard_privileged_fields
before update on public.profiles
for each row
execute function public.guard_profile_privileged_fields();
