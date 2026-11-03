# Buyer Due Diligence — Privacy and Authorization Test Matrix

Status: acceptance criteria only; not executed against production.
Branch: `prototype/w3m-buyer-due-diligence`

## Purpose

Define the minimum authorization checks for buyer-owned due-diligence reports and notes before any database or API implementation. These tests must run only in a verified, isolated, no-cost test environment using synthetic accounts and listings.

## Test identities and fixtures

Create synthetic identities in the isolated environment:

- **Buyer A** — requests and owns report A for a listing that Buyer A may view.
- **Buyer B** — a different buyer; must not read or modify Buyer A's private report or notes.
- **Seller S** — owns the listing and may see their own listing data, but not a buyer's private due-diligence report or notes.
- **Anonymous** — has no authenticated session.
- **Admin** — privileged operational account; administrative access must be explicit and audited, not inherited by ordinary users.
- **Listing L1** — visible, eligible synthetic listing.
- **Listing L2** — private, hidden, or otherwise ineligible synthetic listing.
- **Audit X** — synthetic seller-owned Code Audit result; its raw rows and child records are not buyer-readable.

Use no real customer records, production identifiers, secrets, or real private repositories.

## Authorization matrix

| Resource / action | Buyer A (owner) | Buyer B (other buyer) | Seller S | Anonymous | Admin |
| --- | --- | --- | --- | --- | --- |
| Create a report for an eligible visible listing | Allow, subject to server validation | Allow for their own request | Deny as a buyer report unless also independently authorized as a buyer | Deny | Allow only if a documented admin workflow requires it |
| Read Buyer A's private report | Allow | Deny without revealing whether a report exists | Deny | Deny | Explicit admin-only access if required; log access |
| Update Buyer A's private notes | Allow only on own report | Deny | Deny | Deny | No routine editing; any exceptional access must be audited |
| Read Buyer A's private notes | Allow | Deny | Deny | Deny | Explicit admin-only access if required; log access |
| Read raw Code Audit rows/files/findings owned by Seller S | Deny unless separately authorized by existing audit ownership | Deny | Allow under existing audit permissions | Deny | Allow under existing admin policy |
| Read an approved minimal buyer-safe audit snapshot | Allow only when server confirms listing eligibility and disclosure authorization | Same rule for their own request | Raw audit permissions remain unchanged | Deny | Allow under documented policy |
| Request a report for hidden/ineligible Listing L2 | Deny; no report details returned | Deny; no report details returned | Not applicable to private buyer report | Deny | Only through a separate, documented administrative workflow |
| Export/share a buyer report publicly | Not available in this scope | Not available | Not available | Not available | Not available in this scope |

**Important:** an admin's operational privileges do not make a report public. This feature does not create a public report URL, share token, public Passport, or buyer-to-buyer visibility.

## Required test cases

### Authentication and ownership
- [ ] An unauthenticated request cannot create, read, update, or delete a report or notes.
- [ ] Buyer A can read and update only report A and its notes.
- [ ] Buyer B cannot access report A by guessing its ID, changing a URL, changing a request body, or calling an API directly.
- [ ] Buyer B cannot modify Buyer A's notes by substituting Buyer A's report ID.
- [ ] Seller S cannot read buyer reports or notes through the dashboard, direct API, or database query.
- [ ] A report ID is not treated as authorization; ownership is checked server-side on every operation.
- [ ] Any admin access is deliberate, least-privilege, and logged according to the approved admin policy.

### Listing eligibility and data minimization
- [ ] The server independently verifies that the listing is visible and eligible at report creation and read time.
- [ ] Hidden, removed, test-only, or otherwise ineligible listings do not expose private details through errors or partial responses.
- [ ] Client-submitted seller IDs, audit IDs, owner IDs, scores, or authorization flags are never trusted as proof of permission.
- [ ] Report output contains only the fields needed for the buyer-facing summary; no raw seller audit tables or private source files are returned.
- [ ] Authorization failures do not reveal whether a private report, hidden listing, or seller audit exists.

### Code Audit disclosure
- [ ] Buyer access to a listing does not grant direct SELECT access to seller-owned `code_audits`, `code_audit_files`, or `code_audit_findings`.
- [ ] The server resolves the audit-to-listing relationship from trusted database state.
- [ ] Only an explicitly reviewed minimal snapshot is disclosed; the source audit ID and commit SHA remain internal provenance unless separately approved.
- [ ] Snapshot scope, coverage, timestamp, and limitations are visible in the report.
- [ ] Missing, stale, incomplete, or unauthorized audit data is labelled accurately; missing data is never presented as a clean audit.
- [ ] No audit is silently rerun and no new score or certification is implied.
- [ ] The feature does not create or issue an AI Passport.

### Notes, lifecycle, and error handling
- [ ] Notes are persisted only after authenticated server-side ownership checks are implemented and tested.
- [ ] Notes are never placed in public listing metadata, seller-visible deal records, logs, analytics events, or shared URLs.
- [ ] Deleting or changing a listing cannot transfer report ownership to another user.
- [ ] Concurrent updates do not allow one buyer to overwrite another buyer's notes.
- [ ] Rate limits and validation prevent oversized or malformed notes.
- [ ] UI messages remain generic on authorization failures and do not expose internal IDs or stack traces.

## Acceptance gate

Do not implement database writes, RLS changes, Edge Functions, or UI/API wiring until all are true:

1. A separate, active, isolated, no-cost Supabase test project is verified.
2. Synthetic test accounts and fixtures are created only in that project.
3. All applicable tests above pass, including direct API/database access tests.
4. RLS, grants, server-side authorization, and admin access are independently reviewed.
5. The platform owner explicitly approves the proposed test changes before they are applied.

## Current result

This document defines expected behavior only. Tests have **not** been executed. No production database, RLS policy, grant, Edge Function, secret, Cloudflare setting, or live site was changed. The static demo's notes field remains disabled and does not save data.
