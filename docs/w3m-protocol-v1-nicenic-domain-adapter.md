# W3M Protocol V1 — NiceNIC Domain Adapter

**Status:** Read-only NiceNIC API v2 adapter and W3M evidence events added to the isolated branch.
**Production impact:** None. No NiceNIC API key was created, requested, stored, or used. No domain/contact/nameserver/transfer operation was issued.

## Verified provider capabilities

NiceNIC's current API v2 documentation lists:
- `domain_list`: paginated domain inventory, including domain name, status, expiry, nameservers, and hold status.
- `info`: domain details including registration/expiry dates, nameservers, and registrant contact fields.
- `change_contact`: changes registrant contact information.
- `transfer`: documented as transfer-in from another registrar.

The API documentation does not currently describe an account-to-account domain push or an outbound transfer endpoint. Therefore W3M does not assume that `change_contact` is a legal ownership transfer and does not call either `change_contact` or `transfer`.

NiceNIC states that API v2 access is available to all NiceNIC users without requiring reseller status or an API setup/annual fee. Paid domain services remain subject to the account's applicable pricing.

## Implementation

- Adapter: `supabase/functions/w3m-acquisition-verification/nicenic-domain-adapter.ts`
- Tests: `supabase/functions/w3m-acquisition-verification/nicenic-domain-adapter.test.ts`

Read-only operations:
1. Authenticate with the account username and API secret in the Authorization header.
2. Read the domain's details.
3. Read the authenticated account's paginated domain inventory.
4. Verify the exact deal-pinned domain appears in the exact expected NiceNIC account.
5. Check active status and absence of registrar hold.
6. Require a separate trusted registrant identity verification record before emitting seller-control evidence.

The adapter does not store registrant names, email addresses, phone numbers, or postal addresses in the W3M evidence event. It stores only a reference to the trusted identity-verification record.

## Transfer evidence

A NiceNIC account-level `TRANSFER_CONFIRMED` event is emitted only when:
- The seller account's complete domain listing no longer contains the domain.
- The buyer account's fresh domain snapshot contains the same exact deal-pinned domain.
- The domain is active and not on hold in the buyer account.
- The buyer registrant identity has been matched by a separate trusted verifier.
- Both snapshots use the exact same observation timestamp.

A separate buyer-control event is then available from a fresh buyer-account read.

This proves account-level control transition under the configured evidence rules. It must not be described as legal registrant ownership transfer unless the registrar's actual registrant-change process and confirmation have also been independently established. A pending API order or contact update is not final transfer proof.

## Security and operational limits

- API credentials are server-side only; never accept them in browser fields, URLs, logs, or client bundles.
- The API hostname is fixed to `api.nicenic.net`; callers cannot supply an arbitrary URL.
- Only GET read operations are implemented.
- Account inventory pagination is bounded. If the listing is incomplete, absence from the account cannot be used as proof.
- No automatic transfer executor exists because the currently documented API surface does not establish a safe account-to-account transfer operation.
- Cloudflare DNS control is not treated as registrar ownership evidence.

## Next provider requirement

Before enabling automatic domain transfer for NiceNIC, obtain written/provider documentation or an official API endpoint for account-to-account domain push / registrant ownership transfer, including asynchronous completion status and a buyer-side confirmation read. Until then, domain transfer requires the registrar's supported manual process, and W3M must wait for independent post-transfer evidence.
