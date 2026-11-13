# W3M Protocol — Technical Specification (V1 Draft)

**Status:** Draft for engineering review  
**Protocol name:** W3M Protocol  
**Formal description:** Evidence-Driven Acquisition Verification & Conditional Settlement  
**Version:** 1.0-draft  
**Scope:** Digital-project acquisitions initiated through Web3Market  
**Release posture:** Specification only; not connected to live transactions.

## 1. Purpose

W3M Protocol defines a deterministic, evidence-driven control layer for digital-project acquisitions. It binds a specific deal, its agreed terms, required evidence, verification results, dispute state, and settlement authorization into one auditable lifecycle.

The protocol is intended to reduce the risk of releasing settlement when required acquisition conditions have not been demonstrated. It does not guarantee that an asset is free of hidden defects, replace legal review, or independently prove facts that cannot be verified from trustworthy sources.

## 2. Normative principles

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative requirements in this draft.

1. **Fail closed:** missing, invalid, expired, revoked, contradictory, or unverifiable mandatory evidence MUST NOT produce settlement authorization.
2. **No score override:** an AI score, reputation score, or aggregate confidence value MUST NOT override a failed mandatory condition.
3. **Deal binding:** every evidence item and verification result MUST be bound to one immutable deal identifier and one specific terms version.
4. **Versioned rules:** each decision MUST identify the policy/ruleset version and verifier version used.
5. **Freshness:** mandatory evidence and blocking conditions MUST be re-evaluated immediately before settlement authorization.
6. **Separation of duties:** evidence submission, verification, dispute resolution, and wallet execution MUST be represented as distinct actions with attributable actors.
7. **Auditable history:** state changes and decisions MUST be append-only events; corrections create superseding records rather than silently rewriting history.
8. **No custody claim:** the protocol coordinates authorization conditions; custody and execution remain with the explicitly configured wallet/escrow contracts and their signers.

## 3. Actors and trust boundaries

- **Buyer:** proposes or accepts deal terms, supplies buyer-side evidence, and records acceptance.
- **Seller:** supplies ownership/control and handover evidence.
- **Web3Market application:** creates deal records, collects evidence references, invokes verification, and presents protocol outcomes.
- **Evidence verifier:** validates evidence format, provenance, signatures, timestamps, deal binding, and applicable rules. AI may assist extraction or anomaly detection but cannot waive deterministic checks.
- **Reviewer/dispute authority:** handles cases requiring human review under a documented policy. The authority and its permissions must be configured before production.
- **Safe wallet signers:** approve or reject the exact Safe transaction according to the wallet's owner and threshold configuration.
- **Blockchain network:** provides transaction, receipt, event, and finality evidence for the configured chain.

Trust boundaries MUST be explicit. A URL, screenshot, uploaded document, AI-generated summary, or user assertion is not automatically trusted evidence.

## 4. Deal identity and terms integrity

Each deal MUST have:
- a globally unique `deal_id`;
- buyer and seller account identifiers;
- project/asset identifiers and a declared transfer scope;
- a chain identifier and settlement wallet configuration, where applicable;
- a versioned agreement/terms document;
- a canonical terms digest;
- a required-evidence policy version;
- a lifecycle state and append-only event history.

The canonical terms digest SHOULD be calculated from a deterministic serialization of the agreed fields (for example, RFC 8785 JSON Canonicalization Scheme followed by SHA-256). The implementation MUST define the exact fields included and MUST reject ambiguous or duplicate representations.

A material change to price, asset scope, parties, deadlines, payment destination, transfer requirements, dispute terms, or settlement parameters MUST create a new terms version and invalidate any prior authorization derived from the superseded version. Both parties must accept the new version where the agreement requires bilateral acceptance.

## 5. Evidence envelope

Every evidence item MUST be represented by a structured envelope containing at least:

| Field | Requirement |
|---|---|
| evidence_id | Unique immutable identifier |
| deal_id | Deal to which the evidence belongs |
| terms_version | Exact terms version supported |
| evidence_type | Controlled type from the deal policy |
| issuer / submitter | Account or external source attribution |
| source_reference | Secure reference or content location |
| content_digest | Cryptographic digest of the exact evidence bytes |
| observed_at | Time the underlying fact was observed, if known |
| submitted_at | Server-recorded submission time |
| valid_until | Expiry, if the evidence has a defined validity period |
| verification_status | Pending, valid, invalid, expired, revoked, or review-required |
| verifier_version | Exact verifier/ruleset version |
| provenance | Source and collection method |
| signature | Signature and key identity, when applicable |

Evidence MUST be checked for deal binding, integrity, expected type, provenance, expiry, revocation, and contradictions. Sensitive evidence SHOULD be stored using access-controlled storage; public reports should expose only the minimum necessary metadata and digests.

A content digest proves that bytes match a previously recorded digest; it does not prove that the underlying claim is true. Source trust and factual verification remain separate checks.

## 6. Mandatory evidence groups

The deal policy defines which requirements apply to each acquisition. The baseline groups are:

1. **Project identity:** the project and included assets are unambiguously identified.
2. **Seller authority:** evidence supports that the seller controls or is authorized to transfer the specified assets.
3. **Agreement integrity:** buyer and seller acceptance is bound to the same current terms digest.
4. **Technical/asset review:** agreed repositories, domains, accounts, intellectual property records, or other assets have been reviewed to the extent stated in the agreement. A code-audit report is supporting evidence, not proof of ownership or absence of vulnerabilities.
5. **Handover:** evidence demonstrates completion of each required transfer step, such as repository access, domain transfer, deployment credentials, or other enumerated assets.
6. **Buyer acceptance:** buyer acceptance is recorded against the current terms version and required handover checklist.
7. **Payment/escrow readiness:** the exact configured wallet, chain, asset, amount, and escrow transaction parameters are validated.
8. **Dispute status:** no unresolved blocking dispute, freeze, or other policy-defined hold exists.

The policy MUST distinguish mandatory requirements from optional/contextual evidence. An omitted requirement is not silently treated as satisfied.

## 7. Decision engine

The engine returns exactly one primary outcome:

- **PASS:** all applicable mandatory evidence and authorization preconditions are valid for the current deal and terms version at the time of evaluation.
- **INCOMPLETE:** one or more mandatory requirements are absent or still pending, without a known blocking violation.
- **BLOCKED:** a hard-stop condition exists, including a confirmed mismatch, revoked authority, terms-integrity failure, active blocking dispute, invalid settlement destination, or other policy-defined prohibition.
- **REVIEW_REQUIRED:** evidence is contradictory, ambiguous, anomalous, or outside deterministic verification capability and requires an authorized review.

Precedence MUST be deterministic:
1. Any hard-stop condition => BLOCKED.
2. Otherwise, any unresolved contradiction or mandatory human-review condition => REVIEW_REQUIRED.
3. Otherwise, any missing/pending mandatory requirement => INCOMPLETE.
4. Otherwise => PASS.

The exact precedence and policy version MUST be recorded with every decision. A PASS is a time-bound evaluation result, not a guarantee and not by itself a blockchain execution.

## 8. Settlement authorization gate

A settlement authorization MUST be created only after a fresh evaluation returns PASS for the current terms version.

The authorization record MUST bind:
- deal_id and terms_version;
- canonical terms digest;
- evidence-set digest and evidence identifiers;
- decision and policy/verifier versions;
- buyer/seller acceptance references;
- dispute/freeze check result;
- chain_id, Safe address, nonce, destination, value, calldata digest, operation, and applicable Safe transaction parameters;
- authorization creation time and expiry;
- required signer/threshold configuration reference.

Any change to a bound field, a new dispute, evidence revocation/expiry, terms amendment, nonce change, wallet configuration change, or authorization expiry MUST invalidate the authorization and require fresh evaluation.

A UI status or database flag MUST NOT be treated as sufficient authorization to execute a wallet transaction.

## 9. Safe and blockchain validation

Before requesting signatures, the implementation MUST validate the proposed Safe transaction against the authorization record. Signatures MUST be checked against the exact Safe transaction hash and configured chain/Safe context. The implementation MUST NOT accept signatures copied from a different transaction, chain, Safe address, nonce, or payload.

Before execution, the system MUST re-check:
- authorization validity and expiry;
- current terms and evidence digests;
- dispute/freeze state;
- Safe address, chain, nonce, destination, value, calldata, operation, and gas-related parameters that affect the signed transaction;
- configured signer set and threshold, using the Safe's authoritative configuration.

After execution, the system MUST verify the transaction receipt and relevant Safe execution outcome on the intended chain. A submitted transaction is not equivalent to successful execution. Confirmation/finality requirements MUST be defined per supported chain.

This specification does not prescribe or deploy a new smart contract. Any contract-level enforcement requires separate design, testing, audit, and approval.

## 10. Disputes, holds, and recovery

A dispute or authorized hold MUST immediately prevent new settlement authorization. If an authorization already exists but has not executed, it MUST be invalidated. The system MUST record who opened the dispute, the reason category, timestamp, evidence references, reviewer actions, and resolution.

A dispute resolution MUST NOT erase the dispute history. Resumption requires a new evaluation and a new authorization bound to the current deal state. If a transaction has already executed, the protocol MUST record that fact and route the case to the separately defined post-settlement process; it MUST NOT imply that an executed transfer can be automatically reversed.

## 11. Event log and audit report

The protocol SHOULD emit append-only events for:
- deal created and terms proposed/accepted/amended;
- evidence submitted, verified, rejected, expired, or revoked;
- decision evaluated;
- review requested and resolved;
- dispute opened, held, and resolved;
- authorization created, expired, or invalidated;
- Safe transaction proposed, signed, executed, failed, or confirmed.

Each event SHOULD include a unique event ID, deal ID, actor, server timestamp, event type, relevant version/digest references, and correlation ID. Event ordering and tamper-evidence requirements must be specified in implementation.

A report MUST clearly distinguish verified facts, user-supplied claims, automated inferences, unresolved items, and reviewer conclusions. Reports MUST identify their generation time and become stale when a bound input changes.

## 12. Security, privacy, and abuse controls

- Enforce server-side authorization and deal-scoped access controls for every evidence and report operation.
- Never trust client-supplied role, ownership, decision, or settlement status.
- Validate file type and size; scan uploads; prevent path traversal and unsafe URL fetching/SSRF.
- Avoid storing private keys, seed phrases, or Safe signer secrets in application databases.
- Use least-privilege service credentials and rotate/revoke them under a documented process.
- Rate-limit evidence submission and verification endpoints; protect against replay and duplicate event processing.
- Keep private evidence private; redact secrets and personal data from public reports and logs.
- Define retention, deletion, dispute preservation, and access-audit policies before production.

## 13. Minimum acceptance test matrix

The implementation is not release-ready until automated tests cover at least:

1. All mandatory evidence valid and current => PASS.
2. Missing mandatory evidence => INCOMPLETE.
3. Invalid or revoked seller authority => BLOCKED.
4. Terms digest mismatch or superseded terms => BLOCKED and prior authorization invalidated.
5. Conflicting ownership evidence => REVIEW_REQUIRED.
6. Expired mandatory evidence => no PASS; outcome follows policy.
7. AI score is high but a mandatory check fails => never PASS.
8. New dispute after PASS => authorization invalidated and execution denied.
9. Evidence changes after PASS => prior authorization invalidated.
10. Wrong chain, Safe address, nonce, destination, value, calldata, or operation => signature/authorization rejected.
11. Signature from a different Safe transaction hash => rejected.
12. Insufficient Safe threshold => execution not authorized.
13. Submitted but reverted/failed transaction => not reported as successful settlement.
14. Duplicate/replayed events => idempotent handling with no duplicate authorization.
15. Buyer cannot read another deal's private evidence or reports.
16. Unauthorized actor cannot change evidence status, decision, dispute state, or authorization.
17. Audit report identifies policy/verifier versions and stale inputs.
18. Terms amendment requires fresh acceptance and fresh evaluation.

Tests MUST use disposable fixtures, a local fork, or an isolated test environment. No production wallet, live deal, user evidence, or production database may be used for destructive testing.

## 14. Release gates

The protocol MUST remain disconnected from live transactions until all of the following are completed and explicitly approved:

- implementation mapped to this specification;
- schema and RLS review, including cross-account isolation;
- complete report issuance and trusted evidence loading;
- deterministic decision-engine tests;
- Safe payload/signature/nonce/threshold validation tests;
- full end-to-end lifecycle test including disputes and failure paths;
- independent security review appropriate to the implementation;
- monitoring, incident response, and recovery procedures;
- documented operator permissions and human-review policy;
- separate production release approval.

## 15. Open engineering decisions

These decisions must be resolved and recorded before implementation is considered complete:

1. Exact supported asset/evidence types for the first release.
2. Trusted issuer/key registry and revocation process.
3. Canonical terms schema and serialization profile.
4. Evidence storage, encryption, retention, and deletion policy.
5. Human-review roles, escalation, and appeal process.
6. Supported chains, Safe versions, finality policy, and signer-configuration source.
7. Whether any condition is enforced on-chain, off-chain, or by both.
8. Authorization lifetime and revalidation triggers.
9. Post-settlement dispute and recovery policy.
10. Formal threat model and independent audit scope.

---

**Important status statement:** This document is an engineering specification draft. It is not evidence that the protocol has been implemented, independently audited, deployed, or connected to live transactions. The public protocol page and roadmap must continue to reflect the actual verified implementation status.
