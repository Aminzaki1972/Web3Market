-- Behavioral RLS checks against the disposable PostgreSQL schema created by
-- private-support-chat-db-smoke.yml. This is not a substitute for hosted Supabase tests.
\set ON_ERROR_STOP on

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','buyer1@example.test','{"name":"Buyer One"}'),
 ('00000000-0000-0000-0000-000000000002','seller2@example.test','{"name":"Seller Two"}'),
 ('00000000-0000-0000-0000-000000000003','admin@example.test','{"name":"Admin"}');
insert into public.profiles (id, role) values
 ('00000000-0000-0000-0000-000000000001','buyer'),
 ('00000000-0000-0000-0000-000000000002','seller'),
 ('00000000-0000-0000-0000-000000000003','admin');
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

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}',false);
do $$
begin
  if (select count(*) from public.support_conversations) <> 2 then
    raise exception 'FAIL: admin with aal2 cannot read all support conversations';
  end if;
  if (select count(*) from public.support_messages) <> 2 then
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
