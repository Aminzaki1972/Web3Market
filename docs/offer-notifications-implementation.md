# Web3Market Offer Notifications — Draft

## Scope
This branch prepares notifications for the existing offer workflow without changing the production site or Supabase project.

- Seller receives an in-app notification and email when a buyer creates a pending offer.
- Buyer receives an in-app notification and email when the seller accepts the offer.
- Both dashboards show a bell with unread count, recent notifications, timestamps, and a link to the related Deal Room.
- Notifications are deduplicated by event key.
- Email failures must not roll back a created or accepted deal.

## Files changed
- `js/notification-bell.js`: shared dashboard bell and account-scoped notification list.
- `buyer-dashboard.html`, `seller-dashboard.html`: load the bell script.
- `js/offer-form-fix.js`: requests a seller notification after the offer insert succeeds.
- `supabase/migrations/20261018_offer_notification_events.sql`: extends the existing notification type constraint and adds a service-role-only idempotency ledger.
- `supabase/functions/_shared/offer-notifications.ts`: notification/email helper.
- `supabase/functions/marketplace-offer-notification/index.ts`: authenticates the buyer and verifies the pending deal before notifying the seller.
- `supabase/functions/marketplace-notification-retry/index.ts`: proposed admin-only endpoint for retrying a failed notification event after rechecking administrator role and current deal status.
- `supabase/functions/seller-offer-action/index.ts` and `seller-offer-action-v2/index.ts`: draft copies with buyer notification/email after acceptance.

## Findings from follow-up read-only audit
1. `js/project.js` attaches a submit handler to `#offerForm`, while `js/offer-form-fix.js` installs a document-level capture handler and calls `stopImmediatePropagation()`. The capture handler is intended to take ownership of the same form submission, so this must be verified in a browser test to confirm exactly one deal insert and one notification request.
2. The repository's `js/offer-actions.js` calls the Postgres RPC `act_on_marketplace_offer`, but a read-only query of the live database did not find that function. The production seller dashboard renders pending deals but has no Accept/Reject controls; the branch adds those controls and routes them to `seller-offer-action-v2`. This is a proposed workflow, not proof of browser behavior.
3. I retrieved the actual deployed `seller-offer-action-v2` source from Supabase (version 31) and compared it with the branch draft. The acceptance/rejection authorization, pending-status guard, BNB Chain (56) payment-config lookup, and Safe-field reset logic match. The branch's substantive addition is calling `notifyOfferEvent` after acceptance and returning notification status. This source comparison is reassuring, but it does not prove runtime compatibility or end-to-end behavior.
4. The deployed v31 acceptance logic resets Safe deployment fields, sets chain ID 56, and chooses the single enabled BNB-chain token configuration. The deployed `create-safe` function (version 48) separately requires accepted status, chain ID 56, verified buyer and seller wallets, three distinct Safe owners, deployer key/RPC configuration, and a funded deployer wallet; it verifies the 2-of-3 Safe owners/threshold before recording the Safe and release policy. These checks must be exercised in a disposable test deal before release.
5. The live `marketplace_notification_events` table does not exist yet; it is only defined in this branch's migration. The notification Edge Function also does not exist in the live project yet. The bell's live mark-read RPC exists, but that alone does not make notification creation deployable.
6. Deployed Edge Functions remain unchanged: `seller-offer-action` version 28 and `seller-offer-action-v2` version 31. Resend secret values were not read, changed, or exposed, and email delivery has not been tested.
7. Follow-up source audit found that a database error while checking for an existing in-app notification could leave the event ledger stuck at `sending`, preventing automatic retry. The branch helper now marks that event `failed` before throwing, so a later attempt can retry. This is a source-level fix only; runtime behavior remains untested.
8. The offer form previously treated failure to save the optional deal message as if offer creation had failed, even though the deal row had already been inserted. The branch now logs that optional-message error and continues showing the created offer, avoiding a misleading failure message. Browser testing is still required.
9. Updated the `project.html` cache-busting query for `js/offer-form-fix.js` so browsers can fetch the revised script rather than reusing a cached version. This change is branch-only until the PR is merged and deployed.
10. A further concurrency review found that two retries could both observe a failed event and continue because the update did not verify that it actually claimed the row. Both retry paths now use an atomic `failed -> sending` conditional update and check whether a row was returned; a caller that did not claim the row exits without sending. This is a source-level improvement, not a runtime test.
11. Read-only schema inspection confirms `public.marketplace_notifications` has `id,user_id,project_id,type,title,message,data,read_at,created_at` with RLS enabled. The proposed `marketplace_notification_events` ledger table is not present in the live project, and its migration is not listed as applied. Do not deploy the Edge Function before the reviewed migration is applied and tested.
12. A second read-only schema check found that the live `marketplace_notifications_type_check` constraint permits only `new_match`, `price_change`, `score_change`, `valuation_change`, `verification_change`, and `system`. The new offer event types would be rejected by the database. The branch migration now replaces that constraint with a list that preserves all six legacy values and adds `offer_created` and `offer_accepted`. This migration has not been applied to production; confirm it against the live schema again immediately before any approved rollout.
13. Retry-path review found a product gap: the helper can retry a ledger row marked `failed` if called again, but there was no user-facing or scheduled retry mechanism. Added a proposed `marketplace-notification-retry` Edge Function in this branch. It requires a valid signed-in user, checks the `profiles.role` value server-side for `admin`, accepts only an existing failed event key, and rechecks that the deal is still in the state matching the event before invoking the shared helper. It does not make retries automatic; an authorized admin must explicitly invoke it. This endpoint has not been deployed or runtime-tested.
14. A fresh read of the live schema metadata confirms `public.profiles` has `id`, `email`, `role`, and `display_name`; `public.deals` has the fields used by the notification helper and its state constraint includes `pending` and `accepted`. This removes the column-name mismatch concern for these queries, but it does not validate profile RLS behavior, actual email delivery, or function execution. The live notification type constraint still excludes the two new types until the branch migration is explicitly applied.


15. Ran Supabase Security and Performance Advisors as a read-only check. The current security advisor reports unrelated existing findings: four exposed `SECURITY DEFINER` RPCs executable by `anon` (page-view helpers) and six executable by `authenticated` (including `get_platform_stats` and `complete_social_registration`), plus leaked-password protection disabled and three RLS-enabled tables without policies. These are platform-wide findings and were not modified as part of the offer-notification branch. Review each function's intended public access before changing grants; do not blindly revoke functions that the public site may need.
16. The performance advisor also reports three RLS policy expressions that may re-evaluate auth settings per row (`deals_buyer_insert_authenticated`, `profiles_insert_own`, and `wallets_own_insert`) and many unused-index notices. These are advisory/performance observations, not proof of a notification defect; no indexes or policies were changed.
17. The available table-metadata response confirms RLS is enabled on `profiles` and `marketplace_notifications`, but it did not expose the actual policy expressions. Therefore, the admin retry endpoint's ability to read its own profile role under RLS, and the inability of users to change their own role, remain unverified. Treat that as a release blocker for the admin retry endpoint until checked with policy definitions and separate admin/non-admin sessions.

## Deployment prerequisites
1. Run browser tests with disposable buyer/seller accounts and a disposable listing: one offer row only, seller alert once, accept/reject behavior, buyer acceptance alert, duplicate clicks, stale pending offers, and failure handling.
2. Confirm Safe deployment and settlement end-to-end on a disposable deal, including verified wallets, expected token configuration, 2-of-3 signatures, and correct fee/net amounts. Do not use the completed $10 reference deal for testing.
3. Review and apply the migration in a controlled Supabase migration window only after explicit approval.
4. Confirm the Supabase Edge Function secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set and the sender domain is verified in Resend; then test real email delivery.
5. Test the proposed admin-only `marketplace-notification-retry` endpoint with an admin account and a non-admin account. Confirm non-admins receive 403, only `failed` events can be retried, current deal state is rechecked, and repeated calls cannot send duplicate notifications.
6. Decide whether an explicit admin-triggered retry is sufficient or a scheduled worker is needed. Retry is not automatic in this branch.
7. Deploy the shared helper and `marketplace-offer-notification` before deploying any function that imports the helper; deploy `marketplace-notification-retry` only after the same migration and security review. Verify idempotency and logs.
8. Only after tests pass, consider publishing the dashboard changes. Do not merge or deploy as part of this read-only audit.

## Test checklist
- [ ] Buyer creates an offer through the test form: exactly one deal row and one seller notification request.
- [ ] Seller receives one in-app notification and one email for a new offer.
- [ ] Seller dashboard bell shows unread count and opens the notification.
- [ ] Seller accepts/rejects a pending offer; backend verifies seller ownership and pending status.
- [ ] Buyer receives one in-app notification and one acceptance email.
- [ ] Repeated notification requests do not create duplicate notifications or emails.
- [ ] Buyer and seller cannot read each other's notifications.
- [ ] Inspect actual `profiles` RLS policies and confirm an authenticated admin can read their own `role`, while users cannot alter their own role; verify with actual buyer, seller, and admin sessions.
- [ ] Verify the retry endpoint with missing/invalid auth, non-admin, unknown event key, `sent`, `sending`, `skipped`, `failed`, and stale deal-state cases.
- [ ] Safe creation and settlement continue to use the intended configuration and required signatures.
- [ ] Existing $10 test deal and completed settlement records remain unchanged.
- [ ] Email-provider failure is visible in logs and does not interrupt the deal flow.

## Safety status
This is a draft branch only. No production deployment, live database migration, or change to existing deals has been performed.
