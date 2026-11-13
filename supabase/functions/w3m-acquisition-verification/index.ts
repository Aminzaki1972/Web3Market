import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createW3MAcquisitionHandler,
  type W3MAdminClient,
} from "./handler.ts";

const handler = createW3MAcquisitionHandler({
  createAdminClient(url, serviceKey) {
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as W3MAdminClient;
  },
  getEnv(name) {
    return Deno.env.get(name);
  },
});

Deno.serve(handler);
