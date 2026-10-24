import { assertEquals } from "jsr:@std/assert@1";
import { readResponseBytesLimited } from "./audit-download.ts";

Deno.test("declared oversized response is rejected and body is cancelled", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
    cancel() { cancelled = true; },
  });
  const result = await readResponseBytesLimited(new Response(stream, { headers: { "content-length": "100" } }), 10);
  assertEquals(result.tooLarge, true);
  assertEquals(result.bytes, null);
  assertEquals(cancelled, true);
});

Deno.test("unknown-length response cancels when streamed bytes exceed limit", async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(6)); if (pulls > 4) controller.close(); },
    cancel() { cancelled = true; },
  });
  const result = await readResponseBytesLimited(new Response(stream), 10);
  assertEquals(result.tooLarge, true);
  assertEquals(result.bytes, null);
  assertEquals(cancelled, true);
  assertEquals(pulls <= 2, true);
});

Deno.test("response at the byte limit is accepted", async () => {
  const result = await readResponseBytesLimited(new Response(new Uint8Array([1, 2, 3])), 3);
  assertEquals(result.tooLarge, false);
  assertEquals(Array.from(result.bytes || []), [1, 2, 3]);
});
