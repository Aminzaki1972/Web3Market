-- Require an explicit seller ownership/right-to-sell declaration for new listings.
-- Existing rows are not rewritten or rejected for unrelated updates.
-- Apply and test in a Supabase development branch before production deployment.

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

  -- Preserve existing legacy rows, but require the declaration when moving
  -- a project into a review or published/sold state.
  if (
      (new.status is distinct from old.status and new.status in ('active', 'sold'))
      or
      (new.project_status is distinct from old.project_status
       and new.project_status in ('admin_review', 'approved', 'active'))
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
