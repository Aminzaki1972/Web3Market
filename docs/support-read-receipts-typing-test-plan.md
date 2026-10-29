# Private support chat enhancements — test branch

Branch: `test/support-read-receipts-typing`

## Current change
- Voice/video buttons remain visible, but starting or accepting a call is disabled with a clear “coming soon” message.
- No production deployment, production database change, or secret change is included.

## Read receipts (implemented on test branch; database behavior still unverified)
- Use a dedicated `support_message_reads` table, not client-controlled fields on `support_messages`.
- Store the authenticated reader and message ID with a unique constraint; a read is recorded only when the conversation is actually opened/rendered.
- RLS must restrict reads to the conversation participant or an AAL2 administrator, and inserts to the authenticated recipient only. A sender should only see receipts for their own messages.
- Use a red dot for sent-but-unread and a green dot for read, shown only on messages sent by the current viewer. Do not treat delivery/polling as a read.

## Typing indicator (implemented on test branch; Realtime authorization still unverified)
- Use Supabase Realtime on a private per-conversation topic; never insert fake messages into the message table.
- Realtime authorization must verify the user is the conversation owner, an authorized AAL2 administrator, or an explicitly assigned support agent with existing limited access.
- Send only a minimal typing event; clear it after a short timeout and when the input is cleared or the page is left.

## Current validation and test checklist before any production approval
- JavaScript syntax check passed for `js/support-chat.js` and `js/support-calls.js`.
- No Supabase migration has been applied and no browser/database integration test has been completed.
- Draft PR #124 is open for review only; it is not merged.
- User sends a message; administrator reads it; red dot changes to green only after the read event.
- Administrator replies; user reads it; same state transition works in reverse.
- Typing appears only to the other authorized participant and disappears after timeout.
- Unrelated users cannot subscribe to a conversation's typing topic or read receipts.
- Assigned support agents remain limited to permitted conversation reading/replies and cannot change conversation status.
- Voice/video buttons remain visible but neither outgoing nor incoming calls can start.
- Test both support pages on mobile and desktop; check console/network errors and existing attachment behavior.

## Safety gate
The SQL and frontend implementation for receipts/typing must be reviewed against the live schema and existing RLS before merging. This branch is isolated from production; do not apply migrations to the production Supabase project or merge/deploy without explicit approval.
