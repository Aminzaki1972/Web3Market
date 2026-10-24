import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { collectPages } from "./audit-pagination.ts";

Deno.test("collectPages reads every row beyond PostgREST default limits", async () => {
  const rows = Array.from({ length: 2377 }, (_, i) => ({ id: i }));
  const requested: Array<[number, number]> = [];
  const result = await collectPages(async (from, to) => {
    requested.push([from, to]);
    return { data: rows.slice(from, to + 1) };
  });
  assertEquals(result.length, 2377);
  assertEquals(result[0].id, 0);
  assertEquals(result.at(-1)?.id, 2376);
  assertEquals(requested, [[0, 499], [500, 999], [1000, 1499], [1500, 1999], [2000, 2499]]);
});

Deno.test("collectPages propagates database read errors instead of returning partial data", async () => {
  await assertRejects(
    () => collectPages(async () => ({ data: null, error: { message: "simulated database failure" } })),
    Error,
    "simulated database failure",
  );
});

Deno.test("collectPages rejects unsafe page sizes", async () => {
  await assertRejects(() => collectPages(async () => ({ data: [] }), 1001), Error, "pageSize");
});
