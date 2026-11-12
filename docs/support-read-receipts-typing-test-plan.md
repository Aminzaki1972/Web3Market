# Private support chat enhancements — test branch

Branch: `test/support-read-receipts-typing`
Draft PR: https://github.com/Aminzaki1972/Web3Market/pull/124

## Implemented on the test branch
- Voice/video buttons remain visible, but outgoing and incoming call signaling is disabled with a clear “coming soon” message.
- Read receipts use a dedicated `support_message_reads` table rather than client-controlled fields on `support_messages`.
- The sender sees a red dot for unread and a green dot after the other authorized participant records a read.
- Typing uses private Supabase Realtime broadcasts on a per-conversation topic; it does not create fake chat messages.
- Typing indicators time out after a short interval.
- Assigned support agents can read/reply at AAL1, but cannot change conversation status; administrator access remains AAL2-gated.

## Validation completed
- GitHub Actions static/security checks passed on the current head commit: JavaScript syntax and critical support-chat safeguards.
- GitHub Actions disposable PostgreSQL migration-smoke test passed on the current head commit. It applies the support chat migrations and checks schema/RLS, participant isolation, admin AAL2 behavior, read-receipt isolation, typing-topic authorization, attachment isolation, closed-thread behavior, and sender spoofing safeguards.
- The new migration was applied only to the isolated Supabase test project `web3market-support-test` (`vdceprygdzgluejdvdoa`). It has not been applied to production.

## Still required before any production approval
- Run end-to-end browser tests with separate customer and administrator sessions.
- Verify in both directions: a sent message starts red, changes green only after the recipient opens the conversation, and the typing indicator appears only to the other authorized participant.
- Verify typing disappears after timeout and when the input is cleared or the page is left.
- Test assigned support-agent access with a dedicated AAL1 agent account; do not repurpose an existing real account without explicit approval.
- Test mobile and desktop, console/network errors, and existing attachment behavior.
- Review the test project's security/performance advisories separately; they are not evidence that this feature is production-ready.

## Safety gate
This branch is isolated and the PR remains a draft. Passing static and disposable PostgreSQL tests is not a substitute for hosted browser integration testing. Do not merge, deploy, or apply migrations to the production Supabase project without Amin's explicit approval.
