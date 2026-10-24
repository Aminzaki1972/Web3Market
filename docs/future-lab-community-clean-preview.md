# Future Lab Community — clean preview branch

## Status
Front-end-only prototype at `future-lab-community-preview.html`. This branch is based directly on `cloudflare-test` and is intentionally separate from the existing broad feature branch.

## Included interactions
- Search and category filters.
- Responsive article cards and article-reading panel.
- Demo article form with required-field validation.
- Demo draft / pending-review states held only in current page memory.
- Sample likes are temporary and do not persist.
- A visible notice says no production database or account system is connected.

## Not implemented yet
- Real authentication or member profiles.
- Persistent article records, comments, likes or categories.
- Server-enforced moderation and administrator review.
- Image upload/storage.
- Hosted Cloudflare preview URL (must be confirmed from deployment configuration).

## Isolation and next steps
1. Do not modify `future-lab.html`, existing article files, production Supabase project `hzhqlexnhtukfljcvnyd`, or production deployment settings.
2. The existing `web3market-support-test` project is used for support testing; do not reuse it for Future Lab without a separate explicit isolation decision.
3. No dedicated Future Lab test project was found in the currently listed Supabase projects. Do not create a new project or branch until cost is checked and any nonzero charge is approved.
4. Inspect existing profile and administrator role schema before authoring RLS policies. Do not assume role table names.
5. Build database changes in a dedicated test project, run security/performance advisors, and verify that only published articles are public.
6. Test ownership spoofing, status tampering, author self-approval, duplicate likes, unauthorized comment access and XSS payloads.
7. Confirm Cloudflare Pages preview behavior and URL before presenting it as a live preview.
8. Run regression checks for marketplace, AI Code Audit, AI Passport, Deal Room and support.
9. Show the working preview and test report to the owner. Do not merge or deploy until explicitly approved.
