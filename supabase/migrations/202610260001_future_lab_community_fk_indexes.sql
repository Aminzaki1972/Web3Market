-- Supporting indexes for Future Lab community foreign keys.
-- Applied to production on 2026-10-26; safe to rerun.
create index if not exists future_lab_articles_reviewed_by_idx on public.future_lab_articles (reviewed_by);
create index if not exists future_lab_comments_author_idx on public.future_lab_comments (author_id);
create index if not exists future_lab_likes_user_idx on public.future_lab_likes (user_id);
