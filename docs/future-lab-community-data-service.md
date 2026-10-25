# Future Lab community data service — draft integration

## Scope

`js/future-lab-community.js` is a standalone data-service module for the Future Lab community. It is deliberately **not loaded by `future-lab.html`** and does not change the existing six Future Lab articles or the live page.

It expects the existing `js/supabase.js` unified client and the proposed community tables/policies from `supabase/migrations/202610250001_future_lab_community_draft.sql`.

## API

The module exposes `window.Web3MarketFutureLabCommunity`:

- `listPublished({ limit, category })` and `getArticle(id)`
- `saveDraft(article)`, `submitArticle(article)`, `updateOwnArticle(id, article, status)`
- `listComments(articleId)`, `addComment(articleId, body)`
- `listLikes(articleId)`, `hasLiked(articleId)`, `toggleLike(articleId)`
- `listReviewQueue()`, `reviewArticle(id, decision, note)`

The service performs basic input validation and uses the current Supabase authenticated user. Admin UI checks are defense-in-depth only; Supabase RLS must remain the security boundary. Public reads are intended to return published content only, while authors may see their own submissions and admins may moderate.

## Required browser script order (not yet applied)

On a future isolated integration page, load the existing Supabase JS library, then `js/supabase.js`, then `js/future-lab-community.js`. The actual UI must render untrusted article/comment text using `textContent` or safe DOM nodes, not `innerHTML`.

## Release blockers

Do not merge this into the live page or apply the SQL migration until all of these are complete:

1. Run the migration on a dedicated isolated Supabase test project; do not use production or `web3market-support-test`.
2. Test anonymous, ordinary member, author, and admin sessions against actual RLS. Confirm drafts and hidden article comments/likes never leak to anonymous readers.
3. Confirm no member can publish or alter moderation fields; only an administrator can approve/reject/request changes.
4. Test article create/edit/resubmit, like/unlike, comments, and moderation in a browser on mobile/tablet.
5. Verify the six existing Future Lab articles remain unchanged and visible.
6. Review and approve a separate integration PR before connecting any UI. Keep production site and database untouched until explicitly authorized.

The available Supabase free-project limit currently blocks creating another active test project. Do not create a paid Supabase branch or restore an inactive project without explicit approval.
