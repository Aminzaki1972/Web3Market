# W3M Dispute Lock — Decision Options and Threat Model

**Status:** decision-support document for sandbox review only. No implementation selected or authorized.  
**Related design:** `docs/SAFE-DISPUTE-ENFORCEMENT-DESIGN.md`.

## The core engineering constraint

A Safe Guard cannot safely infer that a dispute is open merely because a Web3Market database row changed. The enforcement state must be available to the Guard at execution time and protected against unauthorized alteration. This creates a real design trade-off between immediate dispute protection, party autonomy, censorship resistance, griefing resistance, and recovery.

A transaction that writes a lock to chain only becomes effective once it is included and canonical. A signed request sitting in a browser, API queue, or mempool is not yet a lock. The system must never show “funds frozen” before the lock transaction is confirmed under the agreed chain-finality policy.

## Option A — Guard-local lock with buyer/seller dispute authorization

A deal-specific Guard stores its own lock state. Either the configured buyer or seller can authorize opening a dispute using a typed-data signature bound to:
- chain ID;
- exact Safe address and deal ID;
- agreement version/hash;
- dispute nonce;
- reason/evidence reference hash;
- expiry/deadline.

A relayer submits the authorization to the Guard. The Guard verifies the signer against the buyer/seller addresses configured for this deal, consumes the nonce, and permanently sets the dispute lock until a valid settlement path is executed.

**Advantages**
- Does not require a separate escrow contract.
- Guard can enforce the lock locally on every covered Safe transaction path.
- Either party can initiate a protective lock without waiting for the other party's Safe signature.

**Risks and required controls**
- The lock is not effective until the on-chain lock transaction is mined and canonical. A race window remains.
- A malicious party can grief-lock the Safe. The agreement must define when a dispute can be opened, notice requirements, response deadlines and consequences of abusive claims.
- The Guard must bind the signer to the exact deal and agreement; signatures must be replay-protected and expire.
- Recovery and adjudication must not let the platform silently unlock funds or rewrite allocations.
- A party whose key is compromised can trigger a lock; key compromise and signer rotation rules must be specified.

## Option B — Safe owner-threshold transaction opens the lock

The dispute lock is set only by a Safe transaction that meets the configured owner threshold and calls the Guard's lock function.

**Advantages**
- Uses the Safe's existing owner authorization path.
- Reduces unilateral griefing by one party.

**Risks**
- A party may refuse to sign the lock, leaving funds exposed while the dispute is unresolved.
- This may conflict with the promise that either buyer or seller can initiate a dispute.
- It is not a reliable protective mechanism if the alleged wrongdoer can block the threshold.

## Option C — Platform-only lock authority

A platform-controlled key can set the lock.

**Advantages**
- Operationally simple and fast to trigger after the platform receives a dispute.

**Risks**
- Creates a privileged unilateral platform freeze key.
- Platform compromise, insider abuse, outage or censorship becomes a critical custody/policy risk.
- This centralization must be disclosed and expressly approved; it must not be described as decentralized or trustless.

## Option D — External policy registry/controller

A separate on-chain policy contract stores deal dispute state and is queried by the Guard.

**Advantages**
- Separates policy state from the Guard implementation and may support standardized deal policies.

**Risks**
- Adds another smart contract and governance surface.
- Must not hold or custody deal funds; if it begins holding funds or controlling transfers, it risks violating the user's no-independent-escrow constraint.
- Adds external-call, upgrade, availability and authorization risks.
- This option is not necessary for a first design unless Safe Guard constraints require it.

## Preliminary engineering recommendation

For further design only, **Option A is the strongest candidate to investigate**, because it allows either named transaction party to request a protective lock without giving the platform a unilateral freeze key and without introducing an independent escrow holder.

This is not yet a final product decision. The unavoidable race between signature submission and on-chain confirmation must be accepted and mitigated. Before real use, the UI must distinguish:
1. Dispute submitted (off-chain request received).
2. Lock transaction pending (not yet frozen).
3. Dispute lock confirmed on-chain (covered Safe paths now reject prohibited transactions).
4. Decision issued (contractual platform decision recorded).
5. Settlement authorized and executed (exact approved batch verified).

## Settlement authorization must be distinct from dispute initiation

Opening a dispute and releasing funds are different powers.

- A buyer or seller dispute signature may only set the lock. It must not authorize a payout.
- A platform decision must bind the exact agreement hash, decision hash, Safe, chain, token, recipients and amounts.
- A settlement transaction must satisfy the Safe's required owner threshold and any separately approved decision-authorization rule.
- The Guard must allow only the exact settlement batch, consume its decision nonce, and remain locked against all other outgoing calls.
- The Guard must not mark settlement complete merely because a transaction was proposed or signed.
- Completion requires an independent server-side verifier of the canonical Safe execution receipt and every expected token transfer.

## Safe owner and threshold implications

Do not assume the earlier 2-of-3 buyer/seller/platform Safe configuration automatically solves dispute enforcement. The design must separately decide:
- whether all three remain owners;
- which parties can open the dispute lock;
- who signs ordinary payout;
- who signs a dispute settlement;
- whether platform decision authorization is separate from Safe owner threshold;
- what happens if a signer is unavailable or compromised.

A threshold such as 2-of-3 is not itself a dispute lock. If two owners can execute an unrestricted transaction, they may still move funds unless the Guard blocks it.

## Required adversarial scenarios

1. Buyer submits dispute signature while seller attempts payout in the same block.
2. Seller submits dispute signature while buyer attempts payout in the same block.
3. Dispute signature is replayed against another deal, chain, Safe or agreement version.
4. Relayer delays or censors the lock transaction.
5. Dispute lock transaction is reorganized out of the canonical chain.
6. One party opens repeated disputes to grief-lock funds.
7. Platform key is compromised or platform service is offline.
8. Safe owner threshold is changed or Guard removed while dispute is open.
9. An enabled module attempts an outgoing transfer while locked.
10. A malicious MultiSend hides an extra transfer or allowance change.
11. A decision is replayed or modified after settlement.
12. Recovery is attempted with an invalid or expired authorization.

## UX wording — required distinction

| State | Permitted wording |
|---|---|
| Off-chain dispute received | “Dispute submitted — funds are not yet confirmed locked.” |
| Lock tx pending | “Dispute lock pending on BNB Smart Chain.” |
| Lock confirmed | “Dispute lock confirmed on-chain.” |
| Decision recorded | “Web3Market decision recorded; settlement not yet executed.” |
| Safe tx proposed/signed | “Settlement awaiting Safe execution.” |
| Verified execution | “Settlement executed and verified on-chain.” |

Never display “frozen”, “secured”, “refunded”, “paid”, or “completed” based only on an off-chain state flag.

## Decision status

No option has been selected by the user. No Guard or Module code should be written until the user approves a threat model, the party authorization model, signer/threshold model, lock-race treatment, fee policy for refunds, and recovery process.

## User-approved administration authority — 2026-11-14

The user selected administration-led dispute governance:
- Either buyer or seller may submit a dispute request.
- Web3Market administration reviews it and decides whether to formally open the dispute.
- A submitted request is not automatically an approved dispute. During review, the deal is held off-chain against new payout proposals/instructions; the UI must not claim a confirmed Safe lock.
- If administration approves opening, initiate the on-chain lock. Only verified canonical chain state may be labelled "lock confirmed".
- Administration has final authority over every financial decision: seller payout, full/partial refund, split allocation, platform commission and other financial distributions.
- Decisions must be reasoned, recorded and bound to the exact deal/agreement/allocation. AI is advisory only.

### Abuse, accountability and audit controls
Require a recorded request, claimant, timestamp, reason and evidence references; notice to the other party and response opportunity under the agreement; a reasoned administrative decision to open or decline; conflict-of-interest/recusal handling; an auditable record of deciding administrator(s); a separate final financial decision after both parties' evidence/response period; and append-only decision history. No automatic AI acceptance/rejection, hidden manual override or unlogged administrator action.

The authority model is approved. Exact administrator role model (single authorized administrator versus multi-person approval), recusal policy, response deadlines and emergency availability remain to be specified. A party-signed lock option is not selected; on-chain lock is initiated only after the administrative opening decision.
