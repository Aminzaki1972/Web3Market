# W3M AI Assistant — Foundation Plan

## Goal
Build an official Web3Market assistant for marketplace participants. The first release is bilingual (Arabic and English), text-first, with optional browser-native speech input/output. It must answer only from approved Web3Market information and clearly admit when it does not know.

## Repository and production inventory (checked 2026-11-04)
- Static HTML/JavaScript site; production repository default branch is `main`.
- Existing global language system: `js/global-language.js` supports Arabic and English (plus other languages).
- Existing profile preference: `profiles.preferred_language` supports `ar` and `en` among other locales.
- Existing Deal Room translation: `js/deal-translation.js` and deployed `translate-deal-message` Edge Function. This translates deal messages; it is not an AI assistant.
- Existing AI integrations: Gemini is used by `w3m-code-audit` and `w3m-audit-autofix-pr`; OpenAI is used by `ai-review-project`. Reuse patterns, not their privileged business logic.
- Existing Supabase project is active and has Edge Functions.
- Existing `vector` extension is available in the database catalogue but is not installed (no installed version observed). Do not enable it just for v1.
- Existing human support chat is implemented with `support_conversations`, `support_messages`, and a separate admin inbox. Keep it untouched and separate from AI conversations.
- No dedicated AI assistant conversation/history/knowledge tables were found in the public schema.
- No dedicated voice transcription or synthesis integration was found in repository searches.

## V1 scope
1. Authenticated participant assistant, not a replacement for human support.
2. Arabic and English replies; choose language from the current message, with optional explicit UI override.
3. Web3Market-only FAQ/knowledge context, maintained as reviewed source files.
4. Text chat using the existing server-side `GEMINI_API_KEY` secret. Never expose secrets to browser code.
5. Optional browser-native speech recognition and speech synthesis where supported by the user's browser/device. Voice is progressive enhancement, not a guaranteed capability on every device.
6. Short-lived conversation context in the browser only for the prototype. No persistent transcript storage in v1.
7. No account-specific data, deal status, balances, private project records, or admin actions in v1.

## Free-first cost controls
- Reuse the existing Gemini secret only if the project owner confirms it is configured and its current provider quota/billing settings are acceptable. Code must fail closed when absent.
- Use a low-cost/available Flash model, a short input/output budget, strict request length, and bounded history.
- The existence of an API key does not prove free-tier eligibility or unlimited usage. Verify provider quotas before enabling public traffic.
- Browser-native voice avoids adding a paid speech API, but browser support and speech service behavior vary by device.

## Security boundaries
- Edge Function must require a valid Supabase JWT (`verify_jwt = true`).
- No service-role key in browser code.
- No database access to private user/deal records in v1.
- Allowlist Web3Market origins; validate request method, content type, message size, and history shape.
- Apply best-effort per-user throttling in the function and add durable DB-backed rate limiting before broad production rollout.
- Treat user content as untrusted; do not follow instructions embedded in user messages that conflict with assistant policy.
- Do not claim legal, financial, investment, or security guarantees. Direct high-risk account/transaction matters to human support.

## Phases
- Phase 0 (this branch): inventory, approved knowledge draft, isolated preview UI, authenticated Edge Function scaffold.
- Phase 1: test with an isolated Supabase project or local/staging deployment; verify JWT, bilingual behavior, rate limits, error handling, and model quota.
- Phase 2: add durable conversation storage only after retention/privacy requirements are agreed; use dedicated tables and RLS, never reuse human support tables.
- Phase 3: add the widget to selected pages behind a feature flag; do not merge to production until approved.
- Phase 4: broaden page coverage and add account-aware tools only after separate authorization design and security tests.

## Acceptance checklist
- Arabic and English questions receive matching-language answers.
- Answers are grounded in the reviewed knowledge file; unknown details are referred to support.
- Anonymous requests are rejected by the Edge Function.
- Oversized prompts and excessive requests are rejected.
- No secrets or private account/deal data are returned.
- Browser voice controls appear only when the relevant API exists and degrade gracefully.
- Existing support chat, translation, marketplace, and audit workflows remain unchanged.

## Current branch implementation note (2026-11-04)
- A draft conversation/message migration is present at `supabase/migrations/202611040001_w3m_ai_assistant.sql`, but it is **not applied** to any Supabase project and is not needed for the text-first prototype.
- Keep persistent transcript storage deferred to Phase 2 until retention, deletion, and privacy requirements are agreed. Do not run this migration in production.
- The Edge Function source validates JSON content type, requires gateway JWT verification through the explicit `verify_jwt = true` setting, and uses bounded request/history sizes. Its in-memory throttle is best-effort only and is not a durable abuse-control mechanism.
- The assistant function is not deployed to the production Supabase project. No production secret or paid provider has been configured as part of this branch work.
