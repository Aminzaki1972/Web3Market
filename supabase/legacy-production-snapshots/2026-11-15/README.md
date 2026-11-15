# Legacy Production Edge Function Source Snapshot

Captured: 2026-11-15
Source project: existing Web3Market Supabase project
Target repository branch: `prototype/deal-management-system-20261114`

**WARNING: archival source snapshot only. DO NOT DEPLOY these files.**

These files preserve the exact currently deployed source returned by the Supabase read-only Edge Function retrieval API. They are stored outside `supabase/functions/` intentionally so normal Supabase function deployment workflows do not treat them as deployable function source.

No source was changed or normalized during capture. No production function was invoked, modified, disabled, or redeployed.

| Function | Deployed version | Supabase source SHA-256 |
|---|---:|---|
| `create-safe` | 56 | `d888f48d48c87563e20e43318f9187c0f02d9a46fbe5e037cadbb5520b918e07` |
| `verify-deal-payment` | 62 | `dae5138b9a5c30345097c512a613db4697a08b6ce8e27ac10977ae55baad88aa` |
| `prepare-deal-release` | 43 | `6c670d08fbb55fdc61a10c39b5f32062d311934228df59ce23096d337ba52e18` |
| `prepare-safe-release-tx` | 37 | `f4248dde096a3532befca8dbd894cdb3bb6511bdf2d6a70c8e253b9587b01dfe` |
| `record-safe-release-signature` | 24 | `fb4fedf2c17245b52d2920d3ac13c426b02a49d176dc96e75237c599840d5d01` |
| `execute-safe-release` | 28 | `e51aa4f2dffe259292a627b0ab1c3663c5f2ef46b7792cd96c156c452eb65d22` |
| `finalize-safe-release` | 25 | `4f39f60122f79198fd8b2051cefd172d600f1c1d3a5d48310b40620957efd5ce` |

The source is included only to enable offline review, diffing and test design. Before any future implementation:
1. Compare the snapshot with the currently deployed version again.
2. Remove all production secrets from any test fixture or repository source; these snapshots were scanned for embedded private-key literals and obvious credential patterns at capture time.
3. Port only reviewed logic into a new, explicitly isolated implementation.
4. Never deploy these snapshots directly.
5. Do not use the legacy Safe release functions as the new Deal Management workflow.

This snapshot does not authorize production changes, function deployments, wallet signing, or transactions.
