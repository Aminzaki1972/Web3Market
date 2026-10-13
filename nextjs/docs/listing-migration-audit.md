# Listing flow migration audit (read-only inspection)

Date: 2026-10-13
Source inspected: `main` branch files `sell-project.html`, `js/sell-project.js`, and `js/supabase.js`.
This document is on the isolated `nextjs-migration` branch. It does not change the current production listing flow.

## Current behavior to preserve

1. The seller form contains identity, social/community, project type/technology, industry, audience/market, financials, traction, assets, sale terms, verification/ownership, and media sections.
2. The form autosaves a local snapshot and attempts to save a `draft` row in Supabase for the signed-in owner.
3. A draft with a stored project ID is checked for owner and status before it is updated. Non-draft/submitted listings are protected from being silently demoted by draft autosave.
4. AI review is a separate explicit action. The browser calls the `ai-review-project` Supabase Edge Function with the project ID and a limited evidence patch.
5. Logo, cover, video, and screenshots are uploaded to the existing `project-media` Storage bucket under a user-scoped path. The current implementation obtains public URLs for uploaded media.
6. Website and GitHub repository values are deliberately stored in separate fields. The website is validated as HTTPS and not a GitHub URL; the repository is validated as a GitHub owner/repository URL.

## Migration requirements

- Keep short description and full description separate. Short description: concise listing card/pitch; full description: detailed product, features, status, technology, and business model. Do not auto-copy one into the other in the new UI.
- Keep `project_url` / `website_url` (official website compatibility) separate from `github_url` (source repository).
- Keep the ability to save incomplete drafts; enforce completeness only when the seller explicitly submits for AI review.
- Preserve local recovery, ownership checks, draft-only editing protection, status checks, and duplicate avoidance. Never update or publish another user's listing.
- Preserve all existing database field names and legacy mappings until the real schema and data are reviewed. Avoid destructive schema changes.
- Media handling must preserve file type/size limits and must be checked against actual Supabase Storage policies before being implemented in Next.js. Do not assume that public media URLs are appropriate for private evidence or ownership documents.
- Keep authentication session behavior and existing accounts; use a dedicated test Supabase project for initial implementation and tests.
- Do not change production DNS, the GitHub Pages configuration, the `main` branch, or production Supabase data during this stage.

## Verification checklist for the Next.js implementation

- [ ] Anonymous user can open the form but cannot save a cloud draft or upload media.
- [ ] Signed-in user can save an incomplete draft and resume it after reload.
- [ ] The draft belongs only to the authenticated owner.
- [ ] A stale project ID does not overwrite a listing belonging to another user.
- [ ] Submitted/published listings are not silently reverted to draft.
- [ ] Short and full descriptions remain distinct after save/reload.
- [ ] Website and repository fields do not swap or overwrite each other.
- [ ] Invalid URL schemes, malformed GitHub URLs, unsupported MIME types, and oversized uploads are rejected.
- [ ] Failed uploads and failed AI review show an actionable error without losing the local draft.
- [ ] Multi-screenshot upload handles partial failure without silently losing successful file URLs.
- [ ] AI review requires the intended evidence and returns a visible status.
- [ ] Test results are recorded before any production cutover.

## Scope note

This is a source-code inspection and migration checklist, not a production security audit. Storage policies, database constraints/RLS, and Edge Function internals still need to be inspected in the test environment before claiming the migrated flow is safe.


## Read-only Supabase inspection (2026-10-13)

The production Supabase project was inspected without making any changes. `public.projects` has RLS enabled; seller/admin owner checks apply on insert, and owner updates are restricted to `status = 'draft'` (with a separate admin path). Public reads cover active/sold records except those flagged `verification.ai.test_mode = true`. The `status` column defaults to `active`, so a future draft creation path must explicitly set `draft` and must never rely on that default.

The `project-media` bucket is public with a 50 MiB bucket-level cap and accepted image/video MIME types. Upload insertion requires the first folder segment to equal the authenticated user's ID. Because the bucket is public, it must not be used for private identity or ownership evidence. Upload code should use unique user-scoped object paths and avoid upsert unless the necessary SELECT/UPDATE permissions are explicitly verified.

No separate development branch was present during this inspection. Therefore no database write, upload, or end-to-end submission test was attempted. The Next.js form remains a browser-local preview.
