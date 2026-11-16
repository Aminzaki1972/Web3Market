import { createClient } from "npm:@supabase/supabase-js@2";
import { assertW3MFinalizationReady } from "./w3m-v1-finalization-gate.ts";

// Compile-time contract: Supabase's service-role client must satisfy the shared gate RPC interface.
const admin = createClient("https://example.supabase.co", "test-service-role-key", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const gateResult: Promise<unknown> = assertW3MFinalizationReady(
  admin,
  "71000000-0000-4000-8000-000000000001",
);
void gateResult;
