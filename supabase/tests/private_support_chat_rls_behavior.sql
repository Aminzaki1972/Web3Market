-- Behavioral RLS checks against the disposable PostgreSQL schema created by
-- private-support-chat-db-smoke.yml. This is not a substitute for hosted Supabase tests.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','buyer1@example.test','{"name":"Buyer One"}'),
 ('00000000-0000-0000-0000-000000000002','seller2@example.test','{"name":"Seller Two"}'),
 ('00000000-0000-0000-0000-000000000003','admin@example.test','{"name":"Admin"}'),
 ('00000000-0000-0000-0000-000000000004','support-agent@example.test','{"name":"Support Agent"}');
insert into public.profiles (id, role) values
 ('00000000-0000-0000-0000-000000000001','buyer'),
 ('00000000-0000-0000-0000-000000000002','seller'),
 ('00000000-0000-0000-0000-000000000003','admin'),
 ('00000000-0000-0000-0000-000000000004','seller');
insert into public.support_agents (user_id) values ('00000000-0000-0000-0000-000000000004');
insert into public.support_conversations (id, user_id, subject) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Buyer private conversation'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Seller private conversation');
insert into public.support_messages (conversation_id, sender_id, body) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Buyer private message'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Seller private message');

-- Mock the request claims the same way Supabase PostgREST sets request context.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',false);
do $$
begin
  if (select count(*) from public.support_conversations) <> 1 then
    raise exception 'FAIL: buyer can see another account conversation or cannot see own';
  end if;
  if (select count(*) from public.support_messages) <> 1 then
    raise exception 'FAIL: buyer can see another account message or cannot see own';
  end if;
  begin
    insert into public.support_messages(conversation_id, sender_id, body)
    values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','cross-account attempt');
    raise exception 'FAIL: buyer inserted a message into another account conversation';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',false);
do $$
begin
  if (select count(*) from public.support_conversations) <> 0 then
    raise exception 'FAIL: admin without aal2 can read support conversations';
  end if;
end $$;
reset role;

-- Assigned support agents require AAL2, can read/reply, but cannot change thread status.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1"}',false);
do $$
begin
  if (select count(*) from public.support_conversations) <> 0 then
    raise exception 'FAIL: support agent without AAL2 can read conversations';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}',false);
do $$
declare affected_rows integer;
begin
  if (select count(*) from public.support_conversations) <> 2 then
    raise exception 'FAIL: assigned support agent cannot read all support conversations';
  end if;
  if (select count(*) from public.support_messages) <> 2 then
    raise exception 'FAIL: assigned support agent cannot read all support messages';
  end if;
  insert into public.support_messages(conversation_id, sender_id, body)
  values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','Support agent reply');
  update public.support_conversations set status='closed'
  where id='10000000-0000-0000-0000-000000000001';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'FAIL: support agent changed conversation status';
  end if;
  if (select status from public.support_conversations where id='10000000-0000-0000-0000-000000000001') <> 'open' then
    raise exception 'FAIL: support agent changed conversation status';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',false);
do $$
begin
  if (select count(*) from public.support_conversations) <> 2 then
    raise exception 'FAIL: admin with aal2 cannot read all support conversations';
  end if;
  if (select count(*) from public.support_messages) <> 3 then
    raise exception 'FAIL: admin with aal2 cannot read all support messages';
  end if;
end $$;
reset role;

select 'PASS: buyer/seller isolation and admin AAL2 read policy behavior verified on disposable PostgreSQL' as result;

-- Storage policy behavior. Object names follow <conversation UUID>/<owner UUID>/<filename>.
insert into storage.objects (bucket_id, name) values
 ('support-attachments','10000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001/buyer.png'),
 ('support-attachments','10000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000002/seller.png');

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',false);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='support-attachments') <> 1 then
    raise exception 'FAIL: buyer can see another account attachment or cannot see own';
  end if;
  begin
    insert into storage.objects (bucket_id, name)
    values ('support-attachments','10000000-0000-0000-0000-000000000002/00000000-0000-0000-0000-000000000001/intrusion.png');
    raise exception 'FAIL: buyer uploaded into another account attachment folder';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}',false);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='support-attachments') <> 0 then
    raise exception 'FAIL: admin without aal2 can read support attachments';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',false);
do $$
begin
  if (select count(*) from storage.objects where bucket_id='support-attachments') <> 2 then
    raise exception 'FAIL: admin with aal2 cannot read all support attachments';
  end if;
  insert into storage.objects (bucket_id, name)
  values ('support-attachments','10000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001/admin-reply.png');
end $$;
reset role;

select 'PASS: participant isolation, admin AAL2 and private attachment policy behavior verified on disposable PostgreSQL' as result;


-- Closed threads must reject new messages; only an AAL2 administrator can reopen.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',false);
update public.support_conversations set status='closed'
where id='10000000-0000-0000-0000-000000000001';
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',false);
do $$
begin
  begin
    insert into public.support_messages(conversation_id, sender_id, body)
    values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','message after closure');
    raise exception 'FAIL: buyer sent a message to a closed conversation';
  exception when insufficient_privilege then
    null;
  end;
  update public.support_conversations set status='open'
  where id='10000000-0000-0000-0000-000000000001';
  begin
    insert into public.support_messages(conversation_id, sender_id, body)
    values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','spoofed sender');
    raise exception 'FAIL: buyer spoofed another sender identity';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;


set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',false);
do $$
declare
  affected_rows integer;
begin
  update public.support_conversations set status='open'
  where id='10000000-0000-0000-0000-000000000001';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'FAIL: buyer changed conversation status';
  end if;
  if (select status from public.support_conversations where id='10000000-0000-0000-0000-000000000001') <> 'closed' then
    raise exception 'FAIL: buyer reopened a closed conversation';
  end if;
end $$;
reset role;

select 'PASS: closed-thread writes, buyer status changes and sender spoofing are blocked' as result;


-- Realtime call signaling isolation: a buyer can signal only on their own
-- open conversation topic, not another account's topic.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',false);
select set_config('realtime.topic','support-call:10000000-0000-0000-0000-000000000001',false);
do $$
begin
  insert into realtime.messages(topic, extension, payload, event, private)
  values ('support-call:10000000-0000-0000-0000-000000000001','broadcast','{"type":"signal"}','signal',true);
  if not exists (
    select 1 from realtime.messages
    where topic='support-call:10000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: participant could not publish to own call topic';
  end if;
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}',false);
select set_config('realtime.topic','support-call:10000000-0000-0000-0000-000000000002',false);
do $$
begin
  begin
    insert into realtime.messages(topic, extension, payload, event, private)
    values ('support-call:10000000-0000-0000-0000-000000000002','broadcast','{"type":"signal"}','signal',true);
    raise exception 'FAIL: buyer published to another account call topic';
  exception when insufficient_privilege then
    null;
  end;
  if exists (
    select 1 from realtime.messages
    where topic='support-call:10000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'FAIL: unauthorized cross-account call signal exists';
  end if;
end $$;
reset role;

select 'PASS: private call signaling RLS blocks cross-account topic access in disposable PostgreSQL' as result;
