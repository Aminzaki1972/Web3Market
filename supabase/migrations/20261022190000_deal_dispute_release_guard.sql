-- Web3Market dispute/release guard.
-- Staged only: do not apply to production until reviewed and approved.

create or replace function public.sync_deal_dispute_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_deal_id uuid;
begin
  v_deal_id := coalesce(NEW.deal_id, OLD.deal_id);
  select status into v_status from public.deal_disputes where deal_id = v_deal_id;

  update public.deals
     set dispute_status = case
           when v_status in ('open','under_review') then v_status
           else 'closed'
         end,
         disputed_at = case
           when v_status in ('open','under_review') then coalesce(disputed_at, now())
           else disputed_at
         end,
         updated_at = now()
   where id = v_deal_id;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_deal_dispute_state on public.deal_disputes;
create trigger trg_sync_deal_dispute_state
after insert or update of status on public.deal_disputes
for each row execute function public.sync_deal_dispute_state();

create or replace function public.block_release_during_open_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dispute_open boolean;
begin
  select (
    coalesce(NEW.dispute_status, 'none') in ('open','under_review')
    or exists (
      select 1 from public.deal_disputes dd
       where dd.deal_id = NEW.id and dd.status in ('open','under_review')
    )
  ) into v_dispute_open;

  if v_dispute_open
     and (
       (NEW.release_tx_hash is not null and NEW.release_tx_hash is distinct from OLD.release_tx_hash)
       or (NEW.status = 'completed' and OLD.status is distinct from 'completed')
     ) then
    raise exception 'Deal release is blocked while a dispute is open'
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_deal_release_during_dispute on public.deals;
create trigger trg_block_deal_release_during_dispute
before update of release_tx_hash, status on public.deals
for each row execute function public.block_release_during_open_dispute();

create or replace function public.block_release_policy_during_open_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.status = 'released' and OLD.status is distinct from 'released'
     and exists (
       select 1
         from public.deals d
        where d.id = NEW.deal_id
          and (
            d.dispute_status in ('open','under_review')
            or exists (
              select 1 from public.deal_disputes dd
               where dd.deal_id = d.id and dd.status in ('open','under_review')
            )
          )
     ) then
    raise exception 'Release policy cannot be marked released while a dispute is open'
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_release_policy_during_dispute on public.deal_release_policies;
create trigger trg_block_release_policy_during_dispute
before update of status on public.deal_release_policies
for each row execute function public.block_release_policy_during_open_dispute();

create or replace function public.block_multisig_release_progress_during_dispute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.action = 'release_to_seller'
     and NEW.status in ('submitted','confirmed')
     and OLD.status is distinct from NEW.status
     and exists (
       select 1
         from public.deals d
        where d.id = NEW.deal_id
          and (
            d.dispute_status in ('open','under_review')
            or exists (
              select 1 from public.deal_disputes dd
               where dd.deal_id = d.id and dd.status in ('open','under_review')
            )
          )
     ) then
    raise exception 'Release transaction progress is blocked while a dispute is open'
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_multisig_release_progress_during_dispute on public.deal_multisig_transactions;
create trigger trg_block_multisig_release_progress_during_dispute
before update of status on public.deal_multisig_transactions
for each row execute function public.block_multisig_release_progress_during_dispute();
