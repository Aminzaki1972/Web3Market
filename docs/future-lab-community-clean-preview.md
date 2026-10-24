# Future Lab Community — clean preview branch

## Status
Front-end prototype at `future-lab-community-preview.html`, based directly on `cloudflare-test`. Existing `future-lab.html` and article pages remain unchanged.

## Included front-end interactions
- Search and category filters.
- Responsive article cards and article-reading panel.
- Demo article form with required-field validation.
- Demo draft / pending-review states held only in current page memory.
- Explicitly labeled admin-review simulation: pending submissions stay out of the public feed until approved in the demo; approve/reject actions are temporary and are not authenticated or connected to production.
- Demo likes are limited to one click per article per page session.
- Sample likes are temporary and do not persist.
- A visible notice says no production database or account system is connected.

## Database draft — NOT APPLIED
`supabase/migrations/202610250001_future_lab_community_draft.sql` proposes articles with moderation states, public published-only reads, author-owned submissions, admin moderation, comments, likes and RLS. It assumes `public.profiles(id, role)` exists and must be verified against the actual Supabase schema before any real deployment.

## Free isolated test strategy
- GitHub Actions now runs static safety checks and starts a disposable PostgreSQL 16 service container for integration tests. This uses the workflow runner; it does not create a Supabase project or connect to any Supabase database.
- `supabase/tests/future_lab_community.integration.sql` creates minimal local auth/profile stubs, applies the draft migration and tests anonymous published-only reads, author self-publishing rejection, comment restrictions, duplicate-like prevention and admin moderation.
- A successful local PostgreSQL test is useful regression evidence, but the migration has **not been integration-tested on Supabase** and this local test is not equivalent to Supabase integration testing. Supabase-specific schema, roles, default grants and profile structure still need validation in a dedicated isolated project before deployment.
- Do not run this migration against production.

## Not implemented / not verified
- Real authentication, member profile display, or a working article submission UI connected to Supabase.
- Persistent article records, comments, likes or moderation actions.
- Image upload/storage.
- Hosted Cloudflare preview URL.
- Real Supabase integration or full browser/security testing.

## Isolation and next steps
1. Do not modify `future-lab.html`, existing article files, production Supabase project `hzhqlexnhtukfljcvnyd`, or production deployment settings.
2. Do not reuse `web3market-support-test` for Future Lab; it is dedicated to support testing.
3. A Supabase development branch was quoted at **$0.01344/hour**, so it was not created under the free-only requirement. That would be about $9.81 for 730 hours if charged continuously; actual billing may vary.
4. Run and inspect the disposable PostgreSQL integration workflow first. Only consider a Supabase test environment if the cost is confirmed to be zero or the owner explicitly approves a charge.
5. Confirm Cloudflare Pages preview behavior and URL before presenting it as live.
6. Regression-check marketplace, AI Code Audit, AI Passport, Deal Room and support before any merge.
7. Do not merge or deploy until explicitly approved.
