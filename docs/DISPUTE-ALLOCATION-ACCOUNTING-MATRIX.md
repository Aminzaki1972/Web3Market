# Dispute Allocation Accounting Matrix

**Status:** implemented in the isolated sandbox domain layer and covered by authored tests; not a live financial integration. This is a product rule and code-level arithmetic model, not legal advice or on-chain enforcement.

## 1. Binding commission rule

- The platform commission is 7.5% of the original gross final agreed deal amount.
- The buyer bears the entire commission, regardless of whether the deal completes, is fully refunded, or is split by an administrative dispute decision.
- In a refund or mixed outcome, the full commission is deducted from the buyer's gross refund bucket. It is not prorated by the seller's payout and is not reduced because the seller retains part of the deposit.
- The seller must not be silently charged for a commission shortfall. No new buyer debt may be invented, and no recipient may receive more than the amount allocated under the agreement and decision.

## 2. Exact accounting representation in the code

For a dispute decision:

- `D`: verified gross USDT deposit in Safe.
- `G`: original gross final agreed deal amount from the immutable, approved agreement snapshot.
- `F`: full platform commission, calculated in integer USDT base units as `floor(G × 750 / 10,000)`.
- `B_gross`: buyer's gross refund bucket before the fee is deducted.
- `S`: seller payout.
- `B_net`: net USDT refund actually transferred to the buyer.

The decision allocation stores `buyerGrossRefund`, `sellerPayout`, and `platformFee`. The payout plan exposes `buyerRefund` as the net amount actually transferred to the buyer.

```text
D = G
F = floor(G × 750 / 10,000)
B_gross >= F
B_net = B_gross - F
B_gross + S = D
Equivalent transfer identity: B_net + S + F = D
```

All values are non-negative integer USDT base units (6 decimals). The fee uses the same floor-to-base-unit rule as the ordinary payout calculation. The decision cannot supply a different fee.

## 3. Worked examples — gross deal and Safe deposit: 10,000 USDT

Commission is 750 USDT in every outcome.

| Outcome | Buyer gross refund bucket | Buyer net refund | Seller payout | Platform fee | Total transferred |
|---|---:|---:|---:|---:|---:|
| Successful completion (ordinary path) | — | 0 | 9,250 | 750 | 10,000 |
| Full refund | 10,000 | 9,250 | 0 | 750 | 10,000 |
| Mixed outcome | 4,000 | 3,250 | 6,000 | 750 | 10,000 |
| Seller-only dispute outcome | 750 | 0 | 9,250 | 750 | 10,000 |

For the mixed outcome, the buyer gross refund bucket is 4,000 USDT. The full 750 USDT commission is deducted from that bucket, so the buyer receives 3,250 USDT. The seller receives 6,000 USDT and the platform receives 750 USDT.

For a seller-only outcome, the buyer gross refund bucket still contains the 750 USDT fee amount, but the buyer's net refund is zero. The seller receives 9,250 USDT and the platform receives 750 USDT. This preserves the buyer-borne fee without charging the seller or inventing a separate buyer debt.

## 4. Commission shortfall — mandatory fail-closed case

Example: the administrative decision would otherwise allocate only 500 USDT to the buyer's gross refund bucket, with 9,500 USDT to the seller, while the full commission remains 750 USDT.

That outcome cannot satisfy the buyer-pays-full-fee rule:

- Buyer gross refund bucket: 500 USDT
- Required full commission: 750 USDT
- Implied buyer net refund: -250 USDT — invalid

**Required behavior:** reject the decision allocation and do not prepare or execute a Safe transfer. Do not charge the seller the 250 USDT difference, create a new buyer debt, deduct more than the buyer bucket, reduce the fee, or silently alter the administrator's allocation. The contract/policy must resolve this edge case before such an allocation can be funded or executed.

## 5. Code-level enforcement added

- `calculatePlatformFee` calculates the full fee from the gross agreement amount using integer arithmetic.
- `DisputeAllocation.buyerGrossRefund` explicitly means the buyer's gross refund bucket before commission.
- `issueDisputeDecision` now requires the original gross agreed amount and rejects a decision unless the fee is exactly 7.5%, the gross amount equals the deposit, the buyer bucket covers the fee, and buyer bucket + seller payout equals the deposit.
- `prepareDisputePayout` requires the original gross amount from the approved agreement, checks it against the decision and deposit, independently recomputes the full fee, rejects fee mismatch/shortfall, and derives the net buyer transfer as gross buyer bucket minus fee.
- The ordinary payout path remains 92.5% seller / 7.5% platform.
- A deal that has ever entered dispute cannot return to the ordinary payout helper; it must use the finalized dispute-decision path.

This is still pure sandbox logic. The original gross amount and approval flags must be supplied by a future trusted backend from immutable, authenticated agreement records. The current functions are not an authorization boundary and do not query Safe or BNB Chain.

## 6. Required future trusted-server checks

Before any real Safe review, a backend must independently establish:

1. The original final agreed gross amount and immutable agreement version/hash.
2. The verified deposit amount and deal Safe address on BNB Smart Chain.
3. The official configured USDT contract and canonical chain evidence.
4. The administrator's finalized, reasoned decision and immutable decision reference/hash.
5. The exact decision allocation and verified recipient addresses.
6. No open dispute, unresolved Guard failure, or other fail-closed condition.
7. The exact proposed Safe transaction matches the validated allocation.

The decision itself never signs or executes a transfer. No UI or database state alone freezes Safe funds.

## 7. Safety boundary

This matrix and the code-level rules do not connect to Supabase, a wallet, Safe, BNB Chain RPC, or production funds. They do not create, sign, submit, or execute a transaction. The isolated PR remains a draft and must not be merged or deployed on the basis of this change.
