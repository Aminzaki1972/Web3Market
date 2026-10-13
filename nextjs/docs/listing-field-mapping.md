# Next.js listing field mapping (no database writes)

This document maps the isolated form to the existing legacy listing contract inspected in `js/sell-project.js`. It is a migration guide, not proof that the live database schema accepts every column. Confirm the actual table columns, constraints, RLS policies, and Storage policies in a dedicated test Supabase project before enabling writes.

## Identity and references

| Next.js form field | Legacy project column(s) | Notes |
| --- | --- | --- |
| `projectName` | `title` | Trim whitespace; required at explicit validation. |
| `shortDescription` | `short_description` | Keep distinct from full description. |
| `fullDescription` | `description`, `full_description` | Both legacy fields may need the same full text for compatibility; never replace the short text. |
| `projectUrl` | `project_url`, `website_url` | Official HTTPS site only; do not put GitHub here. |
| `githubUrl` | `github_url` | HTTPS `github.com/owner/repository` only. |
| `category` | `category`, possibly `primary_type` | Verify accepted category values before write. |
| `projectStage` | `development_stage`, `project_status` | Preserve the legacy distinction if both are used. |
| `blockchain` | `blockchain` | Text. |
| `businessModel` | `business_model` | Text. |
| `techStack` | `tech_stack`, `technology_stack` | Keep compatible with both legacy names until schema is verified. |
| `yearCreated` | `year_created` | Convert a non-empty value to an integer; reject invalid years. |

## Market, public links, and sale terms

| Next.js form field | Legacy project column(s) | Notes |
| --- | --- | --- |
| `targetAudience` | `audience`, `target_audience` | The legacy form stores audience selections as an array; define an explicit string-to-array conversion or change UI to multi-select before writing. |
| `marketOpportunity` | `market_opportunity` | Text. |
| `competitiveAdvantage` | `competitive_advantage` | Text. |
| `competitors` | `competitors` | Decide and test a stable text/list representation. |
| `demoUrl` | `demo_url` | Optional HTTPS URL. |
| `documentationUrl` | `documentation_url` | Optional HTTPS URL. |
| `twitterUrl` | `twitter_url`, `x_url`, `social_accounts` | Preserve X/Twitter legacy aliases. |
| `telegramUrl` | `telegram_url`, `social_accounts` | Preserve nested social-account compatibility if required. |
| `discordUrl` | `discord_url`, `social_accounts` | Same. |
| `linkedinUrl` | `linkedin_url`, `social_accounts` | Same. |
| `saleType` | `sale_type` | Validate against allowed database values. |
| `reasonForSale` | `reason_for_sale`, `sale_reason` | Legacy aliases exist; verify consumers. |
| `transferPeriod` | `transfer_period` | Text until a canonical duration schema exists. |
| `transferTerms` | `transfer_terms` | Required only at explicit submit/review, not for incomplete drafts. |
| `ownershipDeclaration` | `ownership_declaration` | A user attestation, not independent ownership verification. |

## Financial and traction fields

| Next.js form field | Legacy project column(s) | Notes |
| --- | --- | --- |
| `askingPrice` | `asking_price`, `price` | Normalize to a finite non-negative number and preserve both legacy fields. |
| `currency` | `currency`, `currency_code` | Confirm canonical currency column and allowed values. |
| `negotiable` | `negotiable` | Boolean. |
| `monthlyRevenue` | `monthly_revenue`, `financials.monthly_revenue` | Numeric; do not label unverified input as verified revenue. |
| `yearlyRevenue` | `yearly_revenue`, `financials.yearly_revenue` | Numeric. |
| `monthlyProfit` | `monthly_profit`, `monthly_net_profit`, `financials.monthly_net_profit` | Confirm whether the input means gross or net profit; UI currently says monthly profit. |
| `monthlyExpenses` | `monthly_expenses`, `financials.monthly_expenses` | Numeric. |
| `users` | `users_count`, `performance.users_count` | Numeric. |
| `activeUsers` | `active_users`, `performance.active_users` | Numeric. |
| `customers` | `customers_count`, `performance.customers_count` | Numeric. |
| `monthlyVisits` | `monthly_visits`, `performance.monthly_visits` | Numeric. |
| `revenueSources` | `revenue_sources`, `financials.revenue_sources` | Text unless the verified schema defines an array. |
| `financialNotes` | `financial_notes`, `financials.financial_notes` | Text. |

## Media controls currently have no persistence mapping

Logo, cover, video, and screenshot controls currently retain selected **file names in component state only**. They do not upload bytes and must not be represented as uploaded assets. Before implementing uploads, inspect the real bucket policies and establish MIME/size limits, user-scoped object paths, cleanup behavior, and whether each asset is public or private. Ownership documents or private evidence must not be put into a public bucket by default.

## Required safety rules before cloud integration

1. Use a dedicated test Supabase project and test accounts. Do not use production credentials in the preview.
2. Save only to the authenticated user's own `projects` row; never trust a client-supplied owner ID.
3. On resume/update, verify row ID + authenticated owner + draft status. Do not downgrade submitted, approved, or published listings during autosave.
4. Preserve incomplete draft saving; enforce required fields only on the explicit review/submit action.
5. Keep website and repository separate; do not treat a repository URL or checkbox as proof of domain ownership.
6. Inspect database constraints, RLS, Storage policies, and the `ai-review-project` Edge Function before enabling any call.
7. Test create, resume, update, reload, duplicate prevention, cross-user access denial, media failures, and AI-review failures before considering a production cutover.


## Legacy fields confirmed in the existing HTML: coverage gaps and partial mappings

Inspection of `sell-project.html` on `main` confirms these additional form fields exist in the legacy interface. This list is based on HTML form names, not a direct database-schema query.

| Legacy form field | Current preview coverage | Migration note |
| --- | --- | --- |
| `app_store_url` | Present (`appStoreUrl`) | Optional HTTPS URL; local-only, not uploaded or saved to the database. |
| `facebook_url`, `instagram_url`, `youtube_url`, `tiktok_url`, `reddit_url`, `medium_url`, `other_social_url` | Present as separate fields | Optional HTTPS URLs; local-only. Consider a structured repeatable social-link list after legacy compatibility is verified. |
| `target_markets` | Present (`targetMarkets`) | Free text for now; keep separate from target audience. |
| `project_types`, `services` | Missing | Legacy UI uses multi-select checkbox arrays. Define a typed multi-select model before mapping to cloud fields. |
| `has_revenue`, `revenue_period` | Missing; `yearly_profit` and `growth_rate` are present | Add revenue-status and reporting-period controls with clear definitions; keep reported metrics distinct from verified metrics. |
| `total_sales`, `monthly_volume`, `conversion_rate`, `last_active_date`, `traffic_sources` | Present as separate fields | Traction metrics are local-only; do not infer them from users or visits. |
| `assets`, `asset_notes` | Partial (`assetNotes`) | Free-text included/excluded assets exists; legacy structured asset checkbox selections are not yet represented. |
| `domain_verification`, `github_ownership`, `business_verification`, `identity_verification` | Missing | These are verification-related inputs. Do not treat user-entered values as verified evidence; design a reviewed verification workflow. |
| `buyer_pitch` | Present (`buyerPitch`) | Buyer-facing pitch is local-only and distinct from the short card description. |
| `logo_url`, `cover_image_url`, `video_url`, `screenshots` | UI file selector only | Preview currently records filenames, not URLs or uploaded files. Never serialize a selected filename as an asset URL. |

The current preview also has fields that are not a one-to-one match for legacy inputs (for example, `category` versus `primary_type`, and `users` versus `users_count`). Implement a dedicated, tested mapping function only after the real database schema and accepted enum values have been inspected.


## Preview fields added after the legacy coverage review

The isolated preview now also captures the following fields locally. These remain UI-only until a verified database mapping is implemented.

| Preview field | Legacy form field | Notes |
| --- | --- | --- |
| `targetMarkets` | `target_markets` | Free text for now; consider normalized multi-select values later. |
| `buyerPitch` | `buyer_pitch` | Buyer-facing summary; distinct from the short card description. |
| `assetNotes` | `assets`, `asset_notes` | Captures included/excluded assets in text. It does not yet replace the legacy structured asset checkbox list. |
| `appStoreUrl` | `app_store_url` | Optional HTTPS URL. |
| `yearlyProfit` | `yearly_profit` | Numeric, non-negative when supplied. Confirm gross/net meaning before mapping. |
| `growthRate` | `growth_rate` | Free text to preserve period/context; validate format before backend writes. |
| `totalSales` | `total_sales` | Count; must be a whole number. |
| `monthlyVolume` | `monthly_volume` | Numeric non-negative volume; confirm currency/period semantics. |
| `conversionRate` | `conversion_rate` | Free text to preserve percentage notation; validate format before backend writes. |
| `lastActiveDate` | `last_active_date` | Date input; do not infer ongoing activity from a missing value. |
| `trafficSources` | `traffic_sources` | Free text; seller should specify measurement period and evidence. |

These fields are saved only in the browser's local draft. Adding a field to this form does not create a database column, authorize a write, or independently verify seller-provided claims.


The preview also now includes separate optional HTTPS inputs for `facebookUrl`, `instagramUrl`, `youtubeUrl`, `tiktokUrl`, `redditUrl`, `mediumUrl`, and `otherSocialUrl`, plus `appStoreUrl`. Their intended legacy counterparts are `facebook_url`, `instagram_url`, `youtube_url`, `tiktok_url`, `reddit_url`, `medium_url`, `other_social_url`, and `app_store_url`. These remain local-only until the backend mapping and schema are verified.


## Legacy field coverage added in the latest preview update

| Preview field | Intended legacy field | Notes |
|---|---|---|
| `projectTypes` | `project_types` | Checkbox choices stored as a comma-separated string in local draft only. Before backend writes, convert to the exact array/enum shape accepted by the verified schema. |
| `services` | `services` | Checkbox choices stored as a comma-separated string in local draft only; schema shape remains unverified. |
| `hasRevenue` | `has_revenue` | Explicit yes/no/not-specified selection; seller-reported only, not verified financial performance. |
| `revenuePeriod` | `revenue_period` | Monthly, quarterly, yearly, lifetime/cumulative, or not specified; confirm legacy accepted values before writing. |
| `selectedAssets` | `assets` | Structured checkbox choices stored as a comma-separated string in local draft. Do not map until the database's expected type is confirmed. `assetNotes` remains a separate explanatory text field. |

These additions improve preview coverage only. They do not change Supabase, upload files, or make seller claims verified. The test plan should cover selecting/deselecting multiple options and restoring them after a reload.


## Read-only production schema confirmation (2026-10-13)

The existing Supabase project was inspected read-only. No rows, schema, policies, or Storage settings were changed. This confirms the following actual `public.projects` columns and types:

| Field group | Confirmed database columns | Actual type / mapping requirement |
|---|---|---|
| Required identity | `owner_id`, `title`, `status` | `owner_id` is non-null UUID; `title` is non-null text; `status` is non-null text with default `active`. A future draft insert must explicitly set `status = 'draft'`; do not rely on the default, because active/sold projects are publicly selectable. |
| Descriptions and URLs | `short_description`, `full_description`, `website_url`, `project_url`, `github_url` | Text columns; keep short and full descriptions separate and map official site/repository separately. |
| Structured choices | `project_types`, `services`, `assets`, `target_audience` | `jsonb`; `project_types`, `services`, and `assets` default to JSON arrays. Before a future database write, convert the current local comma-separated selections into JSON arrays, not plain strings. `target_audience` is also JSONB, so define and validate an array mapping rather than writing its current free-text value directly. |
| Revenue and performance | `has_revenue`, `revenue_period`, `monthly_revenue`, `yearly_revenue`, `monthly_profit`, `yearly_profit`, `monthly_net_profit`, `yearly_net_profit`, `monthly_expenses`, `growth_rate`, `conversion_rate`, `total_sales`, `monthly_volume`, `active_users`, `customers_count`, `monthly_visits`, `last_active_date`, `traffic_sources` | Actual columns exist, but use the exact matching column and expected type. `conversion_rate` is text; counts include integer columns; financial amounts are numeric; `last_active_date` is date. Do not write the same field to multiple aliases without a tested compatibility reason. |
| Sale / assets | `sale_type`, `negotiable`, `transfer_terms`, `transfer_period`, `asset_notes`, `buyer_pitch`, `reason_for_sale`, `asking_price`, `currency_code` | Columns exist with their own types; `negotiable` is boolean and price is numeric. The form's `currency` field should map to `currency_code`, not assume `currency` is the listing column. |
| Social and technical | `x_url`, `twitter_url`, `telegram_url`, `discord_url`, `linkedin_url`, `facebook_url`, `instagram_url`, `youtube_url`, `tiktok_url`, `reddit_url`, `medium_url`, `other_social_url`, `app_store_url`, `technology_stack`, `tech_stack`, `development_stage`, `project_status`, `primary_type`, `blockchain` | Multiple legacy aliases exist. Choose a canonical write map and verify existing readers before writing duplicate aliases. |

### Confirmed access and upload constraints

- `public.projects` has RLS enabled. The observed insert policy requires the signed-in user to own the row and have seller/admin role. The update policy permits owners to update only rows whose status is `draft` (or an admin path). The preview must not bypass these policies or allow a client to choose another `owner_id`.
- Anonymous reads are limited by the existing policy to active/sold listings, excluding records marked `verification.ai.test_mode = true`. This makes explicitly inserting a draft essential.
- The `project-media` Storage bucket is public, accepts JPEG/PNG/WebP and MP4/WebM/MOV, and has a 50 MiB bucket limit. Its insert policy requires the first object path segment to equal the authenticated user's ID. Existing policies allow owners to update/delete owned objects; no object-upsert should be used unless SELECT/UPDATE permissions are separately verified. Use unique user-scoped paths and do not upload private identity or ownership evidence into this public bucket.
- The project has no separate development branch at the time of inspection. Only the default branch is listed. Do not run listing writes or upload tests against production. A separate isolated test environment is required before backend integration.

This section records schema/policy observations only; it does not authorize or implement writes.

## Verified schema-aware write contract (read-only inspection, 2026-10-13)

The following database types and columns were checked directly against the production schema using a read-only query. This records the integration contract only; the preview still performs no database writes.

### Canonical scalar mapping

| Form field | Canonical `public.projects` column | Conversion / guard |
| --- | --- | --- |
| `projectName` | `title` | Trim; required on create. |
| `shortDescription` | `short_description` | Preserve independently from the full description. |
| `fullDescription` | `description` and `full_description` | Write the same full text to both compatibility columns; never copy the short description into either. |
| `projectUrl` | `project_url` and `website_url` | Optional HTTPS official site; reject GitHub repository URLs here. |
| `githubUrl` | `github_url` | Separate HTTPS GitHub owner/repository URL. |
| `category` | `category` and, after consumer review, `primary_type` | Do not blindly duplicate until display/filter consumers are checked. |
| `projectStage` | `development_stage` and/or `project_status` | These columns may have different workflow meanings; do not mirror without consumer review. |
| `blockchain` | `blockchain` | Text. |
| `businessModel` | `business_model` | Text. |
| `techStack` | `tech_stack` and `technology_stack` | Both columns exist; select canonical write target only after reader compatibility review. |
| `yearCreated` | `year_created` | Integer; reject invalid/out-of-range values. |
| `targetMarkets` | `target_markets` | Text. |
| `buyerPitch` | `buyer_pitch` | Text. |
| `assetNotes` | `asset_notes` | Text notes only; selected assets belong in the JSON array below. |
| `appStoreUrl` | `app_store_url` | Optional HTTPS URL. |
| `marketOpportunity` | `market_opportunity` | Text. |
| `competitiveAdvantage` | `competitive_advantage` | Text. |
| `competitors` | `competitors` | Text; preserve as entered unless the UI is changed to structured entries. |
| `reasonForSale` | `reason_for_sale` | Use this verified column as canonical; review legacy `sale_reason` consumers before mirroring. |
| `saleType` | `sale_type` | Text; accepted values should be aligned with the existing UI before cloud writes. |
| `askingPrice` | `asking_price` and legacy `price` | Finite non-negative numeric value; do not store a formatted currency string. |
| `currency` | `currency_code` and legacy `currency` | Both exist; use a single canonical code and mirror only if required by verified readers. |
| `negotiable` | `negotiable` | Boolean. |
| `transferTerms` | `transfer_terms` | Text. |
| `transferPeriod` | `transfer_period` | Text until the product defines a normalized duration format. |
| `demoUrl` | `demo_url` | Optional HTTPS URL. |
| `documentationUrl` | `documentation_url` | Optional HTTPS URL. |
| `twitterUrl` | `x_url` and/or `twitter_url` | Both columns exist; choose canonical display field after consumer review. |
| `telegramUrl`, `discordUrl`, `linkedinUrl`, `facebookUrl`, `instagramUrl`, `youtubeUrl`, `tiktokUrl`, `redditUrl`, `mediumUrl`, `otherSocialUrl` | Corresponding `*_url` columns | Optional HTTPS URLs; do not put social links into an unverified nested object as a substitute for scalar fields. |

### Structured and financial mapping

| Form field | Database column | Required transformation |
| --- | --- | --- |
| `projectTypes` | `project_types` (JSONB) | Convert the comma-separated UI selection to a JSON string array; never send the comma-separated string itself. |
| `services` | `services` (JSONB) | Convert to a JSON string array. |
| `selectedAssets` | `assets` (JSONB) | Convert to a JSON string array. This describes selected asset categories, not uploaded files. |
| `targetAudience` | `target_audience` (JSONB) | Current UI is free text, unlike the legacy array of checkboxes. Do not write raw prose to JSONB or silently split on commas. Decide explicitly whether to change the UI to multi-select or store the full value as a single-element JSON array. |
| `hasRevenue` | `has_revenue` (text) | Store the explicit `yes`/`no` value as text; empty means unknown/not supplied, not `no`. |
| `revenuePeriod` | `revenue_period` (text) | Store only supported values (`monthly`, `quarterly`, `yearly`, `lifetime`) or null. |
| `monthlyRevenue` | `monthly_revenue` (numeric) | Finite non-negative number or null. |
| `yearlyRevenue` | `yearly_revenue` (numeric) | Finite non-negative number or null. |
| `monthlyProfit` | `monthly_profit` and possibly `monthly_net_profit` | Numeric. Do not assume gross/net equivalence; align field wording and downstream readers first. |
| `yearlyProfit` | `yearly_profit` and possibly `yearly_net_profit` | Numeric. Do not assume gross/net equivalence. |
| `monthlyExpenses` | `monthly_expenses` (numeric) | Finite non-negative number or null. |
| `growthRate` | `growth_rate` (numeric) | Parse optional percent notation to a number; preserve negative growth where allowed by validation. |
| `conversionRate` | `conversion_rate` (text) | Database type is text. Normalize to a consistent text representation (for example `"3.5"`) only after confirming expected display semantics. |
| `totalSales` | `total_sales` (numeric) | Database type is numeric, despite UI validation currently treating it as an integer count; confirm whether this means sales count or sales value before finalizing. |
| `monthlyVolume` | `monthly_volume` (numeric) | Finite non-negative number or null. |
| `users` | `users_count` (integer) | Non-negative integer or null. |
| `activeUsers` | `active_users` (integer) | Non-negative integer or null. |
| `customers` | `customers_count` (integer) | Non-negative integer or null. |
| `monthlyVisits` | `monthly_visits` (integer) | Non-negative integer or null. |
| `lastActiveDate` | `last_active_date` (date) | Valid calendar date; reject future dates. |
| `trafficSources` | `traffic_sources` (text) | Text; no invented array encoding. |
| `revenueSources` | `revenue_sources` (text) | Text. |
| `financialNotes` | `financial_notes` (text) | Text. |

### Mandatory create/update invariants

- The authenticated session must be read with `auth.getUser()`; derive `owner_id` from that returned user, never from form or local storage.
- Every new row must explicitly include `status: "draft"`. The verified database default is `"active"`; relying on the default risks exposing an incomplete listing.
- Do not include client-editable verification flags such as `identity_verification`, `business_verification`, `ownership_declaration`, `domain_ownership`, `domain_verification`, or `github_ownership` in an autosave payload. A checkbox/attestation is not independent verification.
- Before updating, fetch by both row ID and authenticated owner, verify the row is still an editable draft, and confirm that exactly the intended row was updated. A zero-row update must not silently become an insert without a duplicate check.
- Do not send nested legacy `performance`, `financials`, or `social_accounts` objects unless the specific target columns and every consuming reader are confirmed. The verified schema has first-class scalar columns for most of these values.
- Media metadata is not media persistence. The current Next.js preview retains only selected filenames in component state. Cloud upload needs authenticated user-scoped paths, MIME/size checks on the server, and explicit partial-failure handling; the public bucket must never receive private identity or ownership evidence.
- No database writes, Storage uploads, or production application changes were made during this schema verification.

