# Private Admin Support Chat — Pre-Release Test Plan

This checklist is for an isolated test project only. Do not apply the migration to the production Supabase project and do not merge/deploy until the tests pass and the owner approves.

## Test accounts
- Buyer A: authenticated profile role `buyer`
- Seller B: authenticated profile role `seller`
- Admin C: profile role `admin`, enrolled in MFA
- Optional Admin D: profile role `admin` without an active AAL2 session

Use non-sensitive test messages and sample media only.

## Access isolation
- [ ] Buyer A can open their own support page and send a text message.
- [ ] Seller B can open their own support page and send a text message.
- [ ] Buyer A cannot select Seller B's conversation or messages through the client/API.
- [ ] Seller B cannot select Buyer A's conversation or messages through the client/API.
- [ ] Buyer A and Seller B cannot create messages using the other account's conversation ID.
- [ ] Buyer A and Seller B cannot list/read objects in the other account's attachment folder.
- [ ] Unauthenticated requests cannot read or write conversations, messages, or private attachments.
- [ ] An authenticated account with a role other than buyer/seller/admin cannot open a support conversation.

## Administrator authorization
- [ ] Admin C can list conversations and read messages with an AAL2 session.
- [ ] Admin C can reply to Buyer A and Seller B separately.
- [ ] Admin C can read permitted attachments and upload a reply attachment to the correct conversation path.
- [ ] Admin D without AAL2 cannot list conversations, read messages, or read/upload support attachments.
- [ ] A non-admin account cannot access the administrator inbox even if it manually opens the URL.

## Media handling
- [ ] Supported image types render correctly.
- [ ] Supported video types play correctly on desktop and mobile.
- [ ] Files larger than 20 MiB are rejected by the bucket.
- [ ] Unsupported MIME types are rejected.
- [ ] Signed attachment links expire as configured and a fresh link can be generated after authorization.
- [ ] A failed message insert after upload is recorded as an orphan-file cleanup issue; do not add broad delete access just to clean it up.

## Regression and operations
- [ ] Existing marketplace listing submission and approval flows remain unchanged.
- [ ] Existing Deal Room messages and settlement flow remain unchanged.
- [ ] Private support bucket remains non-public.
- [ ] Verify all SQL migration statements run successfully in the isolated project.
- [ ] Record the tested migration commit SHA and test outcomes before review.
- [ ] Confirm production database and live website were not modified.

## Current status
Static source review only. No isolated Supabase functional tests have been run, and the migration has not been applied to production.
