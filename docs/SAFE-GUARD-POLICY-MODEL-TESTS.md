# Safe Guard Policy Model — Sandbox Threat Tests

**Status:** non-production model and adversarial unit tests only.  
**Branch:** `prototype/deal-management-system-20261114`.

## Purpose

The accompanying `guard-policy-model.ts` is a pure TypeScript policy evaluator used to make the locked-dispute requirements testable before any contract implementation is considered. It is deliberately named a **model**: it is not Solidity, a deployed Safe Guard, a Module Guard, an ABI decoder, a signature verifier, or a source of authorization.

The evaluator receives a hypothetical transaction tuple and already-decoded effects. A real implementation must independently decode the complete Safe transaction and every nested MultiSend operation from canonical transaction data. It must never trust decoded effects supplied by a browser or caller.

## Model rules

- A dispute that is only submitted or pending is never represented as an on-chain confirmed lock.
- Under a confirmed lock, deny by default.
- Permit only the exact settlement tuple bound to the deal Safe, BNB Smart Chain (56), token target, Safe nonce, decision hash/nonce, and the complete expected transfer allocation.
- Reject delegatecall, incomplete decoding, extra/missing transfers, token approvals, native BNB movement, arbitrary calls, Safe configuration changes, replayed nonces, and module execution without verified Module Guard coverage.
- This evaluator does not create, sign, submit, or execute Safe transactions and does not change any real lock state.

## Test coverage

The paired Deno tests cover the exact authorized allocation, submitted/pending lock distinction, ordinary/extra payout attempts, approvals/native transfers/arbitrary calls/configuration changes, delegatecall, incomplete decode, uncovered modules, wrong chain/Safe/token/tuple, amount mismatch, replay, and malformed/empty allocations.

## Important limitations and deployment gates

Passing these tests proves only the behavior of this in-memory model. It does not prove:
- Solidity correctness or Safe Guard hook coverage;
- complete ABI/MultiSend decoding or resistance to parser ambiguity;
- actual Safe proxy/mastercopy/version compatibility on BNB Chain;
- module or configuration-change prevention on a deployed Safe;
- dispute signature authenticity, platform decision-key security, or race-free lock activation;
- chain finality, RPC trust, concurrency safety, or real USDT transfer execution.

No contract, wallet, RPC connection, database integration, deployment, migration, or production change is included. A separate threat-model and implementation plan must be reviewed and explicitly approved before writing or deploying Guard/Module contracts.
