# Future Lab Community — implementation notes

## Scope
This is a front-end-only preview at `future-lab-community-preview.html`. It intentionally does not replace `future-lab.html`, connect to Supabase, alter authentication, or publish content.

## Preview behavior
- Search and category filtering operate on sample cards.
- The article form validates title, topic, summary and content.
- “Save demo draft” uses browser local storage on this device only.
- “Preview submission” opens a local article preview; it does not submit to a server.
- Existing article links are retained where the current page has matching article files.
- The page visibly labels prototype-only behavior.

## Before connecting a database
1. Identify the dedicated non-production Supabase project and verify project ref and billing tier.
2. Inspect existing profile/admin role schema and current auth flows; do not guess the admin role source.
3. Design migration for articles, comments, likes and categories with ownership constraints.
4. Enable RLS on every exposed table and explicitly grant only needed Data API privileges.
5. Keep public reads restricted to published articles; authenticated users may insert drafts only as themselves.
6. Require a trusted server-side admin role for review transitions; authors must not approve their own articles.
7. Use storage policies and file-size/type limits if article images are added.
8. Test unauthorized reads/writes, author spoofing, status tampering, duplicate likes, comment abuse and XSS payloads.
9. Run Supabase security/performance advisors on the isolated environment.
10. Deploy a real preview only after confirming Cloudflare Pages preview configuration and that it does not target production services.

## Acceptance checklist
- [ ] Existing `future-lab.html` and six article pages remain unchanged.
- [ ] Preview is hosted separately and points only at a test backend (once connected).
- [ ] Guest can read published content only.
- [ ] Member can create/edit own draft and submit for review.
- [ ] Member cannot publish directly, edit others' articles, or approve own submission.
- [ ] Admin/reviewer authorization is enforced server-side.
- [ ] Comments/likes require a real authenticated user and cannot be spoofed.
- [ ] Mobile layout and keyboard accessibility tested.
- [ ] Existing marketplace, code audit, passport, deal room and support flows regression-tested.
- [ ] User approves preview before merge/deployment.

## Current limitations
The current page is a static interaction prototype. It is not a functioning multi-user community and has not yet been connected to a dedicated Supabase test project or hosted preview.
