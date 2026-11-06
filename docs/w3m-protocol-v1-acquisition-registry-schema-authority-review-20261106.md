# W3M Protocol V1 — Acquisition Registry Schema Authority Review

Date: 2026-11-06
Branch: `w3m-protocol-v1-isolated-20261105`
Status: source review only; no migration applied and no production database accessed or changed.

## Finding

The isolated repository contains two separate acquisition-report schema families:

1. `20261106000100_w3m_protocol_v1_acquisition_verification.sql` creates:
   - `public.acquisition_reports`
   - `public.acquisition_evidence`
   - `public.acquisition_report_signatures`
   - `public.acquisition_report_events`

   This family uses lowercase status values such as `pass`, evidence types such as `code_audit`, and a separate EIP-712 acknowledgement-signature table.

2. `20261105210000_w3m_protocol_v1_evidence_registry.sql` creates:
   - `public.w3m_acquisition_reports`
   - `public.w3m_acquisition_evidence`
   - `public.w3m_acquisition_report_events`

   This family uses the protocol engine's uppercase decision values (`PASS`, `INCOMPLETE`, `BLOCKED`, `REVIEW_REQUIRED`), canonical report hash/signature fields, typed evidence outcomes, and a server-only atomic RPC named `w3m_insert_acquisition_registry_batch`.

These are not aliases and are not schema-compatible. They have different table names, status vocabularies, evidence taxonomies, signature models, and persistence contracts.

## Runtime code authority

The current isolated implementation in `report-registry-batch.ts` and `supabase-rpc-adapter.ts` builds rows for the `w3m_*` family and calls only:

```ts
client.rpc("w3m_insert_acquisition_registry_batch", {
  p_report: batch.report,
  p_evidence: batch.evidence,
  p_events: batch.events,
});
```

The protocol orchestrator and persistence service therefore align with the `w3m_*` registry contract, not with the separate `acquisition_*` schema family.

## Decision for V1

- Treat the `w3m_*` registry family as the sole canonical V1 report ledger for the isolated protocol implementation.
- Treat the `acquisition_*` migration family as a separate/legacy draft that is not wired into the current protocol issuer.
- Do not apply both schema families as if they were one unified report store.
- Do not silently rename tables, translate status values, or dual-write between the two families.
- Do not delete or rewrite either historical migration. Any cleanup, deprecation, or consolidation requires a separate migration review and explicit release approval.
- Before any staging deployment, verify the target database has exactly the expected `w3m_*` tables, RPC signature, grants, RLS, append-only triggers, and signer-status view. The repository source alone does not prove what exists in a live Supabase project.

## Related source-derived deal snapshot

The isolated `w3m_read_dealroom_terms_snapshot(uuid)` migration reads these existing Deal Room sources:

- `public.deals`
- `public.deal_release_policies`
- `public.projects`
- `public.profiles`

It returns deal/project/party IDs, deal and policy values, wallet verification fields, payment and delivery state, dispute status, and Safe/token configuration. This is a useful settlement snapshot, but it is not a complete report-issuer source loader: it does not by itself provide the selected Code Audit record, GitHub/NiceNIC credentials and immutable provider observations, complete agreement acceptance evidence, or every report evidence source.

## Remaining work

1. Keep the current report issuer aligned only to `w3m_*`.
2. Inspect the actual existing schema and source tables for each mandatory evidence type before writing a loader. The isolated migrations are draft definitions, not proof of deployed schema.
3. Add a typed read-only report-source snapshot RPC or server-side adapter only after the exact source columns and authorization rules are verified.
4. Add integration tests for missing/duplicate rows, wrong parties, changed terms, stale audit commit, unresolved dispute, payment mismatch, and inconsistent snapshots.
5. Keep signing disabled until protected key custody is selected and configured.
6. Keep deployment, migration application, and production access outside this work until separate explicit approval.

## Safety boundary

This review performed repository source reads and added documentation only. It did not connect to Supabase, inspect production rows, apply SQL, change RLS/grants, select a signer, deploy functions, interact with Safe, or move funds.

**Readiness impact:** the protocol issuer has a clearly identified canonical isolated report schema, but the live authoritative evidence loader and protected signer are still not implemented. The V1 report issuer remains not ready for live issuance.
