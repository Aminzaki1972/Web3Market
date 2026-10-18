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
- `supabase/migrations/20261018_offer_notification_events.sql`: service-role-only idempotency ledger.
- `supabase/functions/_shared/offer-notifications.ts`: notification/email helper.
- `supabase/functions/marketplace-offer-notification/index.ts`: authenticates the buyer and verifies the pending deal before notifying the seller.
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
11. Read-only schema inspection confirms `public.marketplace_notifications` currently has `id,user_id,project_id,type,title,message,data,read_at,created_at` with RLS enabled. The proposed `marketplace_notification_events` ledger table is not present in the live project, and its migration is not listed as applied. Do not deploy the Edge Function before the reviewed migration is applied and tested.

## Deployment prerequisites
1. Run browser tests with disposable buyer/seller accounts and a disposable listing: one offer row only, seller alert once, accept/reject behavior, buyer acceptance alert, duplicate clicks, stale pending offers, and failure handling.
2. Confirm Safe deployment and settlement end-to-end on a disposable deal, including verified wallets, expected token configuration, 2-of-3 signatures, and correct fee/net amounts. Do not use the completed $10 reference deal for testing.
3. Review and apply the migration in a controlled Supabase migration window only after explicit approval.
4. Confirm the Supabase Edge Function secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set and the sender domain is verified in Resend; then test real email delivery.
5. Deploy the shared helper and `marketplace-offer-notification` before deploying any function that imports the helper; verify idempotency and logs.
6. Only after tests pass, consider publishing the dashboard changes. Do not merge or deploy as part of this read-only audit.

## Test checklist
- [ ] Buyer creates an offer through the test form: exactly one deal row and one seller notification request.
- [ ] Seller receives one in-app notification and one email for a new offer.
- [ ] Seller dashboard bell shows unread count and opens the notification.
- [ ] Seller accepts/rejects a pending offer; backend verifies seller ownership and pending status.
- [ ] Buyer receives one in-app notification and one acceptance email.
- [ ] Repeated notification requests do not create duplicate notifications or emails.
- [ ] Buyer and seller cannot read each other's notifications.
- [ ] Safe creation and settlement continue to use the intended configuration and required signatures.
- [ ] Existing $10 test deal and completed settlement records remain unchanged.
- [ ] Email-provider failure is visible in logs and does not interrupt the deal flow.

## Safety status
This is a draft branch only. No production deployment, live database migration, or change to existing deals has been performed.
