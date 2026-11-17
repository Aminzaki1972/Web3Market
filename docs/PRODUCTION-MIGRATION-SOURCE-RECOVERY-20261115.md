# W3M Deal/Safe Historical Migration Source Recovery

Date: 2026-11-15

## Purpose

This note records a read-only recovery of historical Deal/Safe/Dispute/Wallet migration payloads from the connected `web3market` Supabase project's migration ledger. The matching SQL files are absent from the current GitHub migration directory, but the executed SQL payloads remain recorded in `supabase_migrations.schema_migrations.statements`.

This is a provenance index for isolated V1 engineering only. It is **not** permission to apply, replay, deploy, or otherwise change production schema or data.

## Recovery method and hash semantics

- Read source: `supabase_migrations.schema_migrations`.
- Read-only fields: `version`, `name`, `statements`.
- Recorded payload: `array_to_string(statements, E'\\n;\\n')`.
- Digest: SHA-256 of that reconstructed ledger payload.
- `source_bytes` is the byte length of that reconstructed payload, not a claim about the original local file's byte-for-byte formatting.
- Every listed migration had one recorded statement in the ledger.

## Recovered migration inventory

| Version | Migration name | Ledger payload bytes | SHA-256 |
|---|---|---:|---|
| 20260828134112 | add_safe_transaction_layer | 5512 | eb026897870354fffe1c338b2b46011065211000890fd54bb5e4b1f15a615337 |
| 20260828164000 | backfill_existing_deal_fee_values | 517 | 7c3906e6d787bbc0e5734229d464ba2449c42fdec9fa2d7ed600a528154c2e5a |
| 20260828164812 | secure_deal_lifecycle_v1 | 8033 | a1c3b2939b86beb9e2b5ebc07812f9204d039672070f356856ee6b723494f190 |
| 20260828164836 | lock_deal_client_writes_v1 | 1592 | 74f38b39dce7efe1546d029c53a0dbfee81ce3f00c5c2b8864ea10ede410a8a0 |
| 20260828164856 | restore_safe_deal_insert_v1 | 1013 | 88dab82407b09d46ddd863c51917a1676e66570e7b0dcc7bf39fa393084aa398 |
| 20260828173055 | create_deal_room_messages_and_events | 2594 | 14a790357735526ceda3f501fa1fb7a259bc4533d1c40b78dd900a53cc04a1c5 |
| 20260828181630 | build_multisig_dispute_resolution_v1 | 4870 | 425fc4c04a44f1f45ed4c7c27ceef4c71b71501c71e2c6d1c3f0c014060c4b92 |
| 20260828181707 | secure_deal_terms_agreements_v1 | 2342 | ea37cfa02099c2e57ae92b5b3089fcbc10b7a58c295e0e53fa9331dae6b71741 |
| 20260828184353 | secure_deal_workflow_and_verification | 8225 | b6fcbacf09667cb2060d971a1a6ad78c464a05357e3f5ef548102cf2f1e37ed7 |
| 20260828184430 | normalize_deal_fee_alias | 577 | 306f048a07d055aca8685d7350a90c4fda92e8ffbba7db0ec86e64a4b1a2e330 |
| 20260828184517 | protect_wallet_address_updates | 583 | b8fbb6fd45bd47d2657c359db07202779ae331c7da6c1b504d1c39f3afee4bd0 |
| 20260904180832 | add_deal_analytics_market_statistics | 3520 | 8205dd55e63e3e9833a146ea3ab62e6a115577b60a6d0fa3d54b0744c4c45091 |
| 20260904181342 | add_web3market_deal_score_v2 | 4842 | f6086e881bc5ba2a44c0265c1e822d71fb3dfb2c12aff446f75c7cfea63e423a |
| 20260904181708 | fix_deal_score_row_check_v2 | 3443 | 2ed613a6e50f2a065a51b2e012a27ff1814d45da1d6d84f8e2870cbbc2f1c682 |
| 20260905045042 | lock_down_deals_direct_updates | 585 | c2c2516b64c8675dfbeebad0f1a0e9e86ae4a7d64a2fd66772ad9dbe4fa2bfee |
| 20260905150128 | harden_deal_rls_and_indexes | 1496 | b288311044d291ed98ef982cb78abd7875372fe05ac73ded08c631f4ac67be03 |
| 20260905150135 | lock_deal_agreement_identity | 896 | bfb69a62062706da5ae4df29039b231ca703b2fea0c35edfa13fc5340cd27150 |
| 20260905162859 | harden_deal_party_agreements_update | 991 | 3657c6fbdd2487b2425d4fb53bf0c0159cc3cf6e6d374d8fdba2049506a62eb2 |
| 20260905172108 | add_deal_release_policy | 3273 | f36b16919b55f9ef19b49fa895ec4162a2d21432f4eb70053ade73bba11305c6 |
| 20260905172225 | lock_deal_release_policy_writes | 1895 | 1c0222735416c0099b2c92fcdc675fa6df911d2335aa8d7d3386e811a986c871 |
| 20260905205332 | restore_platform_deal_room_read_access | 834 | 1c65f940058a3edbcae246f61422222560fca0dba49934e998e5c85db826d79c |
| 20260908122850 | add_deal_message_audit_fields | 962 | 9bf541e031fe4fc71b203c80eade342bb5210a6ea7b7c8ed1c3f9562a31f1bae |
| 20260908205802 | add_wallet_verification_status | 185 | e955cf6e7eb147cd99ac51b5a746da9b7ac05d6d1b10adbbfbd0e345977d4440 |
| 20260908210742 | protect_wallet_verification_fields | 786 | 59bf425e9c1524477f82470950e0e3bfdbb48bb725361bf184d1a1c4d9eb9096 |
| 20260908225254 | remove_duplicate_deal_messages_indexes | 116 | 640986ea1e70e5b24c6f15e58d5ecb689793fb7d0b9092d1810a83b0be573858 |
| 20260911043042 | safe_security_performance_cleanup | 3621 | 389676df6c8f0c9bc6243b4ddfb2e8a2804354e39020ebb6b546dc0e5fe37876 |
| 20260912003611 | grant_authenticated_execute_is_deal_participant | 76 | 185adddf7a369c297d85084448ed54721babea15fcbd8cdb0b589fd94b8a9ac6 |
| 20260912115046 | fix_marketplace_platform_fee_wallet | 6067 | 5a2db37715535f2d96b65c62f5b55f1aaca3b0127397cc3c7e19860f37c75be3 |
| 20260915195545 | bind_payment_transactions_to_deals | 394 | 189f89f94c357174759f7963c18d854ad33c921d921986e3944897ef4b62b475 |
| 20260915200214 | add_safe_nonce_settlement_integrity | 507 | 26cd91770404965bc5f9f41791c5653946644d272850fe53072df7849ab90cf3 |
| 20260915200222 | protect_safe_nonce_in_release_policy | 2761 | 8fa4de2a7fb09e2cda6ef58f642f073a8a570885599c2534a5a561590436301b |
| 20260915200238 | add_safe_nonce_to_sensitive_deal_guard | 1231 | b999f3a6054ab12be24733b828ae9a2ffb2f67c50442c6f500122a825aa20c67 |
| 20260915200248 | lock_release_policy_safe_nonce_check | 1026 | 7dd3cc2b2abe157595a33a66bbf265e3b958044059bfd3845db141558f51dd9d |
| 20260915200659 | add_deal_delivery_state | 594 | fa96067c28933483013c35c3e1469795e31e0386793437040175fad9c55ade64 |
| 20260915201648 | harden_deal_asset_updates | 3340 | afb011961989bb0f8a3074c8df2187dde2c6336b0952a81935f89df973a99c65 |
| 20260916181309 | require_verified_seller_wallet_for_release_v1 | 3320 | ce597577e500b8d3e0ae38d68114c628603061988b8f71d722f46657d0f3d0e0 |
| 20260916183126 | fix_deal_participant_function_execute_permission | 148 | e1900fe3019d2d73f98678da8d7bf27edd41baefa7d2432eebff09025ea131fd |
| 20260916222531 | harden_wallet_verification_nonce_flow_v1 | 737 | 9466b6e7adfd4b6f370c2d3634672f219b936c89e33a57954f60ae71b89d70ca |
| 20260916222540 | add_wallet_address_chain_unique_index_v1 | 113 | d132489d8ec9caffa24cf5bd63b1925724b05ae8c11671d648ca93a774419f59 |
| 20260917183143 | add_wallet_verification_handoffs | 732 | c1c78cadcaba8a920e5eb5d421bbae83290dae6ba95f129c79832bfc21159255 |
| 20260917183206 | remove_unreleased_wallet_handoff_table | 57 | 46850d62fa977843c2222a844f3fbc1b217d621a0e2ffdfab8a304b02152c711 |
| 20260917183310 | add_wallet_verification_handoffs_v2 | 764 | cc8e8f4aa9c62313872e10c777557212684ff5c38391949cfaf847011072855f |

## Safety and restoration notes

1. This recovery was read-only. No SQL was applied, no migration history was altered, and no production table/function/policy/role was changed.
2. The ledger payloads are authoritative evidence of the SQL recorded as executed, but they are not necessarily byte-for-byte copies of the original local migration files.
3. At least one recovered historical payload (`20260828181707_secure_deal_terms_agreements_v1`) contains hard-coded deal and auth-user UUIDs in a one-off data insert. Do **not** republish or replay that payload verbatim. Separate schema changes from data-specific backfill and redact/reconstruct that one-off operation before any source restoration.
4. Before using these payloads to rebuild an isolated baseline, review chronological dependencies, compare every statement with the current live catalog, identify data-dependent statements, and run the complete migration chain only in disposable PostgreSQL.
5. This inventory narrows the historical schema-source gap. It does not itself complete Deal Room integration, dispute decisions/refunds, legal agreement binding, or production authorization.

## Next isolated-only action

Recover the required historical payloads into a private review artifact, classify schema DDL versus data backfill, then build a disposable PostgreSQL baseline from the safe chronological set. Keep the V1 branch isolated; do not merge, deploy, or change production.
