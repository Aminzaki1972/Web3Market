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
admin_review_path = root / "admin-future-lab-review.html"
admin_center_path = root / "admin-review.html"
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
admin_review = admin_review_path.read_text(encoding="utf-8") if admin_review_path.exists() else ""
admin_center = admin_center_path.read_text(encoding="utf-8") if admin_center_path.exists() else ""

check("preview HTML exists", bool(html))
check("Future Lab admin review page exists", bool(admin_review))
check("existing admin center links to Future Lab moderation",
      'href="admin-future-lab-review.html"' in admin_center)
check("Future Lab admin review requires an authenticated session and MFA AAL2",
      "auth.getSession()" in admin_review and "mfa.getAuthenticatorAssuranceLevel()" in admin_review and 'currentLevel!=="aal2"' in admin_review)
check("Future Lab admin moderation only targets expected review states",
      'in("status",["pending_review","changes_requested"])' in admin_review and
      'data-action="published"' in admin_review and 'data-action="changes_requested"' in admin_review and 'data-action="rejected"' in admin_review)
check("admin moderation page does not contain service-role credentials",
      "service_role" not in admin_review.lower())
check("admin review preview has an explicit database safety lock",
      "PREVIEW_SAFETY_LOCK=true" in admin_review and "Preview safety lock is active" in admin_review)
check("admin review preview cannot connect directly to the production Supabase project",
      "hzhqlexnhtukfljcvnyd.supabase.co" not in admin_review and "js/supabase.js" not in admin_review)
check("SQL migration draft exists", bool(sql))
check("scope and test-gate document exists", bool(doc))
check("preview explicitly says no production database is connected",
      "no production database" in html.lower())
check("demo submit is explicitly non-persistent",
      "nothing is published or sent" in html.lower() and "does not authenticate" in html.lower())
check("HTML includes search and category filter", 'id="search"' in html and 'id="category"' in html)
check("preview includes an explicitly non-authenticated moderation demo",
      'id="reviewBtn"' in html and "DEMO ONLY · NO AUTHENTICATION" in html and
      "not an admin console" in html)
check("demo clearly discloses that reviewer roles and self-approval are not enforced",
      "does not authenticate reviewers or prevent self-approval" in html and
      "server-side authorization will restrict review to administrators" in html)
check("submission button accurately describes the simulated queue action",
      "Submit to demo review queue" in html)
check("pending, draft and changes-requested demo submissions stay hidden from the public feed",
      "demos.filter(a=>a.status==='published')" in html and
      "['pending','draft','changes_requested'].includes(a.status)" in html and
      "a.status='published'" in html)
check("demo queue supports request-changes and resubmission transitions",
      'data-moderate=\"changes\"' in html and 'data-moderate=\"resubmit\"' in html and
      "a.status='changes_requested'" in html and "a.status='pending'" in html and
      "Request changes (demo)" in html and "Resubmit after changes (demo)" in html)
check("demo moderation is clearly non-persistent and does not call production services",
      "Actions stay in this browser page" in html and "nothing was uploaded" in html.lower() and
      "fetch(" not in html.lower())
check("demo likes are limited to one click per article per page session",
      "const liked=new Set()" in html and "liked.has(a.id)" in html)
check("article input has minimum-length validation", 'minlength="80"' in html and 'minlength="8"' in html)
check("HTML escapes untrusted values before rendering",
      "esc=s=>" in html and "replace(/[" in html and "&#39;" in html)
check("no direct production Supabase project URL in preview HTML",
      "hzhqlexnhtukfljcvnyd.supabase.co" not in html)
check("migration is clearly marked not to apply to production",
      "DO NOT apply to production" in sql)
check("anonymous role can evaluate the published-article RLS helper",
      "grant usage on schema future_lab_private to anon, authenticated;" in sql and
      "grant execute on function future_lab_private.is_admin() to anon, authenticated;" in sql)
check("RLS enabled for articles, comments and likes",
      all(f"alter table public.future_lab_{t} enable row level security;" in sql
          for t in ("articles", "comments", "likes")))
check("public article policy restricts anonymous access to published articles",
      "using (status = 'published' or author_id = (select auth.uid()) or (select future_lab_private.is_admin()))" in sql)
check("article submission policy prevents author-supplied published status",
      "status in ('draft','pending_review','changes_requested')" in sql and "published_at is null" in sql)
      
check("moderation schema supports requested changes without author self-publishing",
      "'changes_requested'" in sql and "reviewed_by is null" in sql and "reviewed_at is null" in sql)
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
      "with check ((select future_lab_private.is_admin()))" in sql)
check("migration uses no service-role credential or destructive table drop",
      "service_role" not in sql.lower() and not re.search(r"\bdrop\s+table\b", sql, re.I))

check("disposable PostgreSQL integration test file exists", bool(test_sql))
check("integration test applies the checked-in migration and avoids live Supabase",
      "future_lab_community_draft.sql" in test_sql and "supabase.co" not in test_sql and "service_role" not in test_sql.lower())
check("integration tests cover anonymous reads and author self-publishing rejection",
      "anonymous reader can see non-published articles" in test_sql and
      "author published their own article without moderation" in test_sql)
check("integration tests cover comments and duplicate likes",
      "comment inserted on a non-published article" in test_sql and
      "duplicate like was accepted" in test_sql)
check("integration tests cover author identity enforcement",
      "mismatched author ID was accepted" in test_sql)
check("integration tests cover published article edit restrictions",
      "published article was changed by its author" in test_sql)
check("integration tests cover admin moderation",
      "admin could not publish a reviewed article" in test_sql)

for name, ok in checks:
    print(f'{"PASS" if ok else "FAIL"}: {name}')
print(f"\n{sum(ok for _, ok in checks)}/{len(checks)} static checks passed.")
sys.exit(1 if errors else 0)
