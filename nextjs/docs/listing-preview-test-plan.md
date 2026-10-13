# Seller Listing Preview — Manual Test Plan

## Scope and safety

This plan covers the isolated Next.js preview on `nextjs-migration` only. The form is a browser-local prototype: it does not authenticate users, upload media, call AI review, create a database row, or change production listings. Do not enter secrets or private sale documents.

## Draft persistence

1. Open `/sell-project` in the preview.
2. Enter a project name, distinct short and full descriptions, and a few optional fields.
3. Wait for the saved-on-this-device status.
4. Reload the page and confirm text fields are restored.
5. Put malformed JSON in localStorage key `w3m-nextjs-listing-draft-v1`; reload and confirm the page recovers without crashing.
6. Put an object with wrong field types in that key; reload and confirm mismatched values fall back to defaults.
7. Use Clear local draft and confirm it removes only this preview's local key.

## Required-field and URL validation

1. Submit an empty form; confirm required-field feedback appears and the draft is retained.
2. Enter a short description under 20 characters and a full description under 50; confirm validation fails.
3. Enter a full description over 20,000 characters; confirm it is constrained/rejected.
4. Enter a valid HTTPS official website and leave GitHub blank; confirm the references requirement is satisfied.
5. Enter a valid GitHub owner/repository URL and leave website blank; confirm the references requirement is satisfied.
6. Put a GitHub URL in the official website field; confirm validation rejects the misplaced URL.
7. Enter an HTTP URL or malformed URL in an optional link, including App Store and social links; confirm validation rejects it.
8. Test `https://user:password@example.com` in the official website and an optional URL; confirm URL validation rejects embedded credentials.
9. Test `https://user@github.com/owner/repository`; confirm the GitHub repository validator rejects embedded credentials.
10. Confirm normal public HTTPS URLs without credentials continue to pass.

## Numeric validation

1. Use a non-negative asking price such as `100`; confirm the price check passes.
2. Test empty, negative, and non-numeric asking price values; confirm they fail.
3. For optional revenue/expense fields, leave blank or use `0`; both should be accepted.
4. Test negative or non-numeric optional financial metrics; confirm validation fails.
5. For counts (users, customers, visits, total sales), test a decimal such as `2.5`; confirm validation fails.
6. Test growth rate with `-12%` and an invalid string; confirm the numeric negative rate is accepted and invalid text rejected.
7. Test conversion rate with `3.4%`, `101%`, and a negative value; only values from 0 through 100 should pass.
8. Set last active date to today, then a future date; confirm the future date is rejected.
9. Test year created with a valid year and with an implausible/future year; confirm only the valid year passes.

## Media selection checks

1. Select PNG/JPG/WebP images up to 8 MB; confirm filenames and sizes are shown.
2. Select a different MIME type or an image above 8 MB; confirm it is rejected.
3. Select MP4/WebM/MOV video up to 50 MB; confirm filenames and sizes are shown.
4. Select an unsupported video type or a video above 50 MB; confirm it is rejected.
5. Select several screenshots where one is invalid; confirm the selection is rejected as a group.
6. Reload the page and confirm media selections are not presented as uploaded or persisted.

## Expected behavior and limitations

- A valid submission displays a message that preview validation passed, while explicitly noting cloud submission and AI review are not enabled.
- No test in this plan should create a production listing or upload a file.
- These browser checks are still manual until an automated browser test suite is added.
- Before any backend integration, separately verify the actual database columns, owner/status rules, Row Level Security, and `project-media` storage policies in an isolated test environment. Never infer schema or permissions from this preview form.


## Structured legacy-field checks

1. Select several project types and independently select/deselect them.
2. Select several industry/service categories; confirm choices match the legacy vocabulary (Health, Education, Marketing, Sales, Finance, Web3, AI, Social, Business, Real Estate, Travel, Gaming, Media, Freelance, Other).
3. Select several target-audience categories (for example Developers, Startups, Investors); confirm they are multi-select choices, not a free-text value.
4. Select several included assets; confirm selected asset categories remain distinct from free-text asset notes and do not imply that files were uploaded.
5. Set revenue status to Yes, No, and Not specified; confirm the blank/unspecified state is not silently changed to No.
6. Test reporting periods Monthly, Yearly, Both, and Not specified; confirm values remain compatible with the legacy form.
7. Reload the page and confirm project types, industry/service categories, target audience, revenue status/period, and included assets restore from the local draft.
8. Clear the draft and confirm all structured choices reset.
9. Confirm the UI does not describe any revenue, ownership, asset, or identity declaration as independently verified.
