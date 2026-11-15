import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { createAdminAuthority, createAdminReplacementEvent, replaceAdmin } from "./admin-authority.ts";

Deno.test("only the designated owner can appoint the single administrator", () => {
  const authority = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "owner-approval-1");
  assertEquals(authority.ownerId, "owner-1");
  assertEquals(authority.activeAdminId, "admin-1");
  assertEquals(authority.generation, 1);
});

Deno.test("another user or the current administrator cannot appoint or replace an administrator", () => {
  assertThrows(() => createAdminAuthority("admin-1", "owner-1", "admin-2", 100, "approval"));
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  assertThrows(() => replaceAdmin("admin-1", current, 1, "admin-2", 110, "approval-2"));
  assertThrows(() => replaceAdmin("outsider", current, 1, "admin-2", 110, "approval-2"));
});

Deno.test("owner replacement is explicit, singular, and advances the authority generation", () => {
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  const next = replaceAdmin("owner-1", current, 1, "admin-2", 120, "approval-2");
  assertEquals(next.activeAdminId, "admin-2");
  assertEquals(next.generation, 2);
  assertEquals(next.ownerId, "owner-1");
  assertEquals(current.activeAdminId, "admin-1");
});

Deno.test("replacement rejects blank, duplicate, owner-as-admin, stale, or unreferenced appointments", () => {
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  assertThrows(() => replaceAdmin("owner-1", current, 1, " ", 120, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, 1, "admin-1", 120, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, 1, "owner-1", 120, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, 1, "admin-2", 99, "approval-2"));
  assertThrows(() => replaceAdmin("owner-1", current, 1, "admin-2", 120, " "));
});

Deno.test("replacement requires compare-and-swap generation and cannot replay stale authority", () => {
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  const next = replaceAdmin("owner-1", current, 1, "admin-2", 120, "approval-2");
  assertThrows(() => replaceAdmin("owner-1", current, 2, "admin-3", 130, "approval-3"));
  assertThrows(() => replaceAdmin("owner-1", next, 1, "admin-3", 130, "approval-3"));
});

Deno.test("replacement produces one immutable event revoking the previous administrator", () => {
  const current = createAdminAuthority("owner-1", "owner-1", "admin-1", 100, "approval-1");
  const next = replaceAdmin("owner-1", current, 1, "admin-2", 120, "approval-2");
  const event = createAdminReplacementEvent(current, next);
  assertEquals(event.eventType, "admin_replaced");
  assertEquals(event.previousAdminId, "admin-1");
  assertEquals(event.activeAdminId, "admin-2");
  assertEquals(event.generation, 2);
  assertThrows(() => createAdminReplacementEvent(current, current));
  assertThrows(() => { (event as { activeAdminId: string }).activeAdminId = "admin-3"; });
});
