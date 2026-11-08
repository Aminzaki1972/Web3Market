# W3M Standard Acquisition Agreement — V1
## Consolidated working draft for product-owner and legal review

**Status:** Working draft only. Not published canonical terms, not legally approved, and not enabled for digital signing or settlement. This document consolidates approved product decisions and identifies unresolved inputs; it does not create new legal commitments.

## Article 1 — Parties and Deal Identification
The buyer and seller are the parties identified in the relevant Web3Market deal record. The record must identify their platform accounts and verified wallets used for protocol acceptance. It must identify the deal, project, agreement version, and acceptance date. Web3Market provides the platform workflow and is not automatically a buyer, seller, agent, legal representative, or party to the asset sale.

## Article 2 — Subject of the Transaction
The seller proposes to transfer and the buyer proposes to acquire only the project assets, rights, and deliverables expressly listed in the deal-specific Transaction Schedule. General project descriptions or mutable profile fields do not independently add assets to the transfer scope. Included items and exclusions must be identified clearly.

## Article 3 — Assets and Transfer Scope
The schedule must itemize each asset with an identifier, description, transfer method, expected evidence, and acceptance status. Relevant items may include domains, source-code repositories and commits, hosting, applications, intellectual property, licences, accounts, documentation, and other deliverables. Credentials, private keys, and recovery phrases must never be placed in public notes or evidence URLs. Scope changes require agreement and, where canonical terms are affected, a new version and fresh acceptance.

## Article 4 — Seller Responsibilities
The seller must provide accurate deal information, identify included assets and exclusions, perform the transfers assigned to the seller in the accepted schedule, and provide the agreed evidence for each asset. The seller must disclose material ownership, authority, third-party consent, licence, restriction, or limitation issues relevant to included assets. Any warranties, remedies, and liability terms require explicit completion and legal review; this draft does not invent them.

## Article 5 — Buyer Responsibilities
The buyer must review the deal information and schedule, provide the agreed consideration through the agreed settlement route, and review each delivered asset within any inspection period expressly selected for that deal. The buyer records acceptance or rejection for each asset through the Deal Room and provides a reason when rejecting. Final delivery confirmation is separate from asset-level acknowledgements. Additional buyer warranties or liability terms require explicit completion and legal review.

## Article 6 — AI Passport and Technical Audit
AI Passport and audit information are platform-generated information to assist review. Where bound to a deal, the protocol records the audit identity, repository and commit fingerprint, and binding evidence. An AI Passport, score, risk label, or automated analysis is not a guarantee of ownership, legal title, security, quality, profitability, completeness, or future performance, and does not replace buyer due diligence.

## Article 7 — Transaction Consideration and Platform Success Fee
1. The seller determines the asking price. The parties may adjust it or apply a discount before approving the final transaction consideration.
2. The final transaction consideration is the amount agreed by buyer and seller after agreed discounts and must be recorded before settlement.
3. Web3Market's success fee is **7.5% of the final transaction consideration**. It is deducted from the total consideration paid by the buyer and is not added as an extra charge.
4. The seller is entitled to the remaining net consideration after deduction of the platform fee. Settlement uses the currency specified for that deal.
5. Before settlement, both parties must review and approve the final consideration, platform-fee percentage, and seller net proceeds.
6. The final consideration, platform fee, and seller net proceeds are recorded in the deal record for review and verification.
7. Any price estimate or valuation range from Web3Market tools is non-binding guidance. It does not change the parties' agreed price or require either party to complete the transaction.

## Article 8 — Safe Wallet and Settlement
The V1 deal settlement workflow uses Safe Wallet multisignature functionality. V1 does not introduce or rely on a separate platform-operated escrow smart contract. The Safe configuration, owners, threshold, transaction details, and required approvals must be verified in the deal workflow. Web3Market must not represent that it can unilaterally control or release assets held by a Safe. Settlement through the platform workflow requires the applicable agreement, funding, asset-delivery, acceptance, dispute, and transaction-verification gates to pass. A database or interface status alone is not proof of on-chain settlement. The deal schedule must specify the network, settlement asset, Safe address, verified owners and threshold, funding route, approvals, and release conditions. This draft authorizes no real transfer.

## Article 9 — Asset Delivery and Evidence
The seller delivers each included asset using the method recorded for that asset. Each asset requires its own delivery record and evidence, including its identifier, status, delivery reference, delivering party, and timestamps. Evidence must not contain secrets. The buyer may accept or reject each delivered asset individually; acceptance of one asset does not accept another. Platform records evidence workflow events but do not independently determine title or guarantee completion by an external provider.

## Article 10 — Optional Inspection Period
The parties may choose an inspection period. If selected, its duration, start event, scope, acceptance criteria, and permitted testing must be expressly recorded before agreement acceptance. If not selected, this Article creates no additional inspection period. No default duration or criteria are implied.

## Article 11 — Rejection and Disagreement About Delivery
The buyer records rejection and its reason against the relevant asset in the Deal Room. The first step is direct resolution between buyer and seller through the Deal Room. They may agree on corrective delivery, additional evidence, replacement, adjustment, or another mutually accepted resolution, recorded in the deal. If direct resolution fails, the parties follow the escalation procedure expressly selected and recorded for that deal before signing. This draft does not appoint Web3Market as arbitrator or adjudicator, and does not invent an automatic refund, forfeiture, or remedy. An unresolved rejection or dispute blocks the applicable platform release gate. Rights outside the platform remain subject to the final contract and applicable law.

## Article 12 — Final Delivery Confirmation
After each included asset has been delivered and the buyer has recorded the required asset-level acceptance, the buyer provides a separate final confirmation that the complete agreed scope has been received. The final confirmation is linked to the accepted asset list and evidence history. Missing acceptance, unresolved rejection, an open dispute, or a mismatch with the accepted schedule prevents the platform from treating delivery as complete for settlement-gate purposes.

## Article 13 — Role of Web3Market
Web3Market provides marketplace discovery, deal-room coordination, technical records, agreement-version and acceptance workflows, delivery evidence, and the Safe-related workflow described in the protocol. It is not automatically a party to the sale, custodian of Safe assets, guarantor of either party, guarantor of project quality or ownership, or independent dispute adjudicator. Platform records support verification of recorded events and do not replace the parties' responsibilities.

## Article 14 — Governing Law and Dispute Forum
The governing law and any court, venue, arbitration, or other dispute forum must be expressly selected by the parties for the deal and recorded in the schedule before canonical publication and acceptance. This draft selects no country, court, arbitration institution, venue, or process. If required fields are incomplete, the agreement must not be published for acceptance. The completed clause requires local legal review.

## Article 15 — Digital Acceptance, Versioning, and Evidence
The agreement presented to the parties must be a canonical server-published version with a stable version identifier and cryptographic hash. Buyer and seller must accept the same version and hash. When enabled after final approval, acceptance uses the verified-wallet digital-signature flow; the server validates participant, role, wallet, deal, terms version/hash, applicable audit binding, signature, nonce, and deadline. A legacy timestamp acknowledgement is not a substitute for V1 cryptographic acceptance. Any canonical change requires a new version/hash and fresh acceptance by both parties. This draft does not publish canonical terms, issue signing challenges, enable EIP-712 signing, or authorize Safe transactions.

---

## Transaction Schedule — Deal-specific inputs

**A. Deal and parties:** deal identifier; project identifier/name; buyer and seller identities; verified wallets; server-assigned agreement version/hash.

**B. Assets and delivery:** itemized asset identifiers/descriptions; included items and exclusions; transfer method and responsible party for each asset; expected evidence; any agreed deadlines and acceptance criteria; final delivery confirmation.

**C. Commercial terms:** seller asking price; agreed discount, if any; final agreed consideration; currency; platform success-fee rate (**7.5%**); calculated platform-fee amount; seller net proceeds; buyer and seller approval states/timestamps. The platform fee is 7.5% of final consideration; seller net is final consideration less platform fee. Apply the deal currency and canonical decimal precision/rounding rules. No illustrative or hypothetical amounts belong in this Agreement.

**D. Settlement:** network and settlement asset; Safe address; verified Safe owners and threshold; funding and settlement route; required approvals; release conditions; transaction evidence references.

**E. Inspection and dispute choices:** whether an inspection period is included; if so, duration, start event, scope and criteria; rejection/direct-resolution process; escalation procedure if direct resolution fails; any agreed deadlines or remedies after legal review.

**F. Legal and disclosures:** governing law; court/venue/arbitration or other forum if selected; ownership, licence, third-party consent, privacy/data and material risk disclosures; contract language; additional deal-specific terms expressly approved by both parties.

---

## Publication and activation gates
1. Complete deal-specific inputs from authoritative sources; do not infer them from mutable project descriptions.
2. Resolve all legal and commercial choices, especially governing law/forum and escalation after direct resolution.
3. Obtain local legal review of the complete agreement and schedule.
4. Verify consistency with Deal Room, asset evidence, acceptance ledger, and Safe finalization gates.
5. Publish an immutable server-owned canonical version and hash only after approval.
6. Require both parties to accept the same version/hash through the approved digital-signature flow.

This is a working draft only. It authorizes no production database changes, migration, deployment, signing activation, Safe execution, or financial transfer.
