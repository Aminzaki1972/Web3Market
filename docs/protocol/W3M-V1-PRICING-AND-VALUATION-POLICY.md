# W3M V1 — Pricing, valuation, and platform-fee policy

Status: approved product rule for the staged W3M V1 implementation. This document records the commercial decision; it is not a substitute for legal review or the final signed acquisition terms.

## 1. Seller asking price and AI valuation are separate

- The seller remains responsible for choosing and publishing the asking price.
- W3M may display an evidence-based estimated value and a valuation range as buyer guidance.
- The valuation view should distinguish the estimated value/range, seller asking price, price position relative to the estimate, confidence, and missing evidence.
- A high asking price may receive a clear informational warning and request for supporting rationale. The estimate does not automatically cap, reject, or change the seller's price.
- AI output is indicative only, not a guaranteed market value, appraisal, offer, or binding determination.
- The deterministic valuation calculation remains the source of numeric calculations. Gemini may assist with analysis and explanation only where a no-cost quota is available. If the free quota is unavailable, the deterministic valuation and its evidence/confidence disclosures must continue to work without a paid fallback. Do not enable paid API usage or incur a charge automatically.
- The valuation feature is marketplace intelligence, not a new mandatory condition of W3M V1 agreement acceptance or Safe settlement.

## 2. Platform fee basis — Option A approved

- The W3M V1 platform success fee remains 7.5%.
- The fee is calculated on the final transaction consideration agreed by buyer and seller, after any negotiated discount, represented by `consideration.amount` in the canonical acquisition terms.
- The fee is deducted from that total consideration before the seller payout. It is not added on top as an additional buyer charge.
- `seller_net.amount` must equal `consideration.amount - platform_fee.amount`, in the same currency.
- The platform fee amount must equal 7.5% of `consideration.amount`, rounded half-up at the declared decimal precision. Existing exact-decimal validation enforces the arithmetic and rejects mismatched fee/net splits.
- The asking price before discount is retained as listing/negotiation information only; it is not the fee base.

### Example

| Item | Amount |
|---|---:|
| Seller asking price | $30,000.00 |
| Final agreed consideration paid by buyer | $20,000.00 |
| W3M fee (7.5% of $20,000) | $1,500.00 |
| Seller net from the consideration | $18,500.00 |

No extra $1,500 is charged on top of the buyer's $20,000 consideration.

## 3. Implementation boundary

- The canonical terms validator must continue to derive/validate the fee against `consideration.amount`, not the seller's asking price.
- The final agreement display must label the amount clearly as the final agreed consideration and show the platform fee deduction and seller net separately before both parties sign.
- Any change to these commercial rules requires explicit product-owner approval and a new canonical terms version/hash before acceptance.
- This policy and its regression test are staged on the W3M V1 feature branch only. They do not authorize merging, production deployment, database migration, Safe transactions, or payment execution.
