# Buyer Due Diligence — No-Cost Validation Plan

**Branch:** `prototype/w3m-buyer-due-diligence`  
**Status:** planning only. No database, billing, deployment, or production changes.

## Non-negotiable cost rule

- Use only tools and services already available at no additional cost.
- Do not create, restore, upgrade, or activate a cloud project if that may incur charges or consume a paid resource.
- Do not enable a trial, paid API, paid model, paid database, or paid monitoring service.
- If a step has uncertain pricing or could create usage charges, stop and ask the platform owner first.
- No paid fallback is permitted without a separate explicit decision.

## Existing environments reviewed

- `web3market` is the live production Supabase project. It is not a test environment.
- `web3market-support-test` is reserved for support-system testing and must not be repurposed.
- `Web3Market Showcase Passport` is currently inactive and could not be inspected because its database was not accessible. Do not restore or reactivate it as part of this plan.
- No confirmed, active, isolated, no-cost Supabase environment is currently available.

## Safe validation sequence

### Stage A — Static UI review (no backend)

1. Review `buyer-dashboard-preview.html` and `buyer-due-diligence-demo.html` on desktop and mobile widths.
2. Confirm the preview clearly labels all sample content as fictional and non-live.
3. Confirm the report page does not expose real buyer, seller, listing, audit, or account data.
4. Check keyboard navigation, readable contrast, responsive layout, and clear empty/unknown states.
5. Keep preview pages out of production navigation and do not connect them to production APIs.

### Stage B — Authorization design review (no database execution)

Review the planned access model against these cases:

| Scenario | Required result |
|---|---|
| Buyer A reads Buyer A report | Allow |
| Buyer B guesses Buyer A report ID | Deny |
| Seller reads a buyer's private report | Deny |
| Anonymous visitor opens a report | Deny |
| Buyer changes `buyer_id` in a request | Reject |
| Buyer changes report ownership on update | Reject |
| Buyer requests an inaccessible listing | Deny |
| Buyer reads evidence from another buyer's report | Deny |
| Buyer exports another buyer's report | Deny |

This is a design review only; passing the table on paper is not proof that database authorization works.

### Stage C — Real RLS tests (blocked until a safe free environment exists)

Real authorization tests require an isolated database with separate test identities and test data. Do not simulate a successful Supabase RLS test using static HTML or a browser-only mock.

Before any real test:
- Confirm the environment is isolated from production and support data.
- Confirm its current plan and expected usage are free with no automatic paid upgrade.
- Obtain explicit approval to use it.
- Use synthetic accounts, listings, reports and evidence only.
- Run the full cross-account matrix and inspect database policies and grants.
- Delete test data only after preserving the test results.

If no suitable free environment is available, keep this stage blocked. Do not weaken security or use production as a substitute.

## Release gates

- [ ] Static preview reviewed on mobile and desktop.
- [ ] All sample data and limitations are clearly disclosed.
- [ ] A genuinely isolated, verified no-cost test environment is available.
- [ ] Two-account RLS tests pass in that environment.
- [ ] Database advisors and policy/grant review completed.
- [ ] Separate approval received before any production schema, function, or UI integration.

## Explicitly prohibited in this plan

No production SQL, migrations, RLS changes, Edge Function deployment, secrets changes, storage changes, billing changes, project restoration, Cloudflare deployment, merge, or public launch.
