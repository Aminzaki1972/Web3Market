# Trust Badge audit-writer requirements

Status: documentation only. No production or database changes.

## Source-review finding
The deployed audit worker already pins a Git commit, rejects truncated Git trees, computes the eligible source-file denominator, and counts oversized and unreadable files while scanning. However, its final completion record currently places the oversized/unreadable totals in human-readable summary text. The final `analysis_progress` object keeps `eligible_files` but drops the structured batch counters. A rounded `coverage_score` is not sufficient proof of complete coverage.

## Required evidence before an endpoint
The completed audit record must retain structured values in the existing JSON progress field, or in separately approved typed columns:
- eligible file count from the complete recursive Git tree;
- successfully scanned file count;
- persisted file-row count, obtained by re-reading `code_audit_files` after inserts;
- total oversized eligible files;
- total unreadable eligible files;
- confirmation that the recursive Git tree was not truncated;
- an evidence-format version.

The endpoint must independently count persisted file rows and persisted Critical/High findings. It must reject missing, malformed, negative, fractional, or mismatched counts. For the current strict policy, eligible, scanned, and persisted counts must be positive and equal; oversized and unreadable counts must be zero. It must not parse summary prose or rely on rounded coverage percentages.

## Why the endpoint is not being written yet
Without structured final counts, the endpoint cannot reliably prove full coverage. The audit writer source was located on the repository's current default branch, but the matching worker file was not present at the expected path in the prototype branch during this inspection. I will not copy or replace a production worker into the prototype without confirming the branch base and exact file history.

## Next safe sequence
1. Reconcile the prototype branch with the current audit-worker source without changing production.
2. Add structured completion evidence to the prototype worker only.
3. Add tests for resumable batches and aggregation of skipped files.
4. Then build the read-only eligibility endpoint against confirmed schema and repository binding.
5. Design Premium approval storage separately; do not use a client toggle or treat the existing admin activity log as immutable.

No migration, table, policy, secret, deployment, or production data change is authorized or performed by this document.
