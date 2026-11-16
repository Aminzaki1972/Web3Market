// Static source-composition regression tests for buyer refund REQUEST, SIGN, and FINALIZE Edge Functions.
// These checks verify default dependency wiring and prohibit signing/broadcast/direct writes.
// Behavioral HTTP entrypoint execution is covered by buyer-refund-edge-entrypoints.integration.test.ts.
const endpointUrl = new URL("../w3m-protocol-v1-buyer-refund-request/index.ts", import.meta.url);
const handlerUrl = new URL("./buyer-refund-request-handler.ts", import.meta.url);
const endpoint = await Deno.readTextFile(endpointUrl);
const handler = await Deno.readTextFile(handlerUrl);

function requireText(source: string, pattern: RegExp, label: string): void {
  if (!pattern.test(source)) throw new Error("Buyer refund endpoint contract missing: " + label);
}
function forbidText(source: string, pattern: RegExp, label: string): void {
  if (pattern.test(source)) throw new Error("Buyer refund endpoint contract forbids: " + label);
}

Deno.test("buyer refund request entrypoint composes fresh authorization and canonical evidence", () => {
  requireText(endpoint, /supabase\.auth\.getUser\(token\)/, "Supabase bearer-session authentication");
  requireText(endpoint, /from\(["']profiles["']\)\.select\(["']id,role["']\)/, "server-side admin role lookup");
  requireText(endpoint, /readSnapshot:\s*readBuyerRefundRequestSnapshot/, "fresh service-side refund snapshot");
  requireText(endpoint, /verifyAcceptances:\s*verifyBuyerRefundAgreementAcceptances/, "cryptographic buyer and seller agreement acceptances");
  requireText(endpoint, /verifyFundingReceipt:\s*verifyBnbDealPaymentReceipt/, "canonical confirmed funding receipt");
  requireText(endpoint, /readSafeConfiguration:\s*readCanonicalBnbSafeConfigurationFacts/, "canonical Safe owners, threshold, singleton and version");
  requireText(endpoint, /readUsdtBalance:\s*readCanonicalBnbUsdtBalance/, "block-pinned Safe USDT balance");
  requireText(endpoint, /readSafeTransactionFacts:\s*readCanonicalBnbSafeTransactionFactsAtBlock/, "Safe transaction hash at the same canonical block");
  requireText(endpoint, /decodeMultiSend:\s*decodeSafeMultiSendCalldata/, "decoded exact MultiSend transfer payload");
  requireText(endpoint, /persistRequest:\s*persistBuyerRefundRequestAtomically/, "single atomic request persistence boundary");
});

Deno.test("buyer refund request entrypoint remains read-only on chain and non-custodial", () => {
  forbidText(endpoint, /eth_sendRawTransaction|eth_sendTransaction/i, "JSON-RPC transaction broadcast");
  forbidText(endpoint, /\.sendTransaction\s*\(|\.signTransaction\s*\(|\.signMessage\s*\(|\.signTypedData\s*\(/, "wallet signing or transaction submission");
  forbidText(endpoint, /private[_-]?key|mnemonic|seedPhrase/i, "private key or seed material");
  forbidText(endpoint, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, "direct table mutation outside the atomic RPC");
  requireText(endpoint, /supabase\.rpc\(name,\s*args\)/, "database access is routed through RPC adapter");
});

Deno.test("buyer refund HTTP handler rejects all browser authority except deal_id", () => {
  requireText(handler, /Object\.keys\(row\)\.length!==1/, "single-field browser request");
  requireText(handler, /row\.deal_id/, "deal_id-only request contract");
  requireText(handler, /deps\.authenticate\(token\)/, "authenticated actor derivation");
  requireText(handler, /deps\.isAdmin\(actorId\)/, "server-side administrator authorization");
  requireText(handler, /input\.dealId!==row\.deal_id\|\|input\.actorId!==actorId/, "fresh context actor and deal binding");
});

const manualPaymentUrl = new URL("../verify-deal-payment/index.ts", import.meta.url);
const monitorPaymentUrl = new URL("../deal-payment-monitor/index.ts", import.meta.url);
const manualPayment = await Deno.readTextFile(manualPaymentUrl);
const monitorPayment = await Deno.readTextFile(monitorPaymentUrl);

Deno.test("manual and automatic payment paths share strict receipt verification and atomic finalization", () => {
  for (const [label, source] of [["manual verifier", manualPayment], ["automatic monitor", monitorPayment]] as const) {
    requireText(source, /buildFreshBnbDealPaymentContext\(/, label + " fresh server-derived deal context");
    requireText(source, /verifyBnbDealPaymentReceipt\(/, label + " exact canonical receipt verification");
    requireText(source, /finalizeVerifiedDealPayment\(/, label + " atomic payment finalization RPC");
    requireText(source, /readCanonicalBnbSafeConfigurationFacts\(/, label + " canonical 2-of-3 Safe configuration");
    forbidText(source, /from\(["']blockchain_transactions["']\)\.(insert|update|upsert|delete)\s*\(/, label + " direct blockchain transaction table writes");
  }
});

Deno.test("automatic payment monitor checks BNB chain identity before scanning", () => {
  requireText(monitorPayment, /eth_chainId/, "RPC chain ID query");
  requireText(monitorPayment, /chain!==56n/, "reject non-BNB RPC providers");
  requireText(monitorPayment, /0x55d398326f99059ff775485246999027b3197955/i, "canonical BNB USDT token");
});


const signEndpointUrl = new URL("../w3m-protocol-v1-buyer-refund-sign/index.ts", import.meta.url);
const finalizeEndpointUrl = new URL("../w3m-protocol-v1-buyer-refund-finalize/index.ts", import.meta.url);
const signEndpoint = await Deno.readTextFile(signEndpointUrl);
const finalizeEndpoint = await Deno.readTextFile(finalizeEndpointUrl);

Deno.test("buyer refund SIGN entrypoint verifies participant signature against fresh canonical Safe state", () => {
  requireText(signEndpoint, /supabase\.auth\.getUser\(/, "authenticated participant session");
  requireText(signEndpoint, /createSignHandler:\s*createBuyerRefundSignRequestHandler/, "strict participant SIGN handler");
  requireText(signEndpoint, /loadFreshContext:\s*async/, "fresh database-derived signing context");
  requireText(signEndpoint, /readSafeExecutionFacts:\s*readCanonicalBnbSafeExecutionFacts/, "canonical BNB Safe transaction and owner verification");
  requireText(signEndpoint, /verifyRawDigestSignature:\s*verifyEthereumRawDigestSignature/, "cryptographic raw-digest signature recovery");
  requireText(signEndpoint, /persistSignature:\s*persistBuyerRefundSignatureAtomically/, "atomic signature registry persistence");
  forbidText(signEndpoint, /eth_sendRawTransaction|eth_sendTransaction/i, "chain transaction broadcast");
  forbidText(signEndpoint, /\.sendTransaction\s*\(|\.signTransaction\s*\(|\.signMessage\s*\(|\.signTypedData\s*\(/, "server-side wallet signing");
  forbidText(signEndpoint, /private[_-]?key|mnemonic|seedPhrase/i, "private key or seed material");
  forbidText(signEndpoint, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, "direct table mutation outside the atomic SIGN RPC");
});

Deno.test("buyer refund FINALIZE entrypoint is admin-gated and receipt-verified before atomic commit", () => {
  requireText(finalizeEndpoint, /supabase\.auth\.getUser\(/, "authenticated administrator session");
  requireText(finalizeEndpoint, /isAdmin:\s*async/, "server-side administrator authorization");
  requireText(finalizeEndpoint, /String\(data\.role \?\? ""\)\.toLowerCase\(\) === "admin"/, "admin role is read from trusted profile row");
  requireText(finalizeEndpoint, /verifyReceipt:\s*verifyBnbSafeBuyerRefundReceipt/, "canonical BNB Safe refund receipt verification");
  requireText(finalizeEndpoint, /finalizeAtomically:\s*finalizeBuyerRefundAtomically/, "atomic refund receipt and deal finalization");
  forbidText(finalizeEndpoint, /eth_sendRawTransaction|eth_sendTransaction/i, "chain transaction broadcast");
  forbidText(finalizeEndpoint, /\.sendTransaction\s*\(|\.signTransaction\s*\(|\.signMessage\s*\(|\.signTypedData\s*\(/, "server-side wallet signing");
  forbidText(finalizeEndpoint, /private[_-]?key|mnemonic|seedPhrase/i, "private key or seed material");
  forbidText(finalizeEndpoint, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, "direct table mutation outside the atomic finalization RPC");
  requireText(finalizeEndpoint, /supabase\.rpc\(name, args\)/, "database mutation is routed through the RPC adapter");
});
