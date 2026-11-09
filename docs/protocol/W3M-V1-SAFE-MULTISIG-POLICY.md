# W3M Protocol V1 — Safe Multisig Policy

**Status:** Approved product and protocol decision  
**Version:** V1  
**Decision:** Dedicated deal Safe with three owners and a 2-of-3 execution threshold

## 1. Owner set

Every V1 deal Safe is created with exactly these three distinct owners:

1. **Buyer** — the buyer's verified wallet.
2. **Seller** — the seller's verified wallet.
3. **Platform** — the designated Web3Market platform wallet.

The deployment account must be separate from all three Safe owners.

## 2. Signing threshold

The approved V1 default is **2-of-3**. Any Safe transaction requiring execution must receive valid confirmations from at least two of the three owners.

No single owner can execute a transaction alone. The third owner does not need to sign every transaction when the other two valid confirmations are present.

## 3. Deployment and verification requirements

- Resolve buyer and seller wallets from verified server-side profile records; do not trust owner addresses supplied by the browser.
- Validate that all three owner addresses are valid and distinct, case-insensitively.
- Create the Safe with the exact approved owner set and threshold 2.
- Verify deployed bytecode, exact on-chain owner set, and on-chain threshold before marking deployment as successful.
- Fail closed: if deployment or verification cannot be completed, block the release path and do not represent the Safe as verified.
- Display the actual on-chain owner count and threshold in Deal Room; do not substitute hard-coded display values for live verification.
- Record the Safe address and deployment transaction reference with the deal.

## 4. Funds and scope

- Deal funds move through the deal's Safe only.
- V1 does not introduce a separate W3M escrow smart contract.
- Safe deployment itself must not transfer deal USDT.
- Release and refund transactions remain subject to Safe permissions and the required Safe confirmations.
- The platform fee and seller share are governed by the separately approved V1 settlement policy; this document does not change the 7.5% platform fee.

## 5. Change control

This is the approved V1 default and is not an invitation to select a different threshold per deal. Any change to the owner set or threshold policy requires a separately recorded, explicit product approval and a versioned protocol change.

## 6. Acceptance criteria

- [ ] Unit tests prove owner role ordering and the 2-of-3 default.
- [ ] Unit tests reject malformed or duplicate owner addresses.
- [ ] Deployment uses the shared policy module.
- [ ] Deployment verification confirms the exact on-chain owner set and 2-of-3 threshold.
- [ ] Deal Room validates live Safe bytecode, owners, and threshold before allowing release.
- [ ] Relevant CI checks pass on the reviewed commit.
- [ ] No production deployment or fund movement is performed as part of this code change.
