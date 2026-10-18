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
1. `js/project.js` attaches a submit handler to `#offerForm`, while `js/offer-form-fix.js` installs a document-level capture handler and calls `stopImmediatePropagation()`. The capture handler is intended to take ownership of the same form submission, so the branch adds the notification request there. This must be verified in a browser test to confirm the offer is created only once and the notification request runs.
2. The repository's `js/offer-actions.js` calls the Postgres RPC `act_on_marketplace_offer`, but a read-only query of the live database did not find that function. Further inspection found that the production `seller-dashboard.html`, `buyer-dashboard.html`, `deal-room.html`, `marketplace.html`, and `project.html` do not load `js/offer-actions.js`; the production seller dashboard renders pending deals but no Accept/Reject controls, and no inspected production page calls either acceptance Edge Function directly. This branch adds Accept/Reject buttons to pending deals in `js/seller-dashboard.js`, routes them to `seller-offer-action-v2`, and updates the script cache version in `seller-dashboard.html`. This is a proposed workflow, not proof of production behavior.
3. The current repository `main` branch did not expose `supabase/functions/seller-offer-action-v2/index.ts` at the expected path during this read-only audit, even though Supabase reports deployed version 31. Therefore the deployed v31 source could not be directly compared with this branch's draft. This is a **deployment blocker**: retrieve/export and review the actual deployed function source before publishing the new dashboard buttons or replacing the function.
4. The draft acceptance function sets the deal status to `accepted`, resets Safe deployment fields, and sets BNB Chain payment configuration; the actual downstream Safe creation and settlement path has not been end-to-end tested against this proposed change. Do not deploy until the deployed function and downstream `create-safe`/Deal Room behavior are reconciled.
5. The live `marketplace_notification_events` table does not exist yet; it is only defined in this branch's migration.
6. The live database has `public.mark_notification_read(p_notification_id uuid)`; the bell can use this RPC to mark an item read.
7. The deployed Edge Functions remain unchanged: `seller-offer-action` version 28 and `seller-offer-action-v2` version 31. No secrets were inspected or changed, and email delivery has not been tested.

## Deployment prerequisites
1. Retrieve the actual deployed v31 `seller-offer-action-v2` source and compare it with this branch. Verify the Safe/payment configuration and downstream `create-safe` and settlement workflow before exposing Accept/Reject buttons.
2. Browser-test the event ownership between `js/project.js` and `js/offer-form-fix.js`, confirming exactly one deal is inserted and one notification request is made after a successful insert.
3. Browser-test accept/reject, duplicate clicks, stale pending offers, and error handling with disposable test accounts and a disposable listing.
4. Review and apply the migration in a controlled Supabase migration window; do not run it against production before approval.
5. Confirm Supabase Edge Function secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set and the sender domain is verified in Resend.
6. Deploy the shared helper alongside each Edge Function that imports it.
7. Test the full flow before any production rollout.

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
