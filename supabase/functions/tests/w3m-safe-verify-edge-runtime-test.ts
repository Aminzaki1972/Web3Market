import { assertEquals, assert } from "jsr:@std/assert@1.0.14";

const DEAL_ID = "00000000-0000-4000-8000-000000000001";
const BUYER_ID = "buyer-user";
const SELLER_ID = "seller-user";
const SAFE_ADDRESS = "0x3333333333333333333333333333333333333333";
const BUYER_WALLET = "0x1111111111111111111111111111111111111111";
const SELLER_WALLET = "0x2222222222222222222222222222222222222222";
const SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
const PLATFORM = "0x2B15cC63eE3b833F502C065767695Fa2B584f8c9";
const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;

Deno.test({
  name: "W3M Safe verifier runs in a real Deno HTTP process with mocked Supabase and BNB RPC",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const state = {
      chainId: "0x38",
      rpcMethods: [] as string[],
    };
    const mockListener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const mockPort = (mockListener.addr as Deno.NetAddr).port;
    const mockBase = `http://127.0.0.1:${mockPort}`;
    const deal = {
      id: DEAL_ID,
      buyer_id: BUYER_ID,
      seller_id: SELLER_ID,
      chain_id: 56,
      safe_address: SAFE_ADDRESS,
      safe_deployment_tx_hash: null,
    };

    const mockServer = Deno.serve({ listener: mockListener, onListen() {} }, async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/auth/v1/user") {
        const token = req.headers.get("Authorization") || "";
        if (token === "Bearer test-token") return Response.json({ id: BUYER_ID });
        if (token === "Bearer outsider-token") return Response.json({ id: "outsider-user" });
        return Response.json({ message: "invalid token" }, { status: 401 });
      }

      if (url.pathname === "/rest/v1/deals") {
        return Response.json(deal, { headers: { "Content-Range": "0-0/1" } });
      }
      if (url.pathname === "/rest/v1/profiles") {
        const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
        const profile = id === BUYER_ID
          ? { wallet_address: BUYER_WALLET, wallet_verified: true }
          : id === SELLER_ID
          ? { wallet_address: SELLER_WALLET, wallet_verified: true }
          : null;
        return profile
          ? Response.json(profile, { headers: { "Content-Range": "0-0/1" } })
          : Response.json(null, { headers: { "Content-Range": "0-0/0" } });
      }
      if (url.pathname === "/rest/v1/deal_release_policies") {
        return Response.json({
          seller_wallet: SELLER_WALLET,
          platform_wallet: PLATFORM,
          safe_address: SAFE_ADDRESS,
          chain_id: 56,
        }, { headers: { "Content-Range": "0-0/1" } });
      }

      if (url.pathname === "/rpc" && req.method === "POST") {
        const rpcRequest = await req.json();
        const requests = Array.isArray(rpcRequest) ? rpcRequest : [rpcRequest];
        const responses = requests.map((call: { id: number; method: string; params?: unknown[] }) => {
          state.rpcMethods.push(call.method);
          let result: unknown = "0x";
          if (call.method === "eth_chainId") result = state.chainId;
          if (call.method === "eth_getCode") result = "0x6000"; // deliberately counterfeit SafeProxy fixture
          if (call.method === "eth_getStorageAt") result = word(SINGLETON);
          if (call.method === "eth_call") {
            const data = String((call.params?.[0] as { data?: string } | undefined)?.data || "").toLowerCase();
            if (data.startsWith("0xa619486e")) result = word(SINGLETON);
          }
          return { jsonrpc: "2.0", id: call.id, result };
        });
        return Response.json(Array.isArray(rpcRequest) ? responses : responses[0]);
      }
      return Response.json({ message: "not found", path: url.pathname }, { status: 404 });
    });

    let edgeProcess: Deno.ChildProcess | null = null;
    try {
      // The production entrypoint uses Deno.serve on port 8000 when run as the main module.
      const portProbe = Deno.listen({ hostname: "127.0.0.1", port: 8000 });
      portProbe.close();

      edgeProcess = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "supabase/functions/w3m-safe-verify/index.ts"],
        env: {
          SUPABASE_URL: mockBase,
          SUPABASE_ANON_KEY: "local-anon-key",
          SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
          BSC_RPC_URL: `${mockBase}/rpc`,
        },
        stdout: "null",
        stderr: "null",
      }).spawn();

      const edgeUrl = "http://127.0.0.1:8000";
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const response = await fetch(edgeUrl);
          if (response.status === 405) { ready = true; break; }
        } catch { /* process is still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert(ready, "Deno Edge Function process did not become ready");

      const call = (token: string) => fetch(edgeUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Origin: "https://web3market.xyz",
        },
        body: JSON.stringify({ deal_id: DEAL_ID }),
      });

      const counterfeit = await call("test-token");
      const counterfeitBody = await counterfeit.json();
      assertEquals(counterfeit.status, 503);
      assertEquals(counterfeitBody.reason, "safe_proxy_runtime_hash_mismatch");
      assertEquals(counterfeitBody.verified, false);
      assert(state.rpcMethods.includes("eth_getCode"), "expected real RPC adapter calls");
      assert(
        !state.rpcMethods.includes("eth_call") || state.rpcMethods.every((method) => method !== "eth_call"),
        "owner-policy reads must not run after counterfeit proxy detection",
      );

      const outsider = await call("outsider-token");
      const outsiderBody = await outsider.json();
      assertEquals(outsider.status, 403);
      assertEquals(outsiderBody.reason, "not_a_deal_participant");

      const invalidSession = await call("invalid-token");
      const invalidSessionBody = await invalidSession.json();
      assertEquals(invalidSession.status, 401);
      assertEquals(invalidSessionBody.reason, "invalid_session");

      state.rpcMethods.length = 0;
      state.chainId = "0x61";
      const wrongChain = await call("test-token");
      const wrongChainBody = await wrongChain.json();
      assertEquals(wrongChain.status, 503);
      assertEquals(wrongChainBody.reason, "bsc_rpc_chain_mismatch");
      assertEquals(state.rpcMethods.filter((method) => method === "eth_getCode").length, 0);
    } finally {
      if (edgeProcess) {
        try { edgeProcess.kill("SIGTERM"); } catch { /* already exited */ }
        await edgeProcess.status.catch(() => undefined);
      }
      await mockServer.shutdown();
    }
  },
});
