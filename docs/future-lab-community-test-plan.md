# Future Lab Community — isolated implementation plan

## Current state verified
- Existing public page: `future-lab.html`.
- Existing six editorial pages are preserved:
  - `future-lab-ai-agents.html`
  - `future-lab-digital-ownership.html`
  - `future-lab-ai-economic-actor.html`
  - `future-lab-robots-wallets.html`
  - `future-lab-ai-web3-due-diligence.html`
  - `future-lab-autonomous-digital-businesses.html`
- Existing Future Lab page links to the marketplace, AI Passport and AI Code Audit.
- Feature branch: `feature/future-lab-community-preview` from `main`.
- The existing `web3market-support-test` Supabase project contains support-specific tables and test records. It is **not** a safe target for Future Lab schema changes.
- No dedicated Future Lab test project was confirmed. No Supabase database was modified.

## Preview artifact
`future-lab-community-preview.html` is a standalone interface prototype with search, category filtering, article reading, a local-only demo editor, and review-flow explanation. Demo interactions are not persisted and must not be represented as a connected service.

## Draft database migration
`supabase/migrations/20261025000100_future_lab_community.sql` defines author profiles, articles, comments and likes with RLS policies. It is a review artifact only; it has not been applied to any database. Before applying to an isolated test project:
1. Confirm the dedicated test project and its auth/profile schema.
2. Review role checks and column-level grants; RLS alone does not grant Data API access.
3. Run Supabase security advisors and policy tests.
4. Test author, visitor, authenticated reader and admin reviewer scenarios.
5. Confirm authors cannot self-publish, public readers only see published articles, and comment/like writes require authentication.

## No production actions taken
- No production database changes.
- No update to `future-lab.html` or the six existing articles.
- No production deployment or GitHub Pages configuration changes.
- No merge and no pull request opened.
