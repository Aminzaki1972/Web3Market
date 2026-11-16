-- W3M Protocol V1 — immutable, admin-authorized dispute decisions.
-- Isolated V1 migration. Applied only in disposable CI; never production in this phase.
begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.w3m_deal_dispute_decisions (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null unique references public.deal_disputes(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  outcome text not null check (outcome in ('buyer_wins','seller_wins')),
  buyer_refund_amount text,
  reason text not null check (length(btrim(reason)) between 20 and 5000),
  evidence_refs jsonb not null
    check (jsonb_typeof(evidence_refs) = 'array' and jsonb_array_length(evidence_refs) between 1 and 100),
  prior_state jsonb not null check (jsonb_typeof(prior_state) = 'object'),
  terms_version_id uuid not null references public.w3m_deal_terms_versions(id) on delete restrict,
  terms_version bigint not null check (terms_version > 0),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null,
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  decision_hash text not null check (decision_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (canonical_payload->>'decisionId' = id::text),
  check (canonical_payload->>'dealId' = deal_id::text),
  check (canonical_payload->>'disputeId' = dispute_id::text),
  check (canonical_payload->>'outcome' = outcome),
  check (canonical_payload->>'buyerRefundAmount' is not distinct from buyer_refund_amount),
  check (case when outcome='buyer_wins' then
    buyer_refund_amount is not null
    and buyer_refund_amount ~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
    and buyer_refund_amount !~ '[.][0-9]*0$'
    and case when buyer_refund_amount ~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
      then buyer_refund_amount::numeric > 0 else false end
    else buyer_refund_amount is null end),
  check (canonical_payload->>'termsVersionId' = terms_version_id::text),
  check (canonical_payload->>'termsVersion' = terms_version::text),
  check (canonical_payload->>'termsHash' = terms_hash),
  check (canonical_payload->>'decidedBy' = decided_by::text)
);

create index w3m_deal_dispute_decisions_deal_idx
  on public.w3m_deal_dispute_decisions (deal_id, decided_at desc);

alter table public.w3m_deal_dispute_decisions enable row level security;
revoke all on table public.w3m_deal_dispute_decisions
  from public, anon, authenticated, service_role;
grant select on table public.w3m_deal_dispute_decisions to service_role;

create trigger w3m_deal_dispute_decisions_reject_mutation
before update or delete or truncate on public.w3m_deal_dispute_decisions
for each statement execute function public.w3m_reject_registry_mutation();

comment on table public.w3m_deal_dispute_decisions is
  'Append-only authoritative W3M V1 admin dispute decisions, pinned to signed terms and immutable evidence snapshots.';

create or replace function public.w3m_admin_decide_deal_dispute(
  p_deal_id uuid,
  p_dispute_id uuid,
  p_outcome text,
  p_reason text,
  p_evidence_refs jsonb,
  p_buyer_refund_amount text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $decide$
declare
  v_deal public.deals%rowtype;
  v_dispute public.deal_disputes%rowtype;
  v_terms public.w3m_deal_terms_versions%rowtype;
  v_buyer_accept public.w3m_deal_agreement_acceptances%rowtype;
  v_seller_accept public.w3m_deal_agreement_acceptances%rowtype;
  v_existing public.w3m_deal_dispute_decisions%rowtype;
  v_item jsonb;
  v_source text;
  v_record_id uuid;
  v_snapshot jsonb;
  v_content_hash text;
  v_requested_refs jsonb := '[]'::jsonb;
  v_existing_refs jsonb;
  v_evidence_refs jsonb := '[]'::jsonb;
  v_prior_state jsonb;
  v_payload jsonb;
  v_decision_id uuid := gen_random_uuid();
  v_decision_hash text;
  v_decided_at timestamptz := clock_timestamp();
  v_reason text;
  v_refund_amount numeric;
  v_parent_dispute_status text;
begin
  if p_deal_id is null or p_dispute_id is null or p_actor_id is null
     or p_outcome is null or p_outcome not in ('buyer_wins','seller_wins')
     or p_reason is null then
    raise exception 'Invalid W3M dispute decision arguments' using errcode = '22023';
  end if;
  if p_outcome = 'buyer_wins' then
    if p_buyer_refund_amount is null
       or p_buyer_refund_amount !~ '^(0|[1-9][0-9]*)([.][0-9]{1,18})?$'
       or p_buyer_refund_amount ~ '[.][0-9]*0$' then
      raise exception 'Buyer-win decisions require a positive canonical refund amount'
        using errcode = '22023';
    end if;
    v_refund_amount := p_buyer_refund_amount::numeric;
    if v_refund_amount <= 0 then
      raise exception 'Buyer refund amount must be greater than zero' using errcode = '22023';
    end if;
  elsif p_buyer_refund_amount is not null then
    raise exception 'Seller-win decisions cannot include a buyer refund amount'
      using errcode = '22023';
  end if;
  v_reason := btrim(p_reason);
  if length(v_reason) < 20 or length(v_reason) > 5000 then
    raise exception 'Decision reason must contain between 20 and 5000 characters'
      using errcode = '22023';
  end if;

  -- The actor is supplied only by the authenticated Edge Function. Reuse
  -- the existing authoritative public.is_admin() policy, which resolves the
  -- session subject through private.support_is_admin() and profiles.role.
  perform pg_catalog.set_config('request.jwt.claim.sub', p_actor_id::text, true);
  if coalesce(public.is_admin(),false) is not true then
    raise exception 'Verified administrator required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_evidence_refs) is distinct from 'array' then
    raise exception 'Evidence references must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_evidence_refs) < 1 or jsonb_array_length(p_evidence_refs) > 100 then
    raise exception 'One to one hundred evidence references are required'
      using errcode = '22023';
  end if;

  -- Normalize browser references before any lookup. The browser may supply
  -- only source + recordId; hashes and snapshots are always server-computed.
  for v_item in
    select e.value
      from jsonb_array_elements(p_evidence_refs) as e(value)
     order by e.value->>'source', e.value->>'recordId'
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(
         case when jsonb_typeof(v_item) = 'object' then v_item else '{}'::jsonb end
       )) <> 2
       or not (v_item ? 'source')
       or not (v_item ? 'recordId') then
      raise exception 'Evidence references must contain only source and recordId'
        using errcode = '22023';
    end if;
    v_source := v_item->>'source';
    if v_source not in ('deal_message','deal_asset','deal_event','deal_audit_log') then
      raise exception 'Unsupported dispute evidence source' using errcode = '22023';
    end if;
    begin
      v_record_id := (v_item->>'recordId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Evidence record ID must be a UUID' using errcode = '22023';
    end;
    if exists (
      select 1 from jsonb_array_elements(v_requested_refs) r(value)
       where r.value->>'source' = v_source
         and r.value->>'recordId' = v_record_id::text
    ) then
      raise exception 'Duplicate dispute evidence reference' using errcode = '22023';
    end if;
    v_requested_refs := v_requested_refs || jsonb_build_array(
      jsonb_build_object('source',v_source,'recordId',v_record_id::text)
    );
  end loop;

  -- Global lock order is dispute row first, then parent deal. The existing
  -- BEFORE UPDATE dispute trigger runs after PostgreSQL has locked the child
  -- row and then locks the parent deal; matching that order avoids deadlocks.
  -- Safe finalization locks only the parent deal and deliberately never locks
  -- a child dispute row, so it cannot form the reverse edge in this lock graph.
  select * into v_dispute
    from public.deal_disputes d
   where d.id = p_dispute_id and d.deal_id = p_deal_id
   for update;
  if not found then raise exception 'Dispute not found for this deal' using errcode = 'P0002'; end if;

  select * into v_deal
    from public.deals d
   where d.id = p_deal_id
   for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  select * into v_existing
    from public.w3m_deal_dispute_decisions d
   where d.dispute_id = p_dispute_id
   for share;
  if found then
    select coalesce(
      jsonb_agg(
        jsonb_build_object('source',e.value->>'source','recordId',e.value->>'recordId')
        order by e.value->>'source',e.value->>'recordId'
      ), '[]'::jsonb
    ) into v_existing_refs
      from jsonb_array_elements(v_existing.evidence_refs) as e(value);
    if v_deal.status = 'disputed'
       and v_dispute.status = 'resolved'
       and v_dispute.resolution = v_existing.outcome
       and ((v_existing.outcome='buyer_wins' and v_deal.dispute_status='resolved_buyer')
         or (v_existing.outcome='seller_wins' and v_deal.dispute_status='resolved_seller'))
       and v_existing.outcome = p_outcome
       and v_existing.buyer_refund_amount is not distinct from p_buyer_refund_amount
       and v_existing.reason = v_reason
       and v_existing_refs = v_requested_refs then
      return jsonb_build_object(
        'decision_id',v_existing.id,
        'decision_hash',v_existing.decision_hash,
        'outcome',v_existing.outcome,
        'buyer_refund_amount',v_existing.buyer_refund_amount,
        'dispute_record_status','resolved',
        'deal_dispute_status',case when v_existing.outcome='buyer_wins'
          then 'resolved_buyer' else 'resolved_seller' end,
        'deal_status',v_deal.status,
        'idempotent_replay',true
      );
    end if;
    raise exception 'A conflicting immutable dispute decision already exists'
      using errcode = '23505';
  end if;

  if v_deal.status is distinct from 'disputed'
     or v_deal.dispute_status is null
     or v_deal.dispute_status not in ('open','under_review')
     or v_dispute.status is null
     or v_dispute.status not in ('open','under_review') then
    raise exception 'Only an active, consistently disputed deal can receive a decision'
      using errcode = '23514';
  end if;

  if p_outcome = 'buyer_wins' then
    if v_deal.payment_status is distinct from 'confirmed'
       or v_refund_amount > v_deal.amount then
      raise exception 'Buyer refund amount exceeds the confirmed agreed deal amount'
        using errcode = '23514';
    end if;
  end if;

  -- Bind the decision to the latest immutable terms and both parties'
  -- EIP-712 acceptances, including the owner-approved agreement document hash.
  select * into v_terms
    from public.w3m_deal_terms_versions t
   where t.deal_id = p_deal_id
   order by t.terms_version desc
   limit 1
   for share;
  if not found
     or v_terms.project_id is distinct from v_deal.project_id
     or v_terms.buyer_id is distinct from v_deal.buyer_id
     or v_terms.seller_id is distinct from v_deal.seller_id
     or v_terms.chain_id is distinct from 56
     or v_deal.chain_id is distinct from 56
     or lower(v_terms.safe_address) is distinct from lower(v_deal.safe_address)
     or v_terms.canonical_terms->'agreementDocument'->>'documentId' is distinct from 'W3M-AGREEMENT'
     or v_terms.canonical_terms->'agreementDocument'->>'version' is distinct from '1.0'
     or v_terms.canonical_terms->'agreementDocument'->>'locale' is distinct from 'ar'
     or v_terms.canonical_terms->'agreementDocument'->>'sha256'
          is distinct from '721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531' then
    raise exception 'Latest signed agreement terms are missing or misbound'
      using errcode = '23514';
  end if;

  select * into v_buyer_accept
    from public.w3m_deal_agreement_acceptances a
   where a.deal_id = p_deal_id
     and a.terms_version_id = v_terms.id
     and a.terms_version = v_terms.terms_version
     and a.party_role = 'buyer'
   for share;
  select * into v_seller_accept
    from public.w3m_deal_agreement_acceptances a
   where a.deal_id = p_deal_id
     and a.terms_version_id = v_terms.id
     and a.terms_version = v_terms.terms_version
     and a.party_role = 'seller'
   for share;

  if v_buyer_accept.id is null
     or v_seller_accept.id is null
     or v_buyer_accept.party_id is distinct from v_deal.buyer_id
     or v_seller_accept.party_id is distinct from v_deal.seller_id
     or v_buyer_accept.terms_hash is distinct from v_terms.terms_hash
     or v_seller_accept.terms_hash is distinct from v_terms.terms_hash
     or v_buyer_accept.chain_id is distinct from 56
     or v_seller_accept.chain_id is distinct from 56
     or lower(v_buyer_accept.safe_address) is distinct from lower(v_terms.safe_address)
     or lower(v_seller_accept.safe_address) is distinct from lower(v_terms.safe_address) then
    raise exception 'Both buyer and seller must have valid EIP-712 acceptances for the latest terms'
      using errcode = '23514';
  end if;

  -- Snapshot each referenced row under a share lock, scoped to this deal.
  -- Hash the full persisted JSONB record, not caller-supplied content.
  for v_item in
    select e.value
      from jsonb_array_elements(v_requested_refs) as e(value)
     order by e.value->>'source', e.value->>'recordId'
  loop
    v_source := v_item->>'source';
    v_record_id := (v_item->>'recordId')::uuid;
    v_snapshot := null;

    if v_source = 'deal_message' then
      select to_jsonb(m) into v_snapshot from public.deal_messages m
       where m.id = v_record_id and m.deal_id = p_deal_id for share;
    elsif v_source = 'deal_asset' then
      select to_jsonb(a) into v_snapshot from public.deal_assets a
       where a.id = v_record_id and a.deal_id = p_deal_id for share;
    elsif v_source = 'deal_event' then
      select to_jsonb(e) into v_snapshot from public.deal_events e
       where e.id = v_record_id and e.deal_id = p_deal_id for share;
    elsif v_source = 'deal_audit_log' then
      select to_jsonb(a) into v_snapshot from public.deal_audit_logs a
       where a.id = v_record_id and a.deal_id = p_deal_id for share;
    end if;

    if v_snapshot is null then
      raise exception 'Evidence record is missing or belongs to another deal'
        using errcode = '23514';
    end if;
    v_content_hash := encode(
      extensions.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),
      'hex'
    );
    v_evidence_refs := v_evidence_refs || jsonb_build_array(
      jsonb_build_object(
        'source',v_source,
        'recordId',v_record_id::text,
        'contentHash',v_content_hash,
        'snapshot',v_snapshot
      )
    );
  end loop;

  v_prior_state := jsonb_build_object(
    'dealStatus',v_deal.status,
    'dealDisputeStatus',v_deal.dispute_status,
    'disputeRecordStatus',v_dispute.status
  );
  v_payload := jsonb_build_object(
    'protocol','W3M Protocol V1',
    'decisionId',v_decision_id::text,
    'dealId',p_deal_id::text,
    'disputeId',p_dispute_id::text,
    'outcome',p_outcome,
    'buyerRefundAmount',p_buyer_refund_amount,
    'reason',v_reason,
    'evidenceRefs',v_evidence_refs,
    'priorState',v_prior_state,
    'decidedBy',p_actor_id::text,
    'decidedAt',v_decided_at,
    'termsVersionId',v_terms.id::text,
    'termsVersion',v_terms.terms_version::text,
    'termsHash',v_terms.terms_hash
  );
  v_decision_hash := encode(
    extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),
    'hex'
  );

  insert into public.w3m_deal_dispute_decisions (
    id,dispute_id,deal_id,outcome,buyer_refund_amount,reason,evidence_refs,prior_state,
    terms_version_id,terms_version,terms_hash,decided_by,decided_at,
    canonical_payload,decision_hash
  ) values (
    v_decision_id,p_dispute_id,p_deal_id,p_outcome,p_buyer_refund_amount,v_reason,v_evidence_refs,v_prior_state,
    v_terms.id,v_terms.terms_version,v_terms.terms_hash,p_actor_id,v_decided_at,
    v_payload,v_decision_hash
  );

  update public.deal_disputes
     set status = 'resolved',
         resolution = p_outcome,
         resolved_by = p_actor_id,
         resolved_at = v_decided_at,
         updated_at = v_decided_at
   where id = p_dispute_id and deal_id = p_deal_id;

  v_parent_dispute_status := case when p_outcome = 'buyer_wins'
    then 'resolved_buyer' else 'resolved_seller' end;
  update public.deals
     set dispute_status = v_parent_dispute_status,
         updated_at = v_decided_at
   where id = p_deal_id;

  insert into public.deal_audit_logs (
    deal_id,actor_id,action,old_status,new_status,metadata,created_at
  ) values (
    p_deal_id,p_actor_id,'dispute_decision_recorded','disputed','disputed',
    jsonb_build_object(
      'decision_id',v_decision_id,
      'decision_hash',v_decision_hash,
      'outcome',p_outcome,
      'buyer_refund_amount',p_buyer_refund_amount,
      'terms_version_id',v_terms.id,
      'terms_version',v_terms.terms_version,
      'terms_hash',v_terms.terms_hash
    ),
    v_decided_at
  );

  return jsonb_build_object(
    'decision_id',v_decision_id,
    'decision_hash',v_decision_hash,
    'outcome',p_outcome,
    'buyer_refund_amount',p_buyer_refund_amount,
    'dispute_record_status','resolved',
    'deal_dispute_status',v_parent_dispute_status,
    'deal_status','disputed',
    'idempotent_replay',false
  );
end;
$decide$;

revoke all on function public.w3m_admin_decide_deal_dispute(uuid,uuid,text,text,jsonb,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_admin_decide_deal_dispute(uuid,uuid,text,text,jsonb,text,uuid)
  to service_role;


-- Server-only read model used by PREPARE/SIGN adapters to distinguish a
-- verified seller-win decision from an active or buyer-win dispute.
create or replace function public.w3m_read_dealroom_dispute_decision_snapshot(p_deal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $read$
  select jsonb_build_object(
    'deal_id', d.id::text,
    'deal_status', d.status,
    'dispute_status', d.dispute_status,
    'dispute', case when x.id is null then null else jsonb_build_object(
      'id', x.id::text,
      'deal_id', x.deal_id::text,
      'status', x.status,
      'resolution', x.resolution,
      'resolved_by', x.resolved_by::text,
      'resolved_at', x.resolved_at::text
    ) end,
    'decision', case when decision.id is null then null else jsonb_build_object(
      'id', decision.id::text,
      'deal_id', decision.deal_id::text,
      'dispute_id', decision.dispute_id::text,
      'outcome', decision.outcome,
      'buyer_refund_amount', decision.buyer_refund_amount,
      'decision_hash', decision.decision_hash,
      'terms_version_id', decision.terms_version_id::text,
      'terms_version', decision.terms_version::text,
      'terms_hash', decision.terms_hash,
      'decided_by', decision.decided_by::text,
      'decided_at', decision.decided_at::text
    ) end
  )
  from public.deals d
  left join public.deal_disputes x on x.deal_id = d.id
  left join public.w3m_deal_dispute_decisions decision
    on decision.deal_id = d.id and decision.dispute_id = x.id
  where d.id = p_deal_id;
$read$;

revoke all on function public.w3m_read_dealroom_dispute_decision_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_read_dealroom_dispute_decision_snapshot(uuid)
  to service_role;

commit;
