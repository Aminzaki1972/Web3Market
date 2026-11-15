-- W3M Protocol V1 immutable dispute decision contract. Disposable PostgreSQL CI only.
do $schema$
declare
  v_rls boolean;
  v_trigger boolean;
  v_finalizer text;
  v_finalizer_compact text;
  v_decision_function text;
begin
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='w3m_deal_dispute_decisions';
  if v_rls is distinct from true then
    raise exception 'Immutable dispute decision table must have RLS enabled';
  end if;

  if not has_table_privilege('service_role','public.w3m_deal_dispute_decisions','SELECT')
     or has_table_privilege('service_role','public.w3m_deal_dispute_decisions','INSERT')
     or has_table_privilege('service_role','public.w3m_deal_dispute_decisions','UPDATE')
     or has_table_privilege('service_role','public.w3m_deal_dispute_decisions','DELETE')
     or has_table_privilege('anon','public.w3m_deal_dispute_decisions','SELECT')
     or has_table_privilege('authenticated','public.w3m_deal_dispute_decisions','SELECT') then
    raise exception 'Dispute decision table privileges are not service-role read-only';
  end if;

  if not has_function_privilege('service_role',
       'public.w3m_admin_decide_deal_dispute(uuid,uuid,text,text,jsonb,uuid)','EXECUTE')
     or has_function_privilege('anon',
       'public.w3m_admin_decide_deal_dispute(uuid,uuid,text,text,jsonb,uuid)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.w3m_admin_decide_deal_dispute(uuid,uuid,text,text,jsonb,uuid)','EXECUTE') then
    raise exception 'Dispute decision RPC must be service-role-only';
  end if;

  select exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='w3m_deal_dispute_decisions'
      and t.tgname='w3m_deal_dispute_decisions_reject_mutation'
      and not t.tgisinternal
      and (t.tgtype & 2)=2 and (t.tgtype & 8)=8
      and (t.tgtype & 16)=16 and (t.tgtype & 32)=32
  ) into v_trigger;
  if not v_trigger then
    raise exception 'Dispute decisions must reject UPDATE, DELETE, and TRUNCATE';
  end if;

  select pg_get_functiondef(
    'public.w3m_finalize_safe_execution_attempt(uuid,text,uuid,jsonb)'::regprocedure
  ) into v_finalizer;
  v_finalizer_compact := regexp_replace(upper(v_finalizer), '\\s+', '', 'g');
  if position('W3M_DEAL_DISPUTE_DECISIONS' in v_finalizer_compact)=0
     or position('RESOLVED_SELLER' in v_finalizer_compact)=0
     or position('SELLER_WINS' in v_finalizer_compact)=0
     or position('RESOLVED_BUYER' in v_finalizer_compact)>0
     or position('DISPUTE_STATUSNOTIN(''NONE'',''RESOLVED_SELLER'')' in v_finalizer_compact)=0 then
    raise exception 'Safe seller finalization must require a recorded seller-wins decision and block buyer-wins';
  end if;

  select pg_get_functiondef(
    'public.w3m_admin_decide_deal_dispute(uuid,uuid,text,text,jsonb,uuid)'::regprocedure
  ) into v_decision_function;
  if position('SELECT * INTO V_DISPUTE' in upper(v_decision_function))=0
     or position('SELECT * INTO V_DEAL' in upper(v_decision_function))=0
     or position('SELECT * INTO V_DISPUTE' in upper(v_decision_function)) >
        position('SELECT * INTO V_DEAL' in upper(v_decision_function)) then
    raise exception 'Dispute decision RPC must lock the dispute row before the parent deal to match trigger lock order';
  end if;
end;
$schema$;

do $test$
declare
  v_buyer1 uuid := '21000000-0000-4000-8000-000000000001';
  v_seller1 uuid := '22000000-0000-4000-8000-000000000001';
  v_buyer2 uuid := '21000000-0000-4000-8000-000000000002';
  v_seller2 uuid := '22000000-0000-4000-8000-000000000002';
  v_buyer3 uuid := '21000000-0000-4000-8000-000000000003';
  v_seller3 uuid := '22000000-0000-4000-8000-000000000003';
  v_admin uuid := '23000000-0000-4000-8000-000000000001';
  v_nonadmin uuid := '24000000-0000-4000-8000-000000000001';
  v_project1 uuid := '31000000-0000-4000-8000-000000000001';
  v_project2 uuid := '31000000-0000-4000-8000-000000000002';
  v_project3 uuid := '31000000-0000-4000-8000-000000000003';
  v_deal1 uuid := '41000000-0000-4000-8000-000000000001';
  v_deal2 uuid := '41000000-0000-4000-8000-000000000002';
  v_deal3 uuid := '41000000-0000-4000-8000-000000000003';
  v_dispute1 uuid := '51000000-0000-4000-8000-000000000001';
  v_dispute2 uuid := '51000000-0000-4000-8000-000000000002';
  v_dispute3 uuid := '51000000-0000-4000-8000-000000000003';
  v_message1 uuid := '61000000-0000-4000-8000-000000000001';
  v_message2 uuid := '61000000-0000-4000-8000-000000000002';
  v_message3 uuid := '61000000-0000-4000-8000-000000000003';
  v_asset1 uuid := '62000000-0000-4000-8000-000000000001';
  v_event1 uuid := '63000000-0000-4000-8000-000000000001';
  v_audit1 uuid := '64000000-0000-4000-8000-000000000001';
  v_terms1 uuid;
  v_terms2 uuid;
  v_terms3a uuid;
  v_terms3b uuid;
  v_result jsonb;
  v_decision_id uuid;
  v_decision_hash text;
  v_blocked boolean;
  v_status text;
  v_resolution text;
  v_parent_status text;
  v_fee numeric;
  v_net numeric;
  v_count integer;
begin
  insert into auth.users(id) values
    (v_buyer1),(v_seller1),(v_buyer2),(v_seller2),(v_buyer3),(v_seller3),(v_admin),(v_nonadmin)
  on conflict do nothing;

  insert into public.admin_users(user_id) values (v_admin) on conflict do nothing;
  insert into public.profiles(id,wallet_address,wallet_verified,wallet_verified_at) values
    (v_buyer1,'0x1111111111111111111111111111111111111111',true,now()),
    (v_seller1,'0x1212121212121212121212121212121212121212',true,now()),
    (v_buyer2,'0x1313131313131313131313131313131313131313',true,now()),
    (v_seller2,'0x1414141414141414141414141414141414141414',true,now()),
    (v_buyer3,'0x1515151515151515151515151515151515151515',true,now()),
    (v_seller3,'0x1616161616161616161616161616161616161616',true,now())
  on conflict (id) do nothing;
  insert into public.profiles(id,role) values
    (v_admin,'admin'),
    (v_nonadmin,'user')
  on conflict (id) do nothing;

  insert into public.projects(id,owner_id,status,github_url) values
    (v_project1,v_seller1,'active','https://example.invalid/w3m-dispute-1'),
    (v_project2,v_seller2,'active','https://example.invalid/w3m-dispute-2'),
    (v_project3,v_seller3,'active','https://example.invalid/w3m-dispute-3');

  insert into public.deals(
    id,project_id,buyer_id,seller_id,amount,currency,platform_fee,platform_fee_percent,
    seller_net_amount,payment_status,delivery_status,dispute_status,chain_id,
    safe_address,token_contract,status,updated_at
  ) values
    (v_deal1,v_project1,v_buyer1,v_seller1,100,'USDT',7.5,7.5,92.5,'confirmed','accepted','open',56,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','disputed',now()),
    (v_deal2,v_project2,v_buyer2,v_seller2,200,'USDT',15,7.5,185,'confirmed','accepted','open',56,
      '0xcccccccccccccccccccccccccccccccccccccccc','0xdddddddddddddddddddddddddddddddddddddddd','disputed',now()),
    (v_deal3,v_project3,v_buyer3,v_seller3,300,'USDT',22.5,7.5,277.5,'confirmed','accepted','open',56,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','0xffffffffffffffffffffffffffffffffffffffff','disputed',now());

  insert into public.deal_disputes(id,deal_id,opened_by,reason,status) values
    (v_dispute1,v_deal1,v_buyer1,'Buyer dispute requiring evidence review','open'),
    (v_dispute2,v_deal2,v_seller2,'Seller dispute requiring evidence review','open'),
    (v_dispute3,v_deal3,v_buyer3,'Third dispute used for stale terms testing','open');

  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    v_deal1,1,v_project1,v_buyer1,v_seller1,56,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('a',64),
    jsonb_build_object('protocol','W3M Protocol V1','agreementDocument',jsonb_build_object(
      'documentId','W3M-AGREEMENT','version','1.0','locale','ar',
      'sha256','721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531'))
  ) returning id into v_terms1;

  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    v_deal2,1,v_project2,v_buyer2,v_seller2,56,'0xcccccccccccccccccccccccccccccccccccccccc',repeat('b',64),
    jsonb_build_object('protocol','W3M Protocol V1','agreementDocument',jsonb_build_object(
      'documentId','W3M-AGREEMENT','version','1.0','locale','ar',
      'sha256','721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531'))
  ) returning id into v_terms2;

  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    v_deal3,1,v_project3,v_buyer3,v_seller3,56,'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',repeat('c',64),
    jsonb_build_object('protocol','W3M Protocol V1','agreementDocument',jsonb_build_object(
      'documentId','W3M-AGREEMENT','version','1.0','locale','ar',
      'sha256','721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531'))
  ) returning id into v_terms3a;

  insert into public.w3m_deal_agreement_acceptances(
    terms_version_id,deal_id,terms_version,party_role,party_id,wallet_address,chain_id,
    safe_address,terms_hash,typed_data_digest,signature
  ) values
    (v_terms1,v_deal1,1,'buyer',v_buyer1,'0x1111111111111111111111111111111111111111',56,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('a',64),'0x'||repeat('1',64),'0x'||repeat('1',130)),
    (v_terms1,v_deal1,1,'seller',v_seller1,'0x1212121212121212121212121212121212121212',56,
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',repeat('a',64),'0x'||repeat('2',64),'0x'||repeat('2',130)),
    (v_terms2,v_deal2,1,'buyer',v_buyer2,'0x1313131313131313131313131313131313131313',56,
      '0xcccccccccccccccccccccccccccccccccccccccc',repeat('b',64),'0x'||repeat('3',64),'0x'||repeat('3',130)),
    (v_terms2,v_deal2,1,'seller',v_seller2,'0x1414141414141414141414141414141414141414',56,
      '0xcccccccccccccccccccccccccccccccccccccccc',repeat('b',64),'0x'||repeat('4',64),'0x'||repeat('4',130)),
    (v_terms3a,v_deal3,1,'buyer',v_buyer3,'0x1515151515151515151515151515151515151515',56,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',repeat('c',64),'0x'||repeat('5',64),'0x'||repeat('5',130)),
    (v_terms3a,v_deal3,1,'seller',v_seller3,'0x1616161616161616161616161616161616161616',56,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',repeat('c',64),'0x'||repeat('6',64),'0x'||repeat('6',130));

  insert into public.w3m_deal_terms_versions(
    deal_id,terms_version,project_id,buyer_id,seller_id,chain_id,safe_address,terms_hash,canonical_terms
  ) values (
    v_deal3,2,v_project3,v_buyer3,v_seller3,56,'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',repeat('d',64),
    jsonb_build_object('protocol','W3M Protocol V1','agreementDocument',jsonb_build_object(
      'documentId','W3M-AGREEMENT','version','1.0','locale','ar',
      'sha256','721aaabcef891b8cdd43cdc34e1980f2166ce32282162d927da942ef8ec10531'))
  ) returning id into v_terms3b;

  insert into public.deal_messages(id,deal_id,sender_id,message) values
    (v_message1,v_deal1,v_buyer1,'The seller has not transferred the repository ownership.'),
    (v_message2,v_deal2,v_seller2,'The buyer did not complete the agreed payment confirmation.'),
    (v_message3,v_deal3,v_buyer3,'The delivered assets do not match the signed terms.');

  insert into public.deal_assets(id,deal_id,asset_name,status,delivery_url,evidence,delivered_by,delivered_at)
  values (v_asset1,v_deal1,'GitHub repository','delivered','https://example.invalid/repo','Delivery evidence',v_seller1,now());

  insert into public.deal_events(id,deal_id,actor_id,event_type,metadata)
  values (v_event1,v_deal1,v_seller1,'asset_delivered',jsonb_build_object('asset','GitHub repository'));

  insert into public.deal_audit_logs(id,deal_id,actor_id,action,old_status,new_status,metadata)
  values (v_audit1,v_deal1,v_seller1,'delivery_submitted','funded','disputed',jsonb_build_object('source','fixture'));

  -- Cross-deal evidence must be rejected without changing the dispute state.
  v_blocked := false;
  begin
    perform public.w3m_admin_decide_deal_dispute(
      v_deal1,v_dispute1,'buyer_wins',
      'Cross-deal evidence must never be accepted as proof.',
      jsonb_build_array(jsonb_build_object('source','deal_message','recordId',v_message2::text)),
      v_admin
    );
  exception when check_violation then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Cross-deal evidence reference was incorrectly accepted'; end if;
  select status into v_status from public.deal_disputes where id=v_dispute1;
  if v_status <> 'open' then raise exception 'Rejected evidence changed the dispute state'; end if;

  -- A non-admin user cannot create an authoritative decision.
  v_blocked := false;
  begin
    perform public.w3m_admin_decide_deal_dispute(
      v_deal2,v_dispute2,'seller_wins',
      'The seller delivered the agreed assets and evidence.',
      jsonb_build_array(jsonb_build_object('source','deal_message','recordId',v_message2::text)),
      v_nonadmin
    );
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Non-admin actor was incorrectly allowed to decide a dispute'; end if;

  -- A newer terms version without both fresh EIP-712 acceptances blocks decisions.
  v_blocked := false;
  begin
    perform public.w3m_admin_decide_deal_dispute(
      v_deal3,v_dispute3,'buyer_wins',
      'The latest terms version was not accepted by both parties.',
      jsonb_build_array(jsonb_build_object('source','deal_message','recordId',v_message3::text)),
      v_admin
    );
  exception when check_violation then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Decision accepted stale/incomplete latest terms'; end if;

  -- Buyer wins: immutable decision includes snapshots and hashes for all
  -- supported evidence sources; no Safe transaction is created here.
  v_result := public.w3m_admin_decide_deal_dispute(
    v_deal1,v_dispute1,'buyer_wins',
    'The seller did not transfer the repository ownership as agreed.',
    jsonb_build_array(
      jsonb_build_object('source','deal_audit_log','recordId',v_audit1::text),
      jsonb_build_object('source','deal_event','recordId',v_event1::text),
      jsonb_build_object('source','deal_asset','recordId',v_asset1::text),
      jsonb_build_object('source','deal_message','recordId',v_message1::text)
    ),
    v_admin
  );
  v_decision_id := (v_result->>'decision_id')::uuid;
  v_decision_hash := v_result->>'decision_hash';
  if v_result->>'outcome' <> 'buyer_wins'
     or v_result->>'dispute_record_status' <> 'resolved'
     or v_result->>'deal_dispute_status' <> 'resolved_buyer'
     or v_result->>'deal_status' <> 'disputed'
     or v_result->>'idempotent_replay' <> 'false'
     or length(v_decision_hash) <> 64 then
    raise exception 'Buyer-win decision returned an invalid state/result';
  end if;

  if (select count(*) from public.w3m_deal_dispute_decisions where id=v_decision_id) <> 1
     or (select count(*) from public.w3m_deal_dispute_decisions
          where id=v_decision_id and jsonb_array_length(evidence_refs)=4
            and decision_hash=encode(extensions.digest(convert_to(canonical_payload::text,'UTF8'),'sha256'),'hex')) <> 1 then
    raise exception 'Immutable decision row or canonical hash is missing';
  end if;
  if exists (
    select 1 from public.w3m_deal_dispute_decisions d,
      lateral jsonb_array_elements(d.evidence_refs) e(value)
     where d.id=v_decision_id
       and (length(e.value->>'contentHash') <> 64 or e.value->'snapshot' is null)
  ) then
    raise exception 'Evidence snapshot or content hash was not persisted';
  end if;

  select status,resolution into v_status,v_resolution
    from public.deal_disputes where id=v_dispute1;
  select dispute_status,platform_fee,seller_net_amount
    into v_parent_status,v_fee,v_net
    from public.deals where id=v_deal1;
  if v_status <> 'resolved' or v_resolution <> 'buyer_wins'
     or v_parent_status <> 'resolved_buyer'
     or v_fee <> 7.5 or v_net <> 92.5 then
    raise exception 'Buyer-win decision changed an invalid dispute or financial state';
  end if;
  select count(*) into v_count from public.deal_multisig_transactions where deal_id=v_deal1;
  if v_count <> 0 then raise exception 'Dispute decision must not create or submit a Safe transaction'; end if;

  -- Identical replay returns the same immutable decision; conflicting replay fails.
  v_result := public.w3m_admin_decide_deal_dispute(
    v_deal1,v_dispute1,'buyer_wins',
    'The seller did not transfer the repository ownership as agreed.',
    jsonb_build_array(
      jsonb_build_object('source','deal_message','recordId',v_message1::text),
      jsonb_build_object('source','deal_asset','recordId',v_asset1::text),
      jsonb_build_object('source','deal_event','recordId',v_event1::text),
      jsonb_build_object('source','deal_audit_log','recordId',v_audit1::text)
    ),
    v_admin
  );
  if (v_result->>'decision_id')::uuid <> v_decision_id
     or v_result->>'idempotent_replay' <> 'true' then
    raise exception 'Identical decision replay was not idempotent';
  end if;

  v_blocked := false;
  begin
    perform public.w3m_admin_decide_deal_dispute(
      v_deal1,v_dispute1,'seller_wins',
      'A conflicting decision must never replace the original decision.',
      jsonb_build_array(jsonb_build_object('source','deal_message','recordId',v_message1::text)),
      v_admin
    );
  exception when unique_violation then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Conflicting second decision was incorrectly accepted'; end if;

  -- Seller wins is a distinct terminal outcome and the only disputed state
  -- eligible for the seller-release finalizer.
  v_result := public.w3m_admin_decide_deal_dispute(
    v_deal2,v_dispute2,'seller_wins',
    'The seller delivered the agreed assets and evidence.',
    jsonb_build_array(jsonb_build_object('source','deal_message','recordId',v_message2::text)),
    v_admin
  );
  if v_result->>'outcome' <> 'seller_wins'
     or v_result->>'deal_dispute_status' <> 'resolved_seller'
     or v_result->>'deal_status' <> 'disputed' then
    raise exception 'Seller-win decision returned an invalid state';
  end if;

  -- The decision table is append-only even for service_role.
  v_blocked := false;
  begin
    update public.w3m_deal_dispute_decisions set reason=reason where false;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Decision UPDATE was not blocked'; end if;

  v_blocked := false;
  begin
    delete from public.w3m_deal_dispute_decisions where false;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Decision DELETE was not blocked'; end if;

  v_blocked := false;
  begin
    truncate table public.w3m_deal_dispute_decisions;
  exception when sqlstate '55000' then v_blocked := true;
  end;
  if not v_blocked then raise exception 'Decision TRUNCATE was not blocked'; end if;
end;
$test$;
