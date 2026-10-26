import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retired diagnostic endpoint. It previously returned privileged Safe transaction
// and signature details. Keep the endpoint unavailable unless a reviewed,
// administrator-authenticated replacement is intentionally deployed.
Deno.serve((_req: Request) => new Response(
  JSON.stringify({ ok: false, error: "Diagnostic endpoint disabled for security review." }),
  { status: 410, headers: { "content-type": "application/json", "cache-control": "no-store" } }
));
