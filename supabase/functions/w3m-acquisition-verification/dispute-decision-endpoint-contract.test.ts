const endpointUrl = new URL("../w3m-protocol-v1-dispute-decision/index.ts", import.meta.url);
const endpoint = await Deno.readTextFile(endpointUrl);
Deno.test("dispute decision Edge Function requires server-verified AAL2 before checking admin role", () => {
  if (!/authenticateVerifiedAdminAal2\\(supabase, token\\)/.test(endpoint)) throw new Error("Dispute decision endpoint must require a Supabase-verified AAL2 session.");
  if (!/isAdmin:\\s*async/.test(endpoint) || !/profiles[\\s\\S]{0,120}role/.test(endpoint)) throw new Error("Dispute decision endpoint must independently verify the administrator profile role.");
  if (/authenticate:\\s*async\\s*\\(token\\)\\s*=>\\s*\\{[\\s\\S]{0,160}getUser\\(token\\)/.test(endpoint)) throw new Error("Dispute decision endpoint must not use user authentication without the AAL2 gate.");
});
