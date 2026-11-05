# W3M Protocol V1 — BNB ERC-20 Revenue Adapter

**Status:** Read-only verifier and unit tests added to the isolated branch.
**Production impact:** None. No RPC provider is configured, no live revenue query was made, and no transaction is submitted.

## Scope

The first revenue adapter verifies a narrowly defined claim:

> The sum of successful, canonical ERC-20 Transfer logs for one deal-pinned token contract, received by a deal-pinned set of revenue addresses within a specified block range, equals the seller's declared raw token amount.

It does not prove that a transfer was commercial revenue, does not discover undisclosed wallets, and does not cover native BNB transfers, DEX swaps, exchange balances, fiat sales, or arbitrary custom contract events. Those require separate, explicitly configured adapters and evidence rules.

## Implementation

- Adapter: `supabase/functions/w3m-acquisition-verification/bnb-revenue-adapter.ts`
- Tests: `supabase/functions/w3m-acquisition-verification/bnb-revenue-adapter.test.ts`
- Decision engine: `REVENUE_VERIFICATION` is a conditional evidence type. It is not globally mandatory for every listing. A deal must explicitly require it when the agreed scope includes on-chain revenue claims.

## Verification procedure

1. Check RPC chain ID against the deal-pinned chain (BNB Smart Chain mainnet 56 or testnet 97).
2. Check the requested block range is not beyond the chain head and does not exceed the hard maximum scan window.
3. Query only the pinned token contract and ERC-20 Transfer event signature, filtered to the agreed recipient addresses.
4. Validate log structure, token address, recipient, sender exclusions, transaction hash, block number, and log index.
5. Deduplicate by transaction hash + log index.
6. Fetch each transaction receipt and require success, exact transaction hash, exact block number, and matching block hash.
7. Fetch the canonical block and compare its hash with the log/receipt block hash.
8. Enforce the deal-configured minimum confirmation count.
9. Sum token amounts as uint256 raw units using BigInt; compare exactly with the declared raw amount.
10. Produce a SHA-256 proof manifest including chain, token, recipients, excluded senders, block range, head block, confirmation policy, declared and observed amounts, and receipt references.

The adapter returns:
- `PASS` when the confirmed, canonical receipts exactly match the declared raw amount.
- `INCOMPLETE` while any included receipt has fewer than the required confirmations.
- `BLOCKED` for amount mismatch, failed receipts, removed logs, or block-hash mismatch.
- An adapter error for malformed RPC responses, chain mismatch, or invalid configuration.

## Trust and configuration boundaries

- RPC URL and allowed hostname list must be server-side configuration; never accept an arbitrary RPC URL from a browser.
- Use HTTPS and exact hostname allowlisting.
- Revenue recipients, token contract, excluded senders, block range, expected chain, minimum confirmations, and declared raw amount must be pinned to the deal's accepted terms.
- The excluded sender list is part of the proof manifest. It is not a substitute for a complete wallet inventory.
- A trusted server-side agreement adapter must establish that both parties accepted the revenue scope. The boolean `scopeConfirmed` passed to the evidence mapper must come from that trusted agreement result, not client input.
- Token decimals and fiat valuation are deliberately not inferred. The raw amount is exact; any human-readable or USD conversion requires separately verified token metadata and a timestamped price source.
- A provider returning logs is not by itself proof of finality. The adapter checks canonical block hashes and a configured confirmation threshold, but chain-specific finality policy still needs to be defined by the integration.

## Conditional decision-engine integration

The decision engine now recognizes `REVENUE_VERIFICATION`. Deals that require revenue verification must include it in their explicit `requiredEvidenceTypes` list. The evidence is rejected unless:
- Adapter status is PASS.
- The deal-approved revenue scope is confirmed.
- Actual and declared raw amounts match.
- Chain, token address, block range, and confirmation policy are present and valid.

For projects without an on-chain revenue claim, this evidence type remains conditional and is not required by default.

## Not implemented

- No live RPC provider or API key is configured.
- No on-chain data was fetched for a real project.
- No wallet ownership or legal ownership is inferred from receiving tokens.
- No native BNB, exchange, DEX, off-chain, or custom event revenue adapter is implemented.
- No database persistence, webhook, scheduled polling, Deal Room integration, or Safe gate integration is active.
