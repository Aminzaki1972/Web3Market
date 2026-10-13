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
