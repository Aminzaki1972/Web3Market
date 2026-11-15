import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { createAdminAuthority, replaceAdmin } from "./admin-authority.ts";

Deno.test("only the designated owner can appoint the single administrator", () => {
  const authority = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "owner-approval-1");
  assertEquals(authority.ownerId, "owner-1");
  assertEquals(authority.activeAdminId, "admin-1");
  assertEquals(authority.generation, 1);
});

Deno.test("another user or the current administrator cannot appoint or replace an administrator", () => {
  assertThrows(() => createAdminAuthority("admin-1", "owner-1", "admin-2", 100, "approval"));
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  assertThrows(() => replaceAdmin("admin-1", current, "admin-2", 110, "approval-2"));
  assertThrows(() => replaceAdmin("outsider", current, "admin-2", 110, "approval-2"));
});

Deno.test("owner replacement is explicit, singular, and advances the authority generation", () => {
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  const next = replaceAdmin("owner-1", current, "admin-2", 120, "approval-2");
  assertEquals(next.activeAdminId, "admin-2");
  assertEquals(next.generation, 2);
  assertEquals(next.ownerId, "owner-1");
  assertEquals(current.activeAdminId, "admin-1");
});

Deno.test("replacement rejects blank, duplicate, owner-as-admin, stale, or unreferenced appointments", () => {
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  assertThrows(() => replaceAdmin("owner-1", current, " ", 120, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, "admin-1", 120, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, "owner-1", 120, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, "admin-2", 99, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, "admin-2", 120, " "));
});
