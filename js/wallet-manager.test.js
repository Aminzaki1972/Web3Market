import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";

const ADDRESS = "0x5555555555555555555555555555555555555555";
const SIGNATURE = "0x" + "a".repeat(130);
const B32 = (digit) => "0x" + digit.repeat(64);
const TYPED_DATA = {
  domain: { name: "Web3Market Deal Agreement", version: "1", chainId: 56 },
  primaryType: "DealTermsAcceptance",
  types: { DealTermsAcceptance: [
    { name: "dealId", type: "bytes32" },
    { name: "fingerprintId", type: "bytes32" },
    { name: "fingerprintDigest", type: "bytes32" },
    { name: "bindingHash", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "termsVersion", type: "uint256" },
    { name: "partyRole", type: "uint8" },
    { name: "wallet", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ] },
  message: {
    dealId: B32("1"), fingerprintId: B32("2"), fingerprintDigest: B32("3"),
    bindingHash: B32("4"), termsHash: B32("5"), termsVersion: "3",
    partyRole: 1, wallet: ADDRESS, nonce: B32("6"), deadline: "1800000300",
  },
};

async function managerFor(provider, route = "MetaMask") {
  const source = await Deno.readTextFile(new URL("./wallet-manager.js", import.meta.url));
  const values = new Map([[ "web3market-wallet-route:" + ADDRESS.toLowerCase(), route ]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
  const win = { ethereum: provider, safepalProvider: undefined };
  const nav = { userAgent: "Deno test", vendor: "" };
  const locationStub = { host: "web3market.xyz", href: "https://web3market.xyz/deal-room" };
  new Function("window", "localStorage", "navigator", "location", source)(win, storage, nav, locationStub);
  return win.Web3MarketWalletManager;
}
function mockProvider(overrides = {}) {
  const calls = [];
  const provider = {
    isMetaMask: true,
    async request(args) {
      calls.push(args);
      if (args.method === "eth_accounts") return [ADDRESS];
      if (args.method === "eth_chainId") return "0x38";
      if (args.method === "eth_signTypedData_v4") return SIGNATURE;
      throw new Error("Unexpected wallet RPC: " + args.method);
    },
    ...overrides,
  };
  return { provider, calls };
}

Deno.test("verified wallet signer uses the linked provider and only EIP-712 signing on BNB Chain", async () => {
  const { provider, calls } = mockProvider();
  const manager = await managerFor(provider);
  const signature = await manager.signTypedDataForVerifiedWallet(ADDRESS, TYPED_DATA);
  assertEquals(signature, SIGNATURE);
  assertEquals(calls.map((call) => call.method), [
    "eth_accounts", "eth_chainId", "eth_signTypedData_v4",
  ]);
  assertEquals(calls[2].params[0], ADDRESS);
  assertEquals(JSON.parse(calls[2].params[1]), TYPED_DATA);
});

Deno.test("verified wallet signer refuses a different active account before signing", async () => {
  const calls = [];
  const { provider } = mockProvider({
    async request(args) {
      calls.push(args);
      if (args.method === "eth_accounts") return ["0x6666666666666666666666666666666666666666"];
      return "0x38";
    },
  });
  const manager = await managerFor(provider);
  await assertRejects(() => manager.signTypedDataForVerifiedWallet(ADDRESS, TYPED_DATA));
  assertEquals(calls.map((call) => call.method), ["eth_accounts"]);
});

Deno.test("verified wallet signer refuses a non-BNB chain without requesting a signature", async () => {
  const calls = [];
  const { provider } = mockProvider({
    async request(args) {
      calls.push(args);
      if (args.method === "eth_accounts") return [ADDRESS];
      if (args.method === "eth_chainId") return "0x1";
      throw new Error("Signing must not be reached");
    },
  });
  const manager = await managerFor(provider);
  await assertRejects(() => manager.signTypedDataForVerifiedWallet(ADDRESS, TYPED_DATA));
  assertEquals(calls.map((call) => call.method), ["eth_accounts", "eth_chainId"]);
});

Deno.test("verified wallet signer rejects altered domain, schema, and wallet binding before provider access", async () => {
  const { provider, calls } = mockProvider();
  const manager = await managerFor(provider);
  const invalid = [
    { ...TYPED_DATA, domain: { name: "Attacker", version: "1", chainId: 56 } },
    { ...TYPED_DATA, message: { ...TYPED_DATA.message, wallet: "0x6666666666666666666666666666666666666666" } },
    { ...TYPED_DATA, message: { ...TYPED_DATA.message, nonce: "bad" } },
    { ...TYPED_DATA, types: { DealTermsAcceptance: [] } },
    { ...TYPED_DATA, message: { ...TYPED_DATA.message, partyRole: 3 } },
  ];
  for (const data of invalid) {
    await assertRejects(() => manager.signTypedDataForVerifiedWallet(ADDRESS, data));
  }
  assertEquals(calls.length, 0);
});

Deno.test("verified wallet signer rejects malformed wallet signatures", async () => {
  const { provider } = mockProvider({
    async request(args) {
      if (args.method === "eth_accounts") return [ADDRESS];
      if (args.method === "eth_chainId") return "0x38";
      if (args.method === "eth_signTypedData_v4") return "0x1234";
      throw new Error("Unexpected wallet RPC");
    },
  });
  const manager = await managerFor(provider);
  await assertRejects(() => manager.signTypedDataForVerifiedWallet(ADDRESS, TYPED_DATA));
});

Deno.test("verified wallet signer never falls back to an unlinked injected provider", async () => {
  const { provider, calls } = mockProvider();
  const manager = await managerFor(provider, "");
  await assertRejects(() => manager.signTypedDataForVerifiedWallet(ADDRESS, TYPED_DATA));
  assertEquals(calls.length, 0);
});
