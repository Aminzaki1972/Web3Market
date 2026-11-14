# Dispute Allocation Accounting Matrix

**Status:** approved product rule documented for the isolated Deal Management sandbox. This document is a specification and accounting review aid, not a live financial implementation.

## 1. Binding commission rule

- The platform commission is 7.5% of the original gross final agreed deal amount.
- The buyer bears the entire commission, regardless of whether the deal completes, is fully refunded, or is split by an administrative dispute decision.
- In a refund or mixed outcome, the full commission is deducted from the buyer's gross refund entitlement. It is not prorated by the seller's payout and is not reduced because the seller retains part of the deposit.
- The seller must not be silently charged for a commission shortfall. No new buyer debt may be invented, and no recipient may receive more than the amount allocated under the agreement and decision.

## 2. Required accounting representation

For a dispute decision, use these meanings:

- `D`: verified gross USDT deposit in Safe.
- `F`: full platform commission, calculated from the original gross agreed deal amount: `floor(original_gross_amount × 750 / 10,000)` in the token's smallest units, unless the signed agreement specifies a different rounding rule.
- `S`: seller payout.
- `B_net`: net USDT refund transferred to the buyer after the full commission deduction.
- `B_gross`: buyer's gross refund entitlement before commission deduction.

The accounting identities are:

```text
F = 7.5% × original gross agreed deal amount
B_gross = B_net + F
S + B_gross = D
Equivalent: S + B_net + F = D
```

All values must be non-negative integer USDT base units (6 decimals). The allocation must reconcile exactly to the verified Safe balance. No floating-point arithmetic is permitted.

**Important field mapping:** the sandbox's current `DisputeAllocation.buyerRefund` field represents the *net amount transferred to the buyer* (`B_net`), while `platformFee` represents `F`. The gross buyer refund entitlement is therefore `buyerRefund + platformFee`. Do not label the current `buyerRefund` value as a gross refund amount.

## 3. Worked examples — gross deal and Safe deposit: 10,000 USDT

Commission is 750 USDT in every outcome.

| Outcome | Seller payout | Buyer gross refund entitlement | Buyer net refund | Platform fee | Total sent |
|---|---:|---:|---:|---:|---:|
| Successful completion | 9,250 | 0 | 0 | 750 | 10,000 |
| Full refund | 0 | 10,000 | 9,250 | 750 | 10,000 |
| Mixed outcome | 6,000 | 4,000 | 3,250 | 750 | 10,000 |

For the mixed outcome, the buyer's 4,000 USDT gross refund entitlement is reduced by the full 750 USDT commission, so the buyer receives 3,250 USDT. The seller receives 6,000 USDT and the platform receives 750 USDT.

## 4. Commission shortfall — mandatory fail-closed case

Example: the administrative decision would otherwise allocate only 500 USDT of gross refund entitlement to the buyer, with 9,500 USDT to the seller, while the full commission remains 750 USDT.

That outcome cannot satisfy the buyer-pays-full-fee rule without making the buyer's net refund negative:

- Buyer gross refund entitlement: 500 USDT
- Required full commission: 750 USDT
- Implied buyer net refund: -250 USDT — invalid

**Required behavior:** mark the allocation unresolvable / blocked and do not prepare or execute a Safe transfer. Do not:
- charge the seller the 250 USDT difference;
- create a new debt or separate payment obligation for the buyer;
- deduct more than the buyer's refund entitlement;
- reduce the commission below 750 USDT;
- silently alter the administrator's seller allocation.

The agreement and dispute policy must explicitly resolve this edge case before such a transaction can be funded or executed. Until then, this case is not eligible for settlement.

## 5. Required validation before Safe review

A future trusted server-side allocation validator must independently verify all of the following:

1. The original final agreed gross amount and its immutable agreement version/hash.
2. The verified deposit amount and Safe address on BNB Smart Chain.
3. The exact fee rate and agreed rounding rule; calculate the fee from the original gross amount, not from the seller payout or buyer refund.
4. The administrator's finalized, reasoned decision and its immutable decision reference/hash.
5. `platformFee === F`.
6. `buyerRefund >= 0`, `sellerPayout >= 0`, and all values use integer USDT base units.
7. The buyer's gross refund entitlement is `buyerRefund + platformFee`.
8. `sellerPayout + buyerRefund + platformFee === verified deposit amount`.
9. No fee shortfall exists; the net buyer refund is never negative.
10. Recipients are the verified buyer, seller and platform addresses bound to this deal.
11. No open dispute, unresolved Guard failure, or other fail-closed condition permits settlement.
12. The exact proposed Safe transaction matches this validated allocation; the decision itself never signs or executes a transfer.

The ordinary successful-completion path remains 92.5% seller / 7.5% platform. A deal that has ever entered dispute must not return to the ordinary payout helper; it must use the finalized dispute-decision allocation path.

## 6. Current sandbox implementation gap

At the time this matrix was added:

- `validateDisputeAllocation` checks only that buyer refund + seller payout + platform fee equals the supplied total.
- `prepareDisputePayout` accepts the platform fee as an explicit decision amount and does not independently recompute 7.5% from the original agreed gross amount.
- The current payout input does not carry the immutable original gross amount/agreement fee basis needed to independently calculate the commission.
- Existing tests still include dispute examples with arbitrary platform fees and a full-refund example with a zero platform fee. Those fixtures do not conform to the newly approved commission rule and must be revised before claiming code-level enforcement.

Therefore, **the approved commission rule is not yet enforced by the sandbox payout code**. A separate implementation change must add the trusted original gross fee basis, recompute the exact fee, validate the net-refund representation and shortfall blocker, update tests, and pass CI. This document-only change does not perform that implementation.

## 7. Safety boundary

This matrix does not connect to Supabase, a wallet, Safe, BNB Chain RPC, or production funds. It does not create, sign, submit, or execute a transaction. The existing isolated PR remains a draft and must not be merged or deployed on the basis of this document.
