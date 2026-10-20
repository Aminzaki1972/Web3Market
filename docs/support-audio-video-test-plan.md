# Web3Market private support voice/video calls — test plan

## Scope
- Browser-to-browser WebRTC audio/video for the existing private support conversation.
- Supabase Realtime private channel carries call setup/signaling only; audio/video is intended to travel peer-to-peer.
- No recording and no new paid vendor are introduced by this branch.
- No production database changes are included in this PR. The SQL file is a draft policy migration and must be reviewed and applied separately after approval.

## Required manual tests before merge
1. Use a buyer/seller test account and the authorized administrator account with AAL2/MFA completed.
2. Open the same support conversation in two separate browsers/devices over HTTPS.
3. Confirm an audio call can be started, accepted, muted, and ended by either side.
4. Confirm a video call can be started, accepted, camera toggled, and ended.
5. Confirm a different signed-in buyer/seller cannot join another account's call channel.
6. Confirm an admin without AAL2 cannot subscribe to or publish on the call channel.
7. Confirm calls are unavailable when the conversation is closed and when the selected admin conversation changes.
8. Deny microphone/camera permissions and confirm a readable error appears without breaking ordinary support messages or attachments.
9. Test tablet/mobile browser permission prompts and both Wi-Fi/mobile data if available.
10. Re-test existing support text messages and photo/video attachments.

## Known free-tier limitation
The current prototype uses a public STUN endpoint and does not include a TURN relay. Some NATs, mobile networks, or restrictive firewalls may prevent media connection. Do not advertise guaranteed universal connectivity until tested; adding reliable TURN may require a separate provider/cost.

## Security review before production
- Review `supabase/migrations/20261021000000_support_call_realtime_policies.sql` against the actual production RLS rules for `support_conversations` and `profiles`.
- Verify the project supports private Realtime channels and the current AAL claim is present after admin MFA.
- Supabase documentation notes that private-channel enforcement depends on the Realtime “Allow public access” setting. Do not change that project-wide setting without first checking every existing Realtime feature, because it may affect other channels.
- Confirm the deployed `support_conversations` schema and existing RLS policies before relying on the draft policy. The draft references `profiles.role` and `support_conversations.user_id` and may need adapting to the actual production policies.
- Apply no migration or project-wide Realtime setting change to production until explicitly approved.
