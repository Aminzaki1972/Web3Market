-- Disposable PostgreSQL integration test for the Future Lab migration.
-- Runs only inside the ephemeral GitHub Actions PostgreSQL service, never Supabase.
\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create table public.profiles (id uuid primary key references auth.users(id), role text);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

\i supabase/migrations/202610250001_future_lab_community_draft.sql

insert into auth.users (id) values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003');
insert into public.profiles (id, role) values
 ('00000000-0000-0000-0000-000000000001', 'member'),
 ('00000000-0000-0000-0000-000000000002', 'admin'),
 ('00000000-0000-0000-0000-000000000003', 'member');

insert into public.future_lab_articles
 (id, author_id, title, category, summary, content, status, published_at)
values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Published Web3 Research','Research','A public summary long enough for validation.','This is a published test article body that comfortably exceeds the required eighty character minimum for database validation.','published',now()),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Pending Web3 Research','Research','A private summary long enough for validation.','This is a pending review test article body that comfortably exceeds the required eighty character minimum for database validation.','pending_review',null),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','Other Member Draft','AI','A private summary long enough for validation.','This is a private draft article body that comfortably exceeds the required eighty character minimum for database validation.','draft',null);

-- Anonymous visitors must see published articles only.
set role anon;
set request.jwt.claim.sub = '';
do $$
begin
  if (select count(*) from public.future_lab_articles) <> 1 then
    raise exception 'FAIL: anonymous reader can see non-published articles';
  end if;
end $$$;
reset role;

-- Authors can see their own work but cannot publish it themselves.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
do $$
begin
  if (select count(*) from public.future_lab_articles) <> 2 then
    raise exception 'FAIL: author cannot see exactly their own submissions plus public articles';
  end if;
  begin
    update public.future_lab_articles set status='published', published_at=now()
    where id='10000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: author published their own article without moderation';
  exception when insufficient_privilege then
    null; -- expected RLS WITH CHECK rejection
  end;
end $$$;

-- Authors must not forge editorial notes reserved for moderators.
do $$
begin
  begin
    update public.future_lab_articles
    set moderation_note='Fake moderator note'
    where id='10000000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then
    null; -- expected RLS WITH CHECK rejection
  end;
  if (select moderation_note from public.future_lab_articles
      where id='10000000-0000-0000-0000-000000000002') is not null then
    raise exception 'FAIL: author forged moderation note';
  end if;
end $$;


-- Authors cannot submit an article under another member's identity.
do $$
begin
  begin
    insert into public.future_lab_articles
      (author_id, title, category, summary, content, status)
    values
      ('00000000-0000-0000-0000-000000000003',
       'Spoofed author test', 'Research',
       'A valid summary long enough to pass the database constraints.',
       'This test article body is deliberately long enough to pass the database minimum content length constraint.',
       'pending_review');
    raise exception 'FAIL: member submitted an article as another author';
  exception when insufficient_privilege then
    null; -- expected RLS rejection
  end;
end $$$;

-- An author cannot edit a published article, even if they originally wrote it.
do $$
begin
  update public.future_lab_articles
  set title='Unauthorized edited published title'
  where id='10000000-0000-0000-0000-000000000001';
  if (select title from public.future_lab_articles
      where id='10000000-0000-0000-0000-000000000001')
      <> 'Published Web3 Research' then
    raise exception 'FAIL: author edited a published article';
  end if;
end $$$;


-- A member cannot create an article on behalf of another member.
do $$
begin
  begin
    insert into public.future_lab_articles
      (author_id, title, category, summary, content, status)
    values
      ('00000000-0000-0000-0000-000000000003',
       'Identity check article', 'Research',
       'A summary that is long enough to pass all validation constraints.',
       'The body of this test article is long enough to satisfy the required database content length constraint.',
       'pending_review');
    raise exception 'FAIL: mismatched author ID was accepted';
  exception when insufficient_privilege then
    null;
  end;
end $$$;

-- An author cannot edit a published article; RLS should leave it unchanged.
do $$
begin
  update public.future_lab_articles
  set title='Unauthorized changed title'
  where id='10000000-0000-0000-0000-000000000001';
  if (select title from public.future_lab_articles
      where id='10000000-0000-0000-0000-000000000001')
      <> 'Published Web3 Research' then
    raise exception 'FAIL: published article was changed by its author';
  end if;
end $$$;

-- A member can comment on a published article, not a draft.
insert into public.future_lab_comments (article_id, author_id, body)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','A valid test comment.');

do $$
begin
  begin
    insert into public.future_lab_comments (article_id, author_id, body)
    values ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','This must fail for a draft article.');
    raise exception 'FAIL: comment inserted on a non-published article';
  exception when insufficient_privilege then
    null; -- expected RLS rejection
  end;
end $$$;

-- A duplicate like by the same member for the same article must fail.
insert into public.future_lab_likes (article_id, user_id)
values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
do $$
begin
  begin
    insert into public.future_lab_likes (article_id, user_id)
    values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: duplicate like was accepted';
  exception when unique_violation then
    null; -- expected primary-key rejection
  end;
end $$$;

reset role;

-- Author may revise an article after an admin requests changes, but cannot publish it.
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
update public.future_lab_articles
set status='changes_requested', moderation_note='Please add sources.',
    reviewed_by='00000000-0000-0000-0000-000000000002', reviewed_at=now()
where id='10000000-0000-0000-0000-000000000002';
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
update public.future_lab_articles
set title='Revised Web3 Research', status='pending_review',
    moderation_note=null, reviewed_by=null, reviewed_at=null, published_at=null
where id='10000000-0000-0000-0000-000000000002';
do $$
begin
  if (select title from public.future_lab_articles where id='10000000-0000-0000-0000-000000000002') <> 'Revised Web3 Research' then
    raise exception 'FAIL: author could not revise an article after changes were requested';
  end if;
  begin
    update public.future_lab_articles set status='published', published_at=now()
    where id='10000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: author published article after changes were requested';
  exception when insufficient_privilege then
    null;
  end;
end $$$;
reset role;

-- Admin moderation must work, while author self-publishing above was rejected.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
update public.future_lab_articles
set status='published', reviewed_by='00000000-0000-0000-0000-000000000002',
    reviewed_at=now(), published_at=now()
where id='10000000-0000-0000-0000-000000000002';
do $$
begin
  if (select status from public.future_lab_articles where id='10000000-0000-0000-0000-000000000002') <> 'published' then
    raise exception 'FAIL: admin could not publish a reviewed article';
  end if;
end $$$;
reset role;

select 'PASS: Future Lab disposable PostgreSQL integration tests completed' as result;
