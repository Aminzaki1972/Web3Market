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

## Admin moderation page
- Added `admin-future-lab-review.html` and a link from the existing Admin Review Center on this isolated branch. It requires an authenticated session with MFA assurance level AAL2 and relies on the proposed database RLS policies for authorization.
- Queue supports Approve & Publish, Request Changes, and Reject with a note. `changes_requested` is now included in the draft migration and authors may edit their own returned submissions, but still cannot set moderation metadata or publish themselves.
- The page will not function against the current database until the migration is separately reviewed and applied to an approved isolated test environment. It deliberately reports that condition; the migration has not been applied to production.

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

## Security review checklist before real Supabase wiring
The following checks are required in addition to the passing disposable PostgreSQL suite. They are **not yet claimed as tested**:
- Verify the real `public.profiles` schema and the exact administrator role convention without exposing profile data.
- Verify Supabase grants and RLS behavior using actual `anon` and `authenticated` JWT contexts in a dedicated free test environment.
- Confirm a member cannot create an article using another member's author ID.
- Confirm a member cannot alter or delete an already-published article through author policies.
- Confirm a member cannot change moderation metadata or status to publish their own article.
- Confirm comments can only be added to published articles, and that comment authors cannot move a comment to another article.
- Confirm duplicate likes are rejected by the database primary key, not just by browser UI state.
- Confirm admin moderation works only for authenticated users whose trusted profile role is admin.
- Confirm unauthenticated requests cannot call any write path or upload endpoint.
- Run browser regression tests against a verified preview URL before proposing a merge.

## Current verification evidence
Latest verified workflow run: [Future Lab isolated preview checks, run #54](https://github.com/Aminzaki1972/Web3Market/actions/runs/40143980677). Both the disposable PostgreSQL integration job and static-safety job completed successfully after fixing the SQL dollar-quote delimiters. The disposable tests include anonymous published-only reads, author self-publish rejection, mismatched author ID rejection, published-article edit restrictions, comment-on-draft rejection, duplicate-like rejection and admin moderation. This is a local PostgreSQL test using mock auth/profile tables; it does not replace Supabase-specific schema/JWT testing or a verified browser preview.
