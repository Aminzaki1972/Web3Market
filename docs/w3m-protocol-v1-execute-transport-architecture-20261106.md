# W3M Protocol V1 — Non-custodial Safe EXECUTE transport decision

**Branch:** `w3m-protocol-v1-isolated-20261105`  
**Status:** Architecture decision draft; isolated only; not deployed  
**Decision:** Safe execution must be submitted through an explicitly connected Safe owner wallet unless a separately approved, funded relayer is later designed. The protocol must not introduce a server-held private key.

## 1. Why the HTTP EXECUTE boundary is not yet a complete executor

The isolated code now has:
- a fail-closed authenticated HTTP request boundary accepting only `deal_id`;
- fresh deal/payment/delivery/dispute/policy/agreement snapshot validation;
- canonical BNB Safe facts and recomputed Safe transaction hash checks;
- exact MultiSend transfer payload validation;
- current Safe owner/threshold signature recovery;
- atomic execution-attempt claim and broadcast-hash persistence;
- reconciliation-required handling for uncertain outcomes;
- an independent receipt-based FINALIZE path.

The coordinator deliberately receives a `broadcast` callback from a trusted server adapter. No approved, non-custodial server broadcast transport is currently implemented. The server has no approved private key and must not be given one merely to make the callback compile.

A Safe transaction's owner signatures authorize the Safe call, but they are not a signed outer BNB transaction. Someone still has to pay gas and submit `execTransaction`. A server cannot safely call `eth_sendTransaction` without a wallet/key provider, and a public JSON-RPC endpoint cannot sign transactions.

Therefore, the current HTTP boundary is a request boundary, not a production executor. Do not claim that it broadcasts transactions.

## 2. Recommended V1 transport: connected owner wallet

Keep custody and gas authorization with the user-controlled wallet:

1. The authenticated caller requests an execution package for one `deal_id`.
2. The server reloads the canonical deal, latest W3M report, payment, buyer acceptance, dispute state, locked policy, immutable agreement signatures, Safe transaction, current Safe owners/threshold/nonce, and all stored Safe signatures.
3. The server recomputes the Safe EIP-712 hash and validates the exact MultiSend payload and all current owner signatures.
4. The server returns a minimal, short-lived execution package containing only the exact Safe call fields and the verified, owner-sorted Safe signature bytes. It returns no secret and never signs an outer transaction.
5. The browser displays the exact Safe and token-transfer summary. The user explicitly confirms in their connected wallet.
6. The connected wallet submits the Safe `execTransaction` call on BNB Chain 56. The browser does not construct or alter the Safe transaction fields.
7. The browser sends the resulting outer BNB transaction hash to the authenticated server.
8. The server independently fetches the receipt from the allowlisted public BNB RPC, checks canonical block/confirmations, Safe `ExecutionSuccess`, absence of `ExecutionFailure`, and the exact two Safe-originating token transfers.
9. Only the receipt verifier may call the atomic FINALIZE RPC.

This is non-custodial: the wallet signs and pays gas; the server only verifies and records.

## 3. Required controls before implementation

- The execution package must be bound to the authenticated actor, deal ID, immutable terms version/hash, report ID/version, Safe address, Safe transaction hash, nonce, exact payload hash, current owner set, and current signature-set hash.
- The package must be short-lived and one-use. A stale package must be rejected.
- Before wallet submission, the client must re-fetch the package; it must not reuse cached transaction fields.
- The server must persist an execution attempt before returning a package. A duplicate request must return the existing attempt state, never create a competing attempt.
- A wallet cancellation, timeout, page close, or unknown RPC response must not release the claim automatically. It enters reconciliation.
- Recovery may release a claim only after a trusted canonical-chain check proves the Safe nonce has not advanced and there is no matching Safe execution event or transaction. If that proof is unavailable, keep the attempt blocking.
- The submitted outer transaction hash is untrusted input until the server verifies its receipt and exact Safe event/log semantics.
- Finalization must remain a separate endpoint and must never be triggered by a browser success flag.
- The UI must clearly identify the wallet that pays gas and the exact Safe address; no hidden relayer or server signer.

## 4. Why not silently add a relayer

A relayer requires a separately governed gas payer, key custody, funding limits, nonce management, operational monitoring, emergency revocation, and replay protection. It may introduce recurring cost. No relayer is assumed or enabled in V1.

## 5. Current completion boundary

| Component | State |
|---|---|
| Authenticated EXECUTE request boundary | Implemented; CI passed |
| Fresh W3M/Safe authorization primitives | Implemented in isolated modules; CI passed |
| Atomic execution-attempt claim and state transitions | Isolated SQL draft; disposable PostgreSQL tests passed |
| Non-custodial wallet execution package endpoint | Not implemented |
| Deal Room wallet submission UI | Not implemented |
| Outer BNB receipt verification | Implemented as isolated verifier; mocked tests passed |
| Atomic FINALIZE endpoint/RPC | Implemented as isolated draft; not deployed |
| Production wiring/deployment | Not approved; not performed |

## 6. Safety boundary

This decision does not change the live Deal Room, Safe, wallets, funds, Supabase production database, deployed Edge Functions, or Cloudflare. All artifacts remain on the isolated branch. No user wallet is prompted to sign and no transaction is broadcast by this work.
