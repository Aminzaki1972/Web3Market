# W3M Slither + Aderyn analysis layer

This is the first isolated implementation step for adding independent Solidity static-analysis engines to W3M AI Code Audit.

## Current scope

- GitHub Actions runs Slither and Aderyn on a public GitHub repository at an immutable 40-character commit SHA.
- The target repository is cloned without credentials. No customer secrets, Supabase keys, wallet keys, or deployment credentials are passed to the analysis job.
- Tool versions are pinned: Slither 0.11.6 and Aderyn 0.6.8.
- Raw reports and logs are retained as a 14-day GitHub Actions artifact.
- `normalize.py` converts Slither JSON and Aderyn JSON into the versioned `w3m.static-analysis.v1` envelope.
- Each candidate is explicitly marked `confirmed: false` and `triage_status: needs_ai_triage`. Shared file/line locations are correlation hints only; they are not automatically merged.

## Run it

1. Open GitHub → Actions → **W3M Slither + Aderyn Contract Analysis**.
2. Choose **Run workflow**.
3. Enter a public GitHub repository URL.
4. Optionally provide an exact 40-character commit SHA. Leave blank to resolve the repository's current default-branch HEAD at run start.
5. Download the artifact named `w3m-contract-analysis-<repo>-<commit>`.

Pushes to the implementation branch and relevant pull requests also run the workflow against the Web3Market repository snapshot.

## Local normalizer tests

```bash
python3 -m unittest discover -s tests/w3m-contract-analysis -p 'test_*.py' -v
```

## Server-side integration (feature branch; not live)

- The branch-only audit worker dispatches the scanner for `smart_contract` and `complete` audits when the pinned repository snapshot contains Solidity files.
- The worker persists dispatch/polling state in the existing `analysis_progress` JSON field; no database migration is required.
- The server-only dispatcher correlates the run with the W3M audit UUID and immutable repository commit, then downloads and validates the artifact outside the scanner job.
- Candidate findings are passed to Gemini alongside the matching source chunk and are also preserved as `needs_verification` findings. Scanner output is never automatically marked confirmed.
- Signed-in audit pages and guest report polling resume queued scanner stages. Failed, missing, or mismatched artifacts fail the audit rather than being treated as a clean scan.
- The GitHub token is read only from the Supabase Edge Function environment and is never included in workflow inputs, scanner environment variables, logs, or artifacts.
- Dispatch targets the trusted control repository `Aminzaki1972/Web3Market`; the customer repository is only the scan target.
- The workflow must be merged to the control repository default branch before API dispatch can work. The helper uses `main` as the fixed workflow ref.
- This integration remains branch-only. End-to-end dispatch, artifact retrieval, Gemini triage, and persistence still require tests after the workflow is available on `main`. Do not deploy or advertise the live integration as enabled yet.

## Limitations

- This is static analysis, not a complete security audit.
- Missing imports, unavailable dependencies, unsupported compiler versions, or framework-specific build requirements may prevent one or both engines from completing.
- The workflow intentionally does not run `npm install`, `forge install`, arbitrary project scripts, tests, fuzzers, or deployment simulations.
- A non-zero scanner process exit code is recorded separately from findings. A valid JSON report is required for a scanner to be considered completed.
- Slither is AGPL-3.0 and Aderyn is GPL-3.0. Review license obligations before offering these engines as part of a commercial hosted service.
