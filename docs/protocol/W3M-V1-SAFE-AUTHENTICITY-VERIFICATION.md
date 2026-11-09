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

**Important distinction:** The official registry publishes the singleton and factory hashes, not the SafeProxy runtime hash. W3M has independently derived the SafeProxy runtime hash from the full pinned Safe v1.4.1 build and matched it against BNB Mainnet RPC. The W3M-derived proxy hash is recorded below; it is distinct from the factory hash.

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

## 4. SafeProxy runtime hash provenance — resolved

The singleton hash and factory hash are backed by the official Safe Deployments v1.4.1 registry. The SafeProxy runtime hash has now been reproduced from the full pinned upstream source build and matched against live BNB Mainnet runtime bytecode.

The approved proxy hash derivation record includes:
- immutable Safe Smart Account tag and commit;
- exact compiler version and build metadata;
- optimizer and metadata settings;
- exact source set and dependency lock;
- artifact path and deployed/runtime bytecode distinction;
- Keccak-256 hash (not standardized SHA3-256);
- independently reproduced hash;
- comparison against deployed bytecode from a trusted BNB Chain RPC and/or verified explorer source.

The full Safe v1.4.1 repository was checked out at immutable commit `bf943f80fec5ac647159d26161446ac5d716a294`, installed with its pinned Yarn lockfile, and built using the upstream `yarn build` command. The emitted SafeProxy deployed runtime is 171 bytes and its Keccak-256 hash is:

`0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c`.

The full upstream build used Solidity `0.7.6+commit.7338295f`, optimizer disabled, and the pinned SafeProxy source blob `eb21260363a19f1a35ef34e323761e63cf5600e3`. The full-build runtime hash matches the value returned by `eth_getCode` from BNB Mainnet for the SafeProxy sample below. A standalone Keccak implementation and viem's Keccak implementation also agree on this hash.

**W3M V1 SafeProxy runtime hash is approved as the expected runtime identity for Safe v1.4.1.** This approval is limited to this exact version/build profile and does not yet mean the production verifier has implemented the complete authenticity checks. Do not substitute a creation-bytecode hash, factory hash, or arbitrary test fixture such as `0x60006000`.



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

The release tree does not commit generated Hardhat artifacts. To reproduce the deployed runtime, CI checks out the complete upstream repository at the pinned commit, installs dependencies with `yarn --frozen-lockfile`, runs `yarn build`, then inspects the emitted build-info record. This reproduced the exact 171-byte runtime and hash.

### Independent explorer bytecode candidate — not yet approved

A Routescan explorer result exposes a source-verified contract named `SafeProxy` at:
`https://routescan.io/address/0xDce3902B257025A120771d46aF16cE8988fc81C1/contract/1/code`

The explorer result reports exact-match source verification, Solidity `0.7.6+commit.7338295f`, optimizer disabled, and a deployed-runtime-bytecode field. The URL's network identifier is `1` (Ethereum), not BNB Chain. The page also cannot currently be independently re-opened through the automated browser because it presents a JavaScript/anti-bot interstitial.

This is a useful candidate for a cross-check, but it is **not** accepted as the W3M SafeProxy runtime artifact because:
- it is not a BNB Chain runtime observation;
- the source/build metadata has not yet been independently matched byte-for-byte to the pinned Safe v1.4.1 source commit;
- its runtime code hash has not been independently calculated and reproduced;
- a separate BNB Chain candidate has now been read directly from a public BNB Mainnet RPC; see the next section.

Reference: Routescan source-verified SafeProxy explorer result. <https://routescan.io/address/0xDce3902B257025A120771d46aF16cE8988fc81C1/contract/1/code>

### BNB Chain explorer runtime candidate — confirmed and approved by RPC + full build

A BscScan-indexed BNB Smart Chain SafeProxy candidate was found at:
`0x91F10950303c6fdAC09c957ac7B1aae9A4B7F2e7`.

BscScan reports its parent creation transaction as originating from **Safe: Proxy Factory 1.4.1**, and reports:
- Contract label: `SafeProxy`
- Compiler: `0.7.6+commit.7338295f`
- Optimizer: disabled (explorer UI also displays the default 200-runs field)
- Deployed bytecode: 171 bytes
- ABI: constructor(address _singleton) and payable fallback

The explorer-rendered deployed runtime bytecode is:

```text
0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033
```

A standalone Ethereum Keccak-256 implementation calculated the candidate runtime hash as:

`0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c`

The implementation was sanity-checked against the canonical Keccak-256 empty-input vector:
`0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`.
This is Keccak-256, not FIPS SHA3-256.

Additional BNB explorer records show the same 171-byte runtime output and compiler profile for other SafeProxy contracts, including:
- `0x43101C27c4ea517cE195fdc752042396E5732328`
- `0x5e2faa3184244e2986cc31f3fd9cbeb79cfa9a93`
- `0xcAf15Ea620C9158Cd3214E00a204Cf3F32e45363`

Explorer references:
- https://bscscan.com/address/0x91f10950303c6fdac09c957ac7b1aae9a4b7f2e7
- https://bscscan.com/address/0x43101c27c4ea517ce195fdc752042396e5732328
- https://bscscan.com/address/0x5e2faa3184244e2986cc31f3fd9cbeb79cfa9a93
- https://bscscan.com/address/0xcaf15ea620c9158cd3214e00a204cf3f32e45363

**Status: runtime identity confirmed and approved for the v1.4.1 build profile.** The BNB Mainnet read-only check independently confirmed the runtime hash, official singleton hash, official factory hash, storage slot 0, and `masterCopy()` agreement. The full upstream build independently reproduced the same runtime hash. This approves the expected SafeProxy runtime hash as an authenticity input; the server verifier still needs to implement and test the complete checks before it may return a successful verification result.

### BNB Mainnet RPC confirmation — runtime candidate matched

A BNB Mainnet SafeProxy candidate at
`0x91F10950303c6fdAC09c957ac7B1aae9A4B7F2e7` was identified from BscScan. Its parent creation transaction is attributed by the explorer to Safe Proxy Factory 1.4.1. BscScan displays the same runtime bytecode for multiple SafeProxy records created through the v1.4.1 factory.

The candidate runtime hash was computed from the 171-byte explorer-rendered runtime as:
`0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c`.

A new read-only GitHub Actions check then independently queried BNB Mainnet RPC and confirmed:
- chain ID is `56`;
- `eth_getCode(proxy)` Keccak-256 equals the candidate hash above;
- the Safe singleton runtime hash equals the official registry hash `0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4`;
- the SafeProxyFactory runtime hash equals the official registry hash `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317`;
- `eth_getStorageAt(proxy, 0x0)` resolves to the official Safe v1.4.1 singleton `0x41675C099F32341bf84BFc5382aF534df5C7461a`;
- `masterCopy()` (`0xa619486e`) returns the same singleton address.

The check used only `eth_chainId`, `eth_getCode`, `eth_getStorageAt`, and `eth_call`. No transaction was signed or broadcast.

Read-only check:
- Workflow run: https://github.com/Aminzaki1972/Web3Market/actions/runs/42607447961
- A later run repeated the same BNB RPC check successfully: https://github.com/Aminzaki1972/Web3Market/actions/runs/42607586148

The hash was also calculated with a standalone Ethereum Keccak-256 implementation and cross-checked against the canonical empty-input Keccak-256 vector. The GitHub Actions read-only script uses viem's Keccak implementation and produced the same hash from live RPC bytecode.

The isolated single-file compile produced a different metadata-dependent hash and is not used as the approved artifact. The complete pinned upstream build resolved this difference and passed. Full build + RPC verification run:
https://github.com/Aminzaki1972/Web3Market/actions/runs/42607768554

The approved hash must now be integrated into the server verifier with runtime hash, singleton slot/getter, singleton code hash, and owner/threshold checks. Until that implementation and its negative/positive tests pass, keep `SAFE_AUTHENTICITY_UNVERIFIED` and the Deal Room fail-closed behavior unchanged.

### Latest Safe authenticity CI result

On code head `7caa7d1b4069c58e9cd4c35fa28d45c7c792f666`, GitHub Actions completed successfully:
- 42 tests passed, 0 failed.
- Safe policy/configuration type-check passed.
- BNB Testnet Safe reference check passed (read-only).
- BNB Mainnet SafeProxy runtime hash, Singleton hash, and Factory hash matched on-chain.
- Proxy storage slot 0 and `masterCopy()` both matched the official v1.4.1 Singleton.
- Full Safe v1.4.1 upstream build reproduced the exact 171-byte SafeProxy runtime and approved hash.

Run: https://github.com/Aminzaki1972/Web3Market/actions/runs/42607768554

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

The verifier in the isolated W3M branch still deliberately fails closed with `SAFE_AUTHENTICITY_UNVERIFIED` after authentication, deal-participant, owner-record context, and BNB mainnet chain checks. The approved SafeProxy hash is now available, but the endpoint does not yet execute the complete runtime, singleton, factory, owner, and threshold verification path.

The prior positive integration fixture (`0x60006000`) was removed from the verifier tests. A regression test confirms that the endpoint returns HTTP 503, `verified: false`, and `safe_policy_verified: false` until the complete authenticity implementation is added and tested. This remains an intentional V1 safety block.

Accordingly:
- Safe 2-of-3 policy construction and its separate unit tests remain implemented.
- The official singleton and factory hashes are documented from the Safe Deployments registry.
- SafeProxy runtime identity, singleton storage/getter agreement, and singleton/factory runtime hashes now have reproducible evidence and a successful read-only BNB Mainnet CI check.
- Remaining implementation work: integrate these checks into `w3m-safe-verify`, then verify the exact three owners and threshold 2 only after authenticity passes; add positive and negative tests using the approved runtime fixture.
- Safe verification remains deliberately unavailable until that implementation is complete; the Deal Room must keep the Safe verification-dependent flow blocked.
- The latest Safe authenticity CI run completed successfully on its tested code head; the document-only follow-up commit does not change that code.
- No production deployment, Safe deployment, wallet signing, transaction, or fund movement is authorized.
