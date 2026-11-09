# W3M Protocol V1 — Safe Authenticity Verification

**Status:** Specification / implementation gate  
**Scope:** Isolated W3M Protocol V1 branch only  
**Production impact:** None. This document does not authorize deployment, Safe creation, wallet signing, transactions, or fund movement.

## 1. Objective

The Safe verification path must establish that a deal's Safe address is a genuine, approved Safe deployment before the protocol accepts its owner set, threshold, nonce, or any later settlement-related state.

Checking only that bytecode exists, that `masterCopy()` returns an expected address, or that `getOwners()` and `getThreshold()` return expected values is insufficient to establish contract authenticity.

## 2. Verified upstream release and deployment registry

The official Safe Smart Account repository's immutable `v1.4.1` source defines `SafeProxy` with the singleton in storage slot 0. Its fallback reads slot 0, handles the `masterCopy()` selector (`0xa619486e`), and delegates other calls to that address.

The official `v1.4.1` changelog identifies:
- Solidity compiler: `0.7.6`
- Optimizer: disabled
- Safe singleton (EVM): `0x41675C099F32341bf84BFc5382aF534df5C7461a`
- SafeL2 singleton (EVM): `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`
- SafeProxyFactory (EVM): `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`

The official Safe Deployments registry's `src/assets/v1.4.1/safe.json` maps BNB Chain ID `56` to the canonical deployment and publishes the canonical Safe singleton runtime code hash:
`0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4`.

The corresponding `safe_proxy_factory.json` publishes the canonical SafeProxyFactory runtime code hash:
`0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317`.

Registry provenance inspected:
- Safe Deployments repository commit: `ca9cb0d2d5f5175fc8e41d579f356748d2bc1c62` (GitHub reports commit signature verified)
- `safe.json` blob: `7e39331a4142d8c74f04d4c97c3329a48fa32e64`
- `safe_proxy_factory.json` blob: `e4dd90962c82f52df9b76f8bb6ff28b93d721948`

Upstream references:
- https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxy.sol
- https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/contracts/proxies/SafeProxyFactory.sol
- https://github.com/safe-fndn/safe-smart-account/blob/v1.4.1/CHANGELOG.md
- https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/safe.json
- https://github.com/safe-global/safe-deployments/blob/main/src/assets/v1.4.1/safe_proxy_factory.json
- https://docs.safe.global/reference-smart-account/deployment/SafeProxy

**Important distinction:** The published singleton and factory hashes are registry-backed. The SafeProxy runtime hash is not published in these two registry assets and remains unapproved. Do not treat the factory hash as the proxy hash.

## 3. Required authenticity checks

The verifier must fail closed unless all checks pass:

1. **Network:** RPC chain ID is exactly BNB Smart Chain mainnet `56`.
2. **Proxy code:** Safe address has non-empty deployed bytecode.
3. **Proxy identity:** runtime bytecode matches a reproducibly derived, explicitly approved SafeProxy runtime artifact for the accepted release/build profile.
4. **Singleton storage:** `eth_getStorageAt(safe, 0x0)` resolves to the approved singleton address.
5. **Singleton getter:** `masterCopy()` (`0xa619486e`) returns the same approved singleton address.
6. **Singleton code:** singleton has non-empty deployed bytecode and its Keccak-256 hash equals the registry-published canonical hash above.
7. **Factory provenance:** where available, establish that the proxy was created by the canonical SafeProxyFactory whose code hash matches the registry-published hash. Event/log evidence alone must not replace checking the factory's own runtime code.
8. **Policy:** only after authenticity passes, verify the exact three expected owners and threshold 2.
9. **Deal context:** retain all existing participant, wallet, chain, and platform-wallet checks.

The slot value is a 32-byte word; decode the low 20 bytes as the EVM address. The getter and storage value must agree exactly after address normalization.

## 4. Remaining hash provenance blocker — SafeProxy

The singleton hash and factory hash are now backed by the official Safe Deployments v1.4.1 registry. The SafeProxy runtime hash is still unresolved.

Before approving a proxy hash, the derivation record must include:
- immutable Safe Smart Account tag and commit;
- exact compiler version and build metadata;
- optimizer and metadata settings;
- exact source set and dependency lock;
- artifact path and deployed/runtime bytecode distinction;
- Keccak-256 hash (not standardized SHA3-256);
- independently reproduced hash;
- comparison against deployed bytecode from a trusted BNB Chain RPC and/or verified explorer source.

The Safe v1.4.1 release source and changelog confirm compiler 0.7.6 and optimizer disabled, but the tag does not contain compiled Hardhat artifacts at the expected artifact paths. No SafeProxy runtime hash is approved yet.

**Until the SafeProxy hash provenance is complete, the authenticity gate is not production-ready.** Do not substitute a guessed hash, a creation-bytecode hash, the factory hash, a proxy address, or a test fixture such as `0x60006000`.



### Reproducible SafeProxy build inputs now pinned

The immutable upstream Safe Smart Account tag resolves to commit:
`bf943f80fec5ac647159d26161446ac5d716a294`.

The exact v1.4.1 SafeProxy source was retrieved from that tag:
- Source path: `contracts/proxies/SafeProxy.sol`
- Git blob SHA: `eb21260363a19f1a35ef34e323761e63cf5600e3`

The same tag provides these build inputs:
- `package.json` blob SHA: `60d3217a6faebb34481fc14283c090f708f96438`; pins `solc` to `0.7.6`.
- `yarn.lock` blob SHA: `65b6b01c4461f9c129a5eeb8b0b3fe0ba43d97e9`.
- `hardhat.config.ts` blob SHA: `b8b99ba8b4117d3a8ae06e944535d650e8ce6e60`; compiler defaults to `0.7.6`, and artifact output is configured under `build/artifacts`.
- `.github/workflows/ci.yml` blob SHA: `da5282541de801f9e420d98219245370654c0174`; upstream CI uses Node `16.7.0`, `yarn --frozen-lockfile`, then `yarn build`.

The release tree does not expose a committed `build/artifacts` directory at the expected path. The source and build recipe are now pinned, but that alone is not a compiled runtime artifact or an independently reproduced hash. The exact compiler metadata defaults, emitted deployed-bytecode artifact, and BNB Chain runtime comparison still need to be captured and reviewed before any proxy hash can be approved.

## 5. Required negative tests

The isolated verifier test suite must include:
- correct owners and threshold with counterfeit proxy runtime code → reject;
- correct proxy runtime but wrong slot(0) singleton → reject;
- correct slot(0) but mismatched `masterCopy()` → reject;
- expected singleton address with counterfeit singleton runtime → reject;
- singleton address with runtime code whose Keccak-256 differs from the registry hash → reject;
- empty proxy code or empty singleton code → reject;
- wrong chain ID → reject before accepting any Safe state;
- valid approved proxy + singleton + exact owners + threshold 2 → accept;
- legacy or unsupported Safe implementation → reject unless separately approved through an explicit V1 policy revision.

Tests must use authentic fixture bytecode derived from approved artifacts. A short arbitrary bytecode string must never serve as the positive authenticity fixture.

## 6. Error contract

Use a stable fail-closed status such as `SAFE_AUTHENTICITY_UNVERIFIED` for any missing, malformed, mismatched, or unavailable authenticity evidence. Do not return a release permission flag. A successful authenticity result is not authorization to release funds; settlement remains subject to the separately approved Safe transaction and signature workflow.

## 7. Current implementation status

The verifier in the isolated W3M branch has now been changed to fail closed with `SAFE_AUTHENTICITY_UNVERIFIED` after authentication, deal-participant, owner-record context, and BNB mainnet chain checks. It no longer reads Safe owners, threshold, nonce, or arbitrary bytecode and cannot return `verified: true` while the approved SafeProxy runtime hash is missing.

The prior positive integration fixture (`0x60006000`) was removed from the verifier tests. A regression test now confirms that the endpoint returns HTTP 503, `verified: false`, and `safe_policy_verified: false` until the authenticity artifact is approved. This is an intentional V1 safety block, not completed Safe verification.

Accordingly:
- Safe 2-of-3 policy construction and its separate unit tests remain implemented.
- The official singleton and factory hashes are documented from the Safe Deployments registry.
- SafeProxy runtime identity, singleton storage/getter cross-checks, singleton runtime hash enforcement, and factory provenance remain open V1 security requirements.
- Safe verification is currently deliberately unavailable; the Deal Room must keep the Safe verification-dependent flow blocked.
- CI has been triggered for the isolated PR head; its result must be checked before this change is described as tested.
- No production deployment, Safe deployment, wallet signing, transaction, or fund movement is authorized.
