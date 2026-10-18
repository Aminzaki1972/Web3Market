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

## Deployment prerequisites
1. Review and apply the migration in a controlled Supabase migration window.
2. Confirm Supabase Edge Function secrets `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set and the sender domain is verified in Resend.
3. Confirm which seller acceptance function the current production UI invokes; this repository did not show a direct caller in the inspected files.
4. Deploy the shared helper alongside each Edge Function that imports it.
5. Test using two test accounts and a disposable listing before any production rollout.

## Test checklist
- [ ] Buyer creates a pending offer: exactly one seller notification appears.
- [ ] Seller receives one email for the new offer.
- [ ] Seller dashboard bell shows unread count and opens the notification.
- [ ] Seller accepts the offer: offer remains accepted even if email provider fails.
- [ ] Buyer receives one notification and one acceptance email.
- [ ] Repeated notification requests do not create duplicate notifications or emails.
- [ ] Buyer and seller cannot read each other's notifications.
- [ ] Existing $10 test deal and completed settlement records remain unchanged.
- [ ] Email-provider failure is visible in logs and does not interrupt the deal flow.

## Safety status
This is a draft branch only. No production deployment, live database migration, or change to existing deals has been performed.
