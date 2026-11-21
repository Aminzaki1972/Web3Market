import { assertEquals } from "jsr:@std/assert@1.0.14";
import { authenticateVerifiedAdminAal2 } from "./verified-admin-aal2.ts";

const TOKEN = "a".repeat(64);
const USER = "84000000-0000-4000-8000-000000000004";
function client(input: { userId?: string | null; aal?: string | null; userError?: boolean; aalError?: boolean }) {
  return { auth: {
    getUser: async () => ({ data: { user: input.userId ? { id: input.userId } : null }, error: input.userError ? new Error("auth") : null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: input.aal }, error: input.aalError ? new Error("aal") : null }) },
  } };
}
Deno.test("admin authentication requires a Supabase-verified user and AAL2 JWT", async () => {
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: USER, aal: "aal2" }), TOKEN), USER);
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: USER, aal: "aal1" }), TOKEN), null);
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: USER, aal: null }), TOKEN), null);
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: null, aal: "aal2" }), TOKEN), null);
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: USER, aal: "aal2", userError: true }), TOKEN), null);
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: USER, aal: "aal2", aalError: true }), TOKEN), null);
  assertEquals(await authenticateVerifiedAdminAal2(client({ userId: USER, aal: "aal2" }), "short"), null);
});
