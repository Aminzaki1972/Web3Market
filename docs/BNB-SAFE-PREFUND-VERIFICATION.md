# BNB Smart Chain Safe Compatibility — Pre-Funding Verification Checklist

**Status:** implementation checklist for sandbox planning. No RPC calls, wallet connections, Safe changes or funds movement are performed by this document.

## Purpose

Before Web3Market accepts a real USDT BEP-20 deposit into a deal Safe, the backend must establish that the exact Safe instance can enforce the dispute payout suspension policy. The published Safe deployment registry contains canonical v1.5.0 deployments for chain ID 56, but that alone does not identify the implementation used by an individual Safe.

## Per-deal Safe verification

The trusted server-side verifier must read BNB Smart Chain state and persist a signed/auditable snapshot containing:

- chain ID exactly `56`;
- deal Safe address and deployed runtime code hash;
- Safe proxy implementation/singleton resolved using the exact official Safe proxy version's documented method;
- singleton runtime bytecode hash compared with the official versioned registry entry;
- Safe `VERSION()` result where supported;
- owners list and threshold, checked against the approved deal configuration;
- Transaction Guard address and runtime code hash;
- Module Guard address and runtime code hash where supported;
- all enabled modules, paginated until the complete list is retrieved;
- fallback handler address;
- expected MultiSend and MultiSendCallOnly addresses and runtime code hashes;
- token contract and all active recipient addresses;
- block number and block hash at which the snapshot was read.

Do not infer the Safe version solely from its address, user interface, transaction service metadata or a browser-provided claim. Do not compare the proxy's runtime code hash to the singleton's registry code hash; resolve and hash the singleton implementation itself.

## Mandatory rejection conditions

Do not mark the Safe as dispute-protected and do not accept a real deposit if:

- chain ID is not 56;
- implementation or runtime code hash does not match the approved versioned registry entry;
- the version does not support the required guard coverage;
- Transaction Guard is missing, incorrect or not the approved code hash;
- Module Guard is required but unavailable, missing or incorrect;
- an unapproved module is enabled;
- owners or threshold differ from the approved deal configuration;
- fallback handler or MultiSend targets differ from the approved configuration;
- a read fails, returns incomplete data, or the snapshot cannot be independently reproduced.

The system must fail closed and show a clear "Safe protection verification failed — deposit disabled" state. Do not downgrade to an unguarded Safe automatically.

## Revalidation

Revalidate immediately before any payout proposal and immediately before execution verification. Recheck after any Safe owner, threshold, module, guard, fallback handler or implementation change. If a configuration mutation occurs while a dispute is open, treat it as a critical security incident and keep the deal blocked.

## Safe v1.5.0 BNB registry baseline (reference only)

- Chain ID: `56`
- Safe singleton: `0xFf51A5898e281Db6DfC7855790607438dF2ca44b`
- Safe singleton code hash: `0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2`
- MultiSend: `0x218543288004CD07832472D464648173c77D7eB7`
- MultiSend code hash: `0xca1147a12963172a93910c5cb2bfa5ad0e941c7f03fc7eb017dd06a8ea4e5604`
- MultiSendCallOnly: `0xA83c336B20401Af773B6219BA5027174338D1836`
- MultiSendCallOnly code hash: `0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663`
- CompatibilityFallbackHandler: `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4`
- CompatibilityFallbackHandler code hash: `0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc`

These are registry reference values, not proof that a particular deployed contract has this code. The actual chain state must be queried and compared at the time of verification.

## Required test cases

1. Correct v1.5.0 Safe with approved Guard and Module Guard passes.
2. v1.4.1 Safe with no Module Guard fails closed for the full-coverage policy.
3. v1.5.0 Safe with zero Module Guard fails closed.
4. Correct singleton address but wrong runtime bytecode hash fails.
5. An enabled unapproved module fails.
6. One missing page from the enabled-module pagination fails.
7. Owner or threshold mismatch fails.
8. Guard removed or replaced after initial verification invalidates the snapshot.
9. Module Guard removed or replaced invalidates the snapshot.
10. MultiSend or fallback handler mismatch fails.
11. RPC timeout, inconsistent block reads, or reorged snapshot fails closed.
12. A previously valid snapshot cannot be reused after a Safe configuration event.

## Authorization boundary

This checklist is not a Guard contract, backend implementation or production control. The verifier must run server-side against a trusted RPC source; browser state is never authoritative. Guard/Module Guard source, bytecode, deployment, installation and recovery procedure require separate implementation review, fork tests, adversarial tests and independent audit before use with real funds.
