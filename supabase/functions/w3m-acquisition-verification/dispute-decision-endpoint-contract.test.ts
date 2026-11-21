const endpointUrl = new URL("../w3m-protocol-v1-dispute-decision/index.ts", import.meta.url);
const endpoint = await Deno.readTextFile(endpointUrl);
Deno.test("dispute decision Edge Function requires server-verified AAL2 before checking admin role", () => {
  const authStart = endpoint.indexOf("authenticate: async");
  const adminStart = endpoint.indexOf("isAdmin:", authStart);
  if (authStart < 0 || adminStart <= authStart) throw new Error("Dispute decision endpoint authentication boundary is missing.");
  const authBlock = endpoint.slice(authStart, adminStart);
  if (!authBlock.includes("authenticateVerifiedAdminAal2(supabase, token)")) throw new Error("Dispute decision endpoint must require a Supabase-verified AAL2 session.");
  if (authBlock.includes("getUser(token)")) throw new Error("Dispute decision endpoint must not use user authentication without the AAL2 gate.");
  if (!endpoint.includes('.from("profiles")') || !endpoint.includes('.select("id, role")')) throw new Error("Dispute decision endpoint must independently verify the administrator profile role.");
});
