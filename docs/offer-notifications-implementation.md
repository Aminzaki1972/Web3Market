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
1. `js/project.js` attaches a submit handler to `#offerForm`, while `js/offer-form-fix.js` installs a document-level capture handler and calls `stopImmediatePropagation()`. The capture handler is intended to take ownership of the same form submission, so the branch adds the notification request there. This should be verified in a browser test to confirm the offer is created only once and the notification request runs.
2. The repository's `js/offer-actions.js` calls the Postgres RPC `act_on_marketplace_offer`, but a read-only query of the live database did not find that function. No inspected current dashboard or Deal Room file calls `seller-offer-action` or `seller-offer-action-v2` directly. The production acceptance path is therefore not yet proven. Do not deploy the acceptance notification code until this is resolved.
3. The live `marketplace_notification_events` table does not exist yet; it is only defined in this branch's migration.
4. The live database has `public.mark_notification_read(p_notification_id uuid)`; the bell can use this RPC to mark an item read.
5. The deployed Edge Functions remain unchanged: `seller-offer-action` version 28 and `seller-offer-action-v2` version 31. No secrets were inspected or changed, and email delivery has not been tested.

## Deployment prerequisites
1. Browser-test the event ownership between `js/project.js` and `js/offer-form-fix.js`, confirming exactly one deal is inserted and one notification request is made after a successful insert.
2. Locate and verify the actual production offer-acceptance action and its backend. Do not assume either Edge Function is the live caller.
3. Review and apply the migration in a controlled Supabase migration window.
4. Confirm Supabase Edge Function secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set and the sender domain is verified in Resend.
5. Deploy the shared helper alongside each Edge Function that imports it.
6. Test using two test accounts and a disposable listing before any production rollout.

## Test checklist
- [ ] Buyer creates an offer through the actual production form: exactly one seller notification appears.
- [ ] Seller receives one email for the new offer.
- [ ] Seller dashboard bell shows unread count and opens the notification.
- [ ] The verified production acceptance action accepts the offer and invokes buyer notification.
- [ ] Buyer receives one notification and one acceptance email.
- [ ] Repeated notification requests do not create duplicate notifications or emails.
- [ ] Buyer and seller cannot read each other's notifications.
- [ ] Existing $10 test deal and completed settlement records remain unchanged.
- [ ] Email-provider failure is visible in logs and does not interrupt the deal flow.

## Safety status
This is a draft branch only. No production deployment, live database migration, or change to existing deals has been performed.
