# Buyer Due Diligence — production readiness test matrix

| Actor | Action | Expected |
|---|---|---|
| Anonymous | Read reports or notes | Denied |
| Buyer A | Create report for active listing with completed linked audit | Report saved with summary-only snapshot |
| Buyer A | Create report for active listing without completed audit | Report saved with `missing`; explicit no-audit-is-not-safe notice |
| Buyer A | Read own report and note | Allowed |
| Buyer A | Save/update/delete own note | Allowed |
| Buyer B | Read Buyer A report | No rows / denied |
| Buyer B | Read or update Buyer A note | No rows / denied |
| Seller-role account | Open Buyer Center | Buyer Due Diligence panel is not rendered |
| Seller-role account | Invoke create function | 403 |
| Buyer | Request inactive/nonexistent project | 404 |
| Buyer | Submit malformed project ID | 400 |

## Security assertions
- The function authenticates the JWT with Supabase Auth and checks the current profile role server-side.
- The service-role key remains server-side; the browser never receives it.
- Reports are SELECT-only for authenticated clients; inserts happen only in the function.
- Notes are isolated by both `buyer_id` and ownership of the parent report.
- The report snapshot excludes raw file paths, evidence text, source snippets, and private seller/admin fields.
- The UI must not label an unscanned or missing audit as safe.
