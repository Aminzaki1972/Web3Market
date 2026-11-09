# W3M Protocol V1 — Safe Authenticity Verification

**Status:** Specification / implementation gate  
**Scope:** Isolated W3M Protocol V1 branch only  
**Production impact:** None. This document does not authorize deployment, Safe creation, wallet signing, transactions, or fund movement.

## 1. Objective

The Safe verification path must establish that a deal's Safe address is a genuine, approved Safe deployment before the protocol accepts its owner set, threshold, nonce, or any later settlement-related state.

Checking only that bytecode exists, that `masterCopy()` returns an expected address, or that `getOwners()` and `getThreshold()` return expected values is insufficient to establish contract authenticity.

## 2. Verified upstream reference

The official Safe Smart Account repository's immutable `v1.4.1` source defines `SafeProxy` with the singleton in storage slot 0. Its fallback reads slot 0, handles the `masterCopy()` selector (`0xa619486e`), and delegates other calls to that address.

The official `v1.4.1` changelog identifies:
- Solidity compiler: `0.7.6`
- Optimizer: disabled
- Safe singleton (EVM): `0x41675C099F32341bf84BFc5382aF534df5C7461a`
- SafeL2 singleton (EVM): `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`
- SafeProxyFactory (EVM): `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`

Upstream references:
- https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxy.sol
- https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxyFactory.sol
- https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/CHANGELOG.md
- https://docs.safe.global/reference-smart-account/deployment/SafeProxy

These references establish source-level behavior and release metadata. They do **not**, by themselves, establish the deployed BNB Chain bytecode hashes.

## 3. Required authenticity checks

The verifier must fail closed unless all checks pass:

1. **Network:** RPC chain ID is exactly BNB Smart Chain mainnet `56`.
2. **Proxy code:** Safe address has non-empty deployed bytecode.
3. **Proxy identity:** runtime bytecode matches a reproducibly derived, explicitly approved SafeProxy runtime artifact for the accepted release/build profile.
4. **Singleton storage:** `eth_getStorageAt(safe, 0x0)` resolves to the approved singleton address.
5. **Singleton getter:** `masterCopy()` (`0xa619486e`) returns the same approved singleton address.
6. **Singleton code:** singleton has non-empty bytecode and its runtime bytecode matches the approved, reproducibly derived singleton artifact.
7. **Policy:** only after authenticity passes, verify the exact three expected owners and threshold 2.
8. **Deal context:** retain all existing participant, wallet, chain, and platform-wallet checks.

The slot value is a 32-byte word; decode the low 20 bytes as the EVM address. The getter and storage value must agree exactly after address normalization.

## 4. Hash provenance — unresolved blocker

Do not hardcode a proxy or singleton code hash until it has been derived and independently checked from the official `v1.4.1` release artifacts.

The derivation record must include:
- immutable upstream tag and commit;
- exact compiler version and build metadata;
- optimizer and metadata settings;
- exact source set and dependency lock;
- artifact path and deployed/runtime bytecode distinction;
- hash algorithm (Keccak-256, not standardized SHA3-256);
- independently reproduced hash;
- comparison against deployed bytecode from a trusted BNB Chain RPC and/or verified explorer source.

The source release changelog confirms compiler 0.7.6 and optimizer disabled, but the repository tag does not contain the compiled artifact at the expected Hardhat artifact paths. Therefore no code hash is approved by this document.

**Until this provenance is complete, the authenticity gate is not production-ready.** Do not substitute a guessed hash, a creation-bytecode hash, a proxy address, or a test fixture such as `0x60006000`.

## 5. Required negative tests

The isolated verifier test suite must include:
- correct owners and threshold with counterfeit proxy runtime code → reject;
- correct proxy runtime but wrong slot(0) singleton → reject;
- correct slot(0) but mismatched `masterCopy()` → reject;
- expected singleton address with counterfeit singleton runtime → reject;
- empty proxy code or empty singleton code → reject;
- wrong chain ID → reject before accepting any Safe state;
- valid approved proxy + singleton + exact owners + threshold 2 → accept;
- legacy or unsupported Safe implementation → reject unless separately approved through an explicit V1 policy revision.

Tests must use authentic fixture bytecode derived from the approved artifact. A short arbitrary bytecode string must never serve as the positive authenticity fixture.

## 6. Error contract

Use a stable fail-closed status such as `SAFE_AUTHENTICITY_UNVERIFIED` for any missing, malformed, mismatched, or unavailable authenticity evidence. Do not return a release permission flag. A successful authenticity result is not authorization to release funds; settlement remains subject to the separately approved Safe transaction and signature workflow.

## 7. Current implementation status

The existing V1 verifier checks deployed code presence, owners, threshold, nonce, chain, and expected deal context. Its current positive unit fixture is not authentic Safe bytecode. Proxy runtime identity and singleton runtime identity are not yet enforced.

Accordingly:
- Safe 2-of-3 policy enforcement remains a separate implemented check.
- Safe authenticity remains an open V1 security requirement.
- This document records the fail-closed requirement; it does not claim the code change is implemented or tested.
- No production deployment, Safe deployment, wallet signing, transaction, or fund movement is authorized.
