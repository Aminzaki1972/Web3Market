#!/usr/bin/env python3
"""Static safety checks for the isolated Future Lab community preview."""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
html_path = root / "future-lab-community-preview.html"
sql_path = root / "supabase/migrations/202610250001_future_lab_community_draft.sql"
doc_path = root / "docs/future-lab-community-clean-preview.md"
test_sql_path = root / "supabase/tests/future_lab_community.integration.sql"
errors = []
checks = []

def check(name, ok):
    checks.append((name, bool(ok)))
    if not ok:
        errors.append(name)

html = html_path.read_text(encoding="utf-8") if html_path.exists() else ""
sql = sql_path.read_text(encoding="utf-8") if sql_path.exists() else ""
doc = doc_path.read_text(encoding="utf-8") if doc_path.exists() else ""
test_sql = test_sql_path.read_text(encoding="utf-8") if test_sql_path.exists() else ""

check("preview HTML exists", bool(html))
check("SQL migration draft exists", bool(sql))
check("scope and test-gate document exists", bool(doc))
check("preview explicitly says no production database is connected",
      "no production database" in html.lower())
check("demo submit is explicitly non-persistent",
      "nothing is published or sent" in html.lower() and "does not authenticate" in html.lower())
check("HTML includes search and category filter", 'id="search"' in html and 'id="category"' in html)
check("article input has minimum-length validation", 'minlength="80"' in html and 'minlength="8"' in html)
check("HTML escapes untrusted values before rendering",
      "esc=s=>" in html and "replace(/[" in html and "&#39;" in html)
check("no direct production Supabase project URL in preview HTML",
      "hzhqlexnhtukfljcvnyd.supabase.co" not in html)
check("migration is clearly marked not to apply to production",
      "DO NOT apply to production" in sql)
check("anonymous role can evaluate the published-article RLS helper",
      "grant usage on schema private to anon, authenticated;" in sql and
      "grant execute on function private.future_lab_is_admin() to anon, authenticated;" in sql)
check("RLS enabled for articles, comments and likes",
      all(f"alter table public.future_lab_{t} enable row level security;" in sql
          for t in ("articles", "comments", "likes")))
check("public article policy restricts anonymous access to published articles",
      "using (status = 'published' or author_id = (select auth.uid()) or (select private.future_lab_is_admin()))" in sql)
check("article submission policy prevents author-supplied published status",
      "status in ('draft','pending_review')" in sql and "published_at is null" in sql)
check("likes enforce one row per member per article",
      "primary key (article_id, user_id)" in sql)
check("migration does not drop existing marketplace tables",
      not re.search(r"\bdrop\s+table\b", sql, re.I))
check("migration does not insert, update or delete existing production data",
      not re.search(r"\b(insert\s+into|update\s+public\.(?!future_lab_)|delete\s+from\s+public\.(?!future_lab_))\b", sql, re.I))
check("docs explain no database integration test has run",
      "not integration-tested" in doc.lower() or "not been integration-tested" in doc.lower())

check("admin helper is SECURITY DEFINER with an empty fixed search_path",
      "security definer" in sql.lower() and "set search_path = ''" in sql.lower())
check("comment authors cannot reassign comments through UPDATE",
      "grant select, insert, delete on public.future_lab_comments to authenticated;" in sql and
      "grant select, insert, update, delete on public.future_lab_comments to authenticated;" not in sql and
      "create policy future_lab_comments_author_update" not in sql)
check("comment inserts require the current author and a published article",
      "author_id = (select auth.uid())" in sql and
      "where a.id = article_id and a.status = 'published'" in sql)
check("admin moderation policy is explicit and authenticated-only",
      "create policy future_lab_articles_admin_manage" in sql and
      "for all to authenticated" in sql and
      "with check ((select private.future_lab_is_admin()))" in sql)
check("migration uses no service-role credential or destructive table drop",
      "service_role" not in sql.lower() and not re.search(r"\bdrop\s+table\b", sql, re.I))

for name, ok in checks:
    print(f'{"PASS" if ok else "FAIL"}: {name}')
print(f"\n{sum(ok for _, ok in checks)}/{len(checks)} static checks passed.")
sys.exit(1 if errors else 0)
