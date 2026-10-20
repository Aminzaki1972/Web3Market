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

## Current status (updated 2026-10-20)

- [x] GitHub Actions private support chat static checks passed (run #22): https://github.com/Aminzaki1972/Web3Market/actions/runs/39493854334
- [x] GitHub Actions isolated PostgreSQL behavioral smoke test passed (run #12): https://github.com/Aminzaki1972/Web3Market/actions/runs/39493854520
- [x] AI review fallback static checks passed (run #66): https://github.com/Aminzaki1972/Web3Market/actions/runs/39493854304
- [x] Main support-chat migration applied and tested on a separate staging Supabase project; not production.
- [x] Staging SQL tests verified buyer/seller row isolation, sender identity checks, closed-thread restrictions, status-only updates, administrator AAL2 access, attachment-folder isolation, private bucket configuration, and anonymous SQL privilege revocation.
- [x] Support attachment bucket verified private with a 20 MiB limit and an image/video MIME allowlist.
- [x] Hardened the admin role helper: `public.is_admin()` is now `SECURITY INVOKER`; the `SECURITY DEFINER` lookup lives in the non-exposed `private` schema. Staging advisor no longer reports `authenticated_security_definer_function_executable`.
- [x] Follow-up least-privilege grant migration added and applied to staging after discovering inherited table-level DELETE/TRUNCATE/UPDATE grants. `authenticated` now has SELECT/INSERT on both support tables and UPDATE only on `support_conversations.status`; no anonymous table grants remain.
- [ ] Enable Supabase Auth leaked-password protection in the staging project through the Auth settings UI; this is a project Auth setting and was not changed by SQL.
- [ ] Test with real signed-in buyer and seller accounts and an AAL2 administrator in a browser.
- [ ] Test mobile image/video upload and playback, signed URL expiry, and the conversation-switch/refresh race cases.
- [ ] Recheck listing submission/approval and Deal Room/settlement flows for regressions.
- [x] Added follow-up migration `supabase/migrations/20261020_support_admin_helper_private_schema.sql`; feature branch commit: `8e6f295c7b49c55e037bbd9cdcf08767dc106472`.
- [ ] Confirm the latest CI smoke test succeeds after the least-privilege grant migration.
- [ ] Production migration has not been applied; the live website and production database remain untouched.
- [ ] Do not merge/deploy until the owner reviews the results and explicitly approves.
