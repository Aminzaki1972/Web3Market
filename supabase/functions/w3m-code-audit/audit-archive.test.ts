import { assertEquals } from "jsr:@std/assert@1";
import { strToU8, zipSync } from "npm:fflate@0.8.2";
import { decodeSelectedArchive } from "./audit-archive.ts";

Deno.test("archive decoder extracts selected files from the exact repository root", () => {
  const archive = zipSync({
    "sample-commit/": new Uint8Array(),
    "sample-commit/src/main.ts": strToU8("export const ok = true;"),
    "sample-commit/README.md": strToU8("docs"),
  });
  const result = decodeSelectedArchive(archive, [
    { path: "src/main.ts", size: 23 },
    { path: "missing.ts", size: 10 },
    { path: "large.ts", size: 1000001 },
  ]);
  assertEquals(result.files, [{ path: "src/main.ts", content: "export const ok = true;" }]);
  assertEquals(result.unreadableFiles, 1);
  assertEquals(result.oversizedFiles, 1);
});

Deno.test("archive decoder rejects archives without a repository root", () => {
  const archive = zipSync({ "singlefile": strToU8("x") });
  let threw = false;
  try { decodeSelectedArchive(archive, []); } catch { threw = true; }
  assertEquals(threw, true);
});
