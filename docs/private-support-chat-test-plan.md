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
- [ ] Admin C can close an open conversation; the dashboard account can no longer send messages in that thread.
- [ ] Admin C can reopen a closed conversation; the dashboard account can send messages again.
- [ ] A non-admin or an admin without AAL2 cannot close or reopen a conversation through the client/API.
- [ ] A buyer/seller cannot change `status`, `user_id`, `user_email`, or `user_display_name` through direct REST/API requests; only an AAL2 admin may change status.
- [ ] A buyer/seller cannot insert a conversation with `status = 'closed'` or create a conversation for another user.
- [ ] Rapidly switch between two admin conversations while message queries are delayed; messages and sender labels must never appear under the wrong conversation.
- [ ] Switch conversations while a signed attachment URL is loading; stale attachment results must not append into the newly selected thread.
- [ ] Switch conversations while a close/reopen request is pending; its response must not switch the selected thread or alter its controls.
- [ ] During periodic refresh, switch the selected conversation; the old refresh response must be ignored.
- [ ] Confirm a closed conversation rejects both message inserts and attachment uploads through direct API requests, not only disabled UI controls.
- [ ] Confirm the user can read only their own attachments after reopening; attachment authorization must still require participant ownership or admin AAL2.
- [ ] If the status changes in another session, the admin composer refreshes to the correct enabled/disabled state.
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
- [ ] Confirm the close/reopen controls match the database RLS policy and reject status changes for unauthorized sessions.
- [ ] Record the tested migration commit SHA and test outcomes before review.
- [ ] Confirm production database and live website were not modified.

## Current status
- [x] GitHub Actions static security checks passed (run #3): https://github.com/Aminzaki1972/Web3Market/actions/runs/39488713049
- [x] JavaScript syntax check passed for `js/support-chat.js`.
- [x] Static assertions passed for critical source safeguards (AAL2 admin check, private bucket, signed URLs, update-grant restriction, closed-thread upload restriction, and stale-render protection).
- [ ] Isolated Supabase functional/RLS tests are still outstanding.
- [ ] Real buyer, seller, and AAL2 admin account tests are still outstanding.
- [ ] Mobile image/video upload and playback tests are still outstanding.
- [ ] Production migration has not been applied; the live website and production database remain untouched.
- [ ] Do not merge/deploy until the owner reviews the results and explicitly approves.
