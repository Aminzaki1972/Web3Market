# Future Lab Community — clean preview branch

## Status
Front-end prototype at `future-lab-community-preview.html`, based directly on `cloudflare-test`. Existing `future-lab.html` and article pages remain unchanged.

## Included front-end interactions
- Search and category filters.
- Responsive article cards and article-reading panel.
- Demo article form with required-field validation.
- Demo draft / pending-review states held only in current page memory.
- Sample likes are temporary and do not persist.
- A visible notice says no production database or account system is connected.

## Database draft added — NOT APPLIED
`supabase/migrations/202610250001_future_lab_community_draft.sql` proposes:
- Articles with draft, pending-review, published and rejected states.
- Public reads limited to published articles; authors can view their own submissions.
- Admin moderation based on the existing `profiles.role = 'admin'` convention found in the support helper migration.
- Comments and one-like-per-member constraints, with RLS enabled on all three tables.

This is a migration draft only. It has **not** been run against any database, and its RLS behavior has not been integration-tested. Before use, review function permissions and RLS interactions, add SQL regression tests, confirm the exact current schema and grants, and test against a dedicated isolated Supabase project. Do not apply to production.

## Not implemented / not verified
- Real authentication, member profile display, or a working article submission UI connected to Supabase.
- Persistent article records, comments, likes or moderation actions.
- Image upload/storage.
- Hosted Cloudflare preview URL.
- Database migration execution, SQL integration tests, or full browser/security testing.

## Isolation and next steps
1. Do not modify `future-lab.html`, existing article files, production Supabase project `hzhqlexnhtukfljcvnyd`, or production deployment settings.
2. The existing `web3market-support-test` project is used for support testing; do not reuse it for Future Lab without a separate explicit isolation decision.
3. No dedicated Future Lab test project was found in the currently listed Supabase projects. Do not create a new project or branch until cost is checked and any nonzero charge is approved.
4. Run the SQL draft only in a dedicated test project after confirming schema, grants and RLS policies.
5. Test ownership spoofing, status tampering, author self-approval, duplicate likes, unauthorized comment access, XSS payloads and anonymous reads.
6. Confirm Cloudflare Pages preview behavior and URL before presenting it as a live preview.
7. Run regression checks for marketplace, AI Code Audit, AI Passport, Deal Room and support.
8. Show the working preview and test report to the owner. Do not merge or deploy until explicitly approved.
