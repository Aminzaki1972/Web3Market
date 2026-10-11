-- Require an explicit seller ownership/right-to-sell declaration for new listings.
-- Existing rows are not rewritten or rejected for unrelated updates.
-- Apply and test in a Supabase development branch before production deployment.

-- The existing trust-field trigger normally blocks sellers from changing
-- ownership_declaration. Allow the project owner to set the exact declaration
-- once, while continuing to protect it and the other trust fields afterward.
create or replace function public.protect_project_trust_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  is_service_role boolean := (coalesce(auth.role(),'') = 'service_role');
  is_admin boolean := exists (select 1 from public.admin_users a where a.user_id = uid);
  required_declaration constant text :=
    'I confirm that I own this project or am legally authorized to sell it, and that I have disclosed the assets and rights included in the sale.';
begin
  -- Service-role writers may update workflow-managed review/verification fields,
  -- but must never transfer project ownership or rewrite the seller declaration.
  -- The declaration guard below independently enforces declaration before status changes.
  if is_service_role then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Project owner cannot be changed';
    end if;
    if new.ownership_declaration is distinct from old.ownership_declaration then
      raise exception 'Ownership declaration cannot be changed by a service workflow';
    end if;
    return new;
  end if;

  if uid is null then
    raise exception 'Authentication required';
  end if;

  if is_admin then
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'Project owner cannot be changed';
  end if;

  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('draft','pending','submitted','under_review')) then
    raise exception 'Project publication status is controlled by the review workflow';
  end if;

  if new.project_status is distinct from old.project_status
     and not (old.project_status in ('draft','pending','submitted','pending_review','admin_review')
              and new.project_status in ('draft','pending','submitted','pending_review','admin_review')) then
    raise exception 'Project approval status is controlled by the review workflow';
  end if;

  if new.ai_status is distinct from old.ai_status then raise exception 'AI status can only be changed by the review service'; end if;
  if new.ai_score is distinct from old.ai_score then raise exception 'AI score can only be changed by the review service'; end if;
  if new.identity_verification is distinct from old.identity_verification
     or new.business_verification is distinct from old.business_verification then
    raise exception 'Verification results can only be changed by the verification service';
  end if;

  if (
       new.ownership_declaration is distinct from old.ownership_declaration
       and not (
         new.ownership_declaration = required_declaration
         and old.owner_id = uid
         and new.owner_id = uid
       )
     )
     or new.domain_ownership is distinct from old.domain_ownership
     or new.github_ownership is distinct from old.github_ownership then
    raise exception 'Verification evidence must use the verification workflow';
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_project_ownership_declaration()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  required_declaration constant text :=
    'I confirm that I own this project or am legally authorized to sell it, and that I have disclosed the assets and rights included in the sale.';
begin
  if tg_op = 'INSERT' then
    if new.ownership_declaration is distinct from required_declaration then
      raise exception 'Ownership and right-to-sell declaration is required.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Do not allow replacing the declaration with arbitrary/blank text.
  if new.ownership_declaration is distinct from old.ownership_declaration
     and new.ownership_declaration is distinct from required_declaration then
    raise exception 'A valid ownership and right-to-sell declaration is required.'
      using errcode = '23514';
  end if;

  -- Preserve existing legacy rows, but require the declaration before any
  -- submission/review state or published/sold state can be entered.
  if (
      (new.status is distinct from old.status
       and new.status in ('pending', 'submitted', 'under_review', 'active', 'sold'))
      or
      (new.project_status is distinct from old.project_status
       and new.project_status in ('pending', 'submitted', 'pending_review', 'admin_review', 'approved', 'active', 'sold'))
     )
     and new.ownership_declaration is distinct from required_declaration then
    raise exception 'Ownership and right-to-sell declaration is required before review or publication.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_ownership_declaration_required on public.projects;

create trigger projects_ownership_declaration_required
before insert or update on public.projects
for each row
execute function public.enforce_project_ownership_declaration();


-- INSERT guard: authenticated sellers may create only drafts and cannot seed
-- server-issued trust/verification fields through the public Data API.
create or replace function public.guard_project_trust_fields_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $guard$
declare
  uid uuid := auth.uid();
  is_service_role boolean := coalesce(auth.role(),'') = 'service_role';
  is_admin boolean := exists (select 1 from public.admin_users a where a.user_id = uid);
begin
  -- Trusted backend jobs may create records through their controlled server path.
  if is_service_role then
    return new;
  end if;

  if uid is null then
    raise exception 'Authentication required';
  end if;

  if is_admin then
    return new;
  end if;

  if new.owner_id is distinct from uid then
    raise exception 'Project owner must match the authenticated user';
  end if;

  if new.status is distinct from 'draft' then
    raise exception 'Sellers can create drafts only; publication is controlled by review workflow';
  end if;

  if coalesce(new.verification, '{}'::jsonb) <> '{}'::jsonb
     or new.ai_score is not null
     or new.ai_status is not null
     or new.admin_notes is not null
     or new.identity_verification is not null
     or new.business_verification is not null
     or new.domain_ownership is not null
     or new.github_ownership is not null
     or new.domain_verification is not null
     or new.w3m_identity_id is not null then
    raise exception 'Verification and trust fields can only be set by authorized review services';
  end if;

  return new;
end;
$guard$;

drop trigger if exists projects_trust_fields_insert_guard on public.projects;
create trigger projects_trust_fields_insert_guard
before insert on public.projects
for each row
execute function public.guard_project_trust_fields_on_insert();
