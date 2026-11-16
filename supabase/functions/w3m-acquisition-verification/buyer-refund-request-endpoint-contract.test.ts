// Static deployment-boundary regression tests for the buyer refund request Edge Function.
// The HTTP handler and each verifier have behavioral unit tests; this guards the composition
// entrypoint against accidentally dropping a mandatory verifier or adding signing/broadcast.
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
  requireText(endpoint, /readBuyerRefundRequestSnapshot\(/, "fresh service-side refund snapshot");
  requireText(endpoint, /verifyBuyerRefundAgreementAcceptances\(/, "cryptographic buyer and seller agreement acceptances");
  requireText(endpoint, /verifyBnbDealPaymentReceipt\(/, "canonical confirmed funding receipt");
  requireText(endpoint, /readCanonicalBnbSafeConfigurationFacts\(/, "canonical Safe owners, threshold, singleton and version");
  requireText(endpoint, /readCanonicalBnbUsdtBalance\(/, "block-pinned Safe USDT balance");
  requireText(endpoint, /readCanonicalBnbSafeTransactionFactsAtBlock\(/, "Safe transaction hash at the same canonical block");
  requireText(endpoint, /decodeSafeMultiSendCalldata\(/, "decoded exact MultiSend transfer payload");
  requireText(endpoint, /persistBuyerRefundRequestAtomically\(/, "single atomic request persistence boundary");
});

Deno.test("buyer refund request entrypoint remains read-only on chain and non-custodial", () => {
  forbidText(endpoint, /eth_sendRawTransaction|eth_sendTransaction/i, "JSON-RPC transaction broadcast");
  forbidText(endpoint, /\.sendTransaction\s*\(|\.signTransaction\s*\(|\.signMessage\s*\(|\.signTypedData\s*\(/, "wallet signing or transaction submission");
  forbidText(endpoint, /private[_-]?key|mnemonic|seedPhrase/i, "private key or seed material");
  forbidText(endpoint, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, "direct table mutation outside the atomic RPC");
  requireText(endpoint, /supabase\.rpc\(functionName,args\)/, "database access is routed through RPC adapter");
});

Deno.test("buyer refund HTTP handler rejects all browser authority except deal_id", () => {
  requireText(handler, /Object\.keys\(row\)\.length!==1/, "single-field browser request");
  requireText(handler, /row\.deal_id/, "deal_id-only request contract");
  requireText(handler, /deps\.authenticate\(token\)/, "authenticated actor derivation");
  requireText(handler, /deps\.isAdmin\(actorId\)/, "server-side administrator authorization");
  requireText(handler, /input\.dealId!==row\.deal_id\|\|input\.actorId!==actorId/, "fresh context actor and deal binding");
});
