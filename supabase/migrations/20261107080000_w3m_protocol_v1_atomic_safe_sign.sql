-- W3M Protocol V1 — atomic Safe SIGN persistence.
-- Isolated draft only. Signature recovery and fresh W3M authorization are performed
-- by the authenticated Edge handler immediately before this service-role-only RPC.
begin;

create or replace function public.w3m_record_safe_release_signature(
  p_deal_id uuid,
  p_actor_id uuid,
  p_safe_tx_hash text,
  p_signature text,
  p_verified_wallet text,
  p_signer_role text,
  p_w3m_authorization jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $sign$
declare
  v_deal public.deals%rowtype;
  v_profile public.profiles%rowtype;
  v_tx public.deal_multisig_transactions%rowtype;
  v_existing public.deal_multisig_signers%rowtype;
  v_count integer;
  v_signatures jsonb;
  v_status text;
  v_report_id uuid;
  v_report_version integer;
begin
  if p_deal_id is null or p_actor_id is null
     or p_safe_tx_hash is null or p_safe_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
     or p_signature is null or p_signature !~ '^0x[0-9a-fA-F]{130}$'
     or p_verified_wallet is null or p_verified_wallet !~ '^0x[0-9a-fA-F]{40}$'
     or p_signer_role is null or p_signer_role not in ('buyer','seller')
     or p_w3m_authorization is null
     or jsonb_typeof(p_w3m_authorization) <> 'object' then
    raise exception 'Invalid W3M Safe SIGN request' using errcode = '22023';
  end if;

  if p_w3m_authorization->>'authorized' <> 'true'
     or p_w3m_authorization->>'phase' <> 'SIGN'
     or p_w3m_authorization->>'deal_id' <> p_deal_id::text
     or lower(p_w3m_authorization->>'safe_tx_hash') <> lower(p_safe_tx_hash)
     or coalesce(jsonb_typeof(p_w3m_authorization->'issues'),'null') <> 'array'
     or jsonb_array_length(p_w3m_authorization->'issues') <> 0 then
    raise exception 'W3M SIGN authorization is missing or misbound' using errcode = '42501';
  end if;

  begin
    v_report_id := (p_w3m_authorization->>'report_id')::uuid;
    v_report_version := (p_w3m_authorization->>'report_version')::integer;
  exception when others then
    raise exception 'W3M report authorization metadata is malformed' using errcode = '22023';
  end;
  if v_report_version is null or v_report_version < 1 then
    raise exception 'W3M report authorization metadata is invalid' using errcode = '22023';
  end if;

  select * into v_deal
    from public.deals
   where id = p_deal_id
   for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  if p_signer_role = 'buyer' and v_deal.buyer_id <> p_actor_id then
    raise exception 'Actor is not the deal buyer' using errcode = '42501';
  elsif p_signer_role = 'seller' and v_deal.seller_id <> p_actor_id then
    raise exception 'Actor is not the deal seller' using errcode = '42501';
  end if;
  if v_deal.buyer_id = v_deal.seller_id then
    raise exception 'Buyer and seller must be distinct' using errcode = '23514';
  end if;

  select * into v_profile
    from public.profiles
   where id = p_actor_id
   for share;
  if not found or v_profile.wallet_verified is distinct from true
     or v_profile.wallet_verified_at is null
     or v_profile.wallet_verified_at > now()
     or v_profile.wallet_address is null
     or lower(v_profile.wallet_address) <> lower(p_verified_wallet) then
    raise exception 'Actor wallet is not the current verified wallet' using errcode = '42501';
  end if;

  if v_deal.chain_id <> 56 or v_deal.payment_status <> 'confirmed'
     or v_deal.delivery_status <> 'accepted'
     or v_deal.dispute_status is distinct from 'none'
     or v_deal.buyer_approved_at is null then
    raise exception 'Deal payment, delivery, or dispute state blocks signing' using errcode = '23514';
  end if;

  select * into v_tx
    from public.deal_multisig_transactions
   where deal_id = p_deal_id
     and action = 'release_to_seller'
   for update;
  if not found then raise exception 'Safe release transaction not found' using errcode = 'P0002'; end if;
  if (select count(*) from public.deal_multisig_transactions
       where deal_id = p_deal_id and action = 'release_to_seller') <> 1 then
    raise exception 'Ambiguous Safe release transaction rows' using errcode = '23514';
  end if;
  if v_tx.safe_tx_hash is null or v_tx.safe_address is null
     or lower(v_tx.safe_tx_hash) <> lower(p_safe_tx_hash)
     or v_tx.chain_id <> 56
     or lower(v_tx.safe_address) <> lower(v_deal.safe_address)
     or v_tx.required_signatures <> 2
     or v_tx.status not in ('awaiting_signatures','signed') then
    raise exception 'Safe release transaction changed or is not signable' using errcode = '23514';
  end if;

  select * into v_existing
    from public.deal_multisig_signers
   where deal_id = p_deal_id and signer_role = p_signer_role
   for update;
  if found then
    if v_existing.signature_status = 'signed' then
      if v_existing.signer_id = p_actor_id
         and lower(v_existing.wallet_address) = lower(p_verified_wallet)
         and lower(v_existing.safe_tx_hash) = lower(p_safe_tx_hash)
         and lower(v_existing.signature) = lower(p_signature) then
        select count(*) into v_count
          from public.deal_multisig_signers
         where deal_id = p_deal_id
           and safe_tx_hash = p_safe_tx_hash
           and signature_status = 'signed';
        return jsonb_build_object(
          'recorded',true,'idempotent_replay',true,
          'confirmations_count',v_count,'required_signatures',2,
          'status',case when v_count >= 2 then 'signed' else 'awaiting_signatures' end
        );
      end if;
      raise exception 'A different signature is already recorded for this party' using errcode = '23505';
    end if;
    update public.deal_multisig_signers
       set signer_id = p_actor_id,
           wallet_address = lower(p_verified_wallet),
           signature_status = 'signed',
           signed_at = now(),
           safe_tx_hash = lower(p_safe_tx_hash),
           signature = lower(p_signature)
     where id = v_existing.id;
  else
    insert into public.deal_multisig_signers(
      deal_id,signer_role,signer_id,wallet_address,
      signature_status,signed_at,safe_tx_hash,signature
    ) values (
      p_deal_id,p_signer_role,p_actor_id,lower(p_verified_wallet),
      'signed',now(),lower(p_safe_tx_hash),lower(p_signature)
    );
  end if;

  select count(*) into v_count
    from public.deal_multisig_signers
   where deal_id = p_deal_id
     and safe_tx_hash = lower(p_safe_tx_hash)
     and signature_status = 'signed';
  if v_count > 2 then
    raise exception 'Unexpected signer count exceeds Safe threshold' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'wallet_address',lower(wallet_address),
    'signature',lower(signature)
  ) order by lower(wallet_address)),'[]'::jsonb)
    into v_signatures
    from public.deal_multisig_signers
   where deal_id = p_deal_id
     and safe_tx_hash = lower(p_safe_tx_hash)
     and signature_status = 'signed';

  v_status := case when v_count >= 2 then 'signed' else 'awaiting_signatures' end;
  update public.deal_multisig_transactions
     set signatures = v_signatures,
         confirmations_count = v_count,
         status = v_status,
         updated_at = now()
   where id = v_tx.id;

  insert into public.deal_audit_logs(
    deal_id,actor_id,action,old_status,new_status,metadata
  ) values (
    p_deal_id,p_actor_id,'w3m_safe_signature_recorded',
    v_tx.status,v_status,
    jsonb_build_object(
      'safe_tx_hash',lower(p_safe_tx_hash),
      'signer_role',p_signer_role,
      'wallet_address',lower(p_verified_wallet),
      'report_id',v_report_id,
      'report_version',v_report_version,
      'confirmations_count',v_count
    )
  );

  return jsonb_build_object(
    'recorded',true,
    'idempotent_replay',false,
    'confirmations_count',v_count,
    'required_signatures',2,
    'status',v_status
  );
end;
$sign$;

revoke all on function public.w3m_record_safe_release_signature(uuid,uuid,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.w3m_record_safe_release_signature(uuid,uuid,text,text,text,text,jsonb)
  to service_role;

comment on function public.w3m_record_safe_release_signature(uuid,uuid,text,text,text,text,jsonb) is
  'Atomic isolated W3M SIGN persistence. Called only after authenticated fresh W3M authorization and EIP-712 recovery in the server handler. Never deployed by this branch work.';

commit;
