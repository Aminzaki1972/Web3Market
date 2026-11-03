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

## Important integration boundary

This workflow is the isolated scanner and report producer. It does **not yet dispatch automatically from the live Supabase Edge Function or write findings into production tables**. That bridge requires a narrowly scoped GitHub Actions dispatch credential and a verified artifact/result retrieval path. Keep it separate from the scanner job: never pass that credential into the job that checks out and analyzes customer-controlled source code.

The next integration stage will:
1. dispatch this workflow from the audit worker using a server-side credential;
2. correlate the workflow run to the audit ID and pinned repository commit;
3. retrieve and validate the normalized artifact outside the untrusted scanner process;
4. map candidate findings into the existing audit pipeline for Gemini triage and persistence;
5. treat unavailable/failed scanners as incomplete coverage, never as a clean result.

## Limitations

- This is static analysis, not a complete security audit.
- Missing imports, unavailable dependencies, unsupported compiler versions, or framework-specific build requirements may prevent one or both engines from completing.
- The workflow intentionally does not run `npm install`, `forge install`, arbitrary project scripts, tests, fuzzers, or deployment simulations.
- A non-zero scanner process exit code is recorded separately from findings. A valid JSON report is required for a scanner to be considered completed.
- Slither is AGPL-3.0 and Aderyn is GPL-3.0. Review license obligations before offering these engines as part of a commercial hosted service.
