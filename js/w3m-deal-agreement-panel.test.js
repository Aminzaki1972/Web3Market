import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { renderW3MDealAgreementPanel } from "./w3m-deal-agreement-panel.js";

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ""; this.className = ""; this.style = {}; }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
}
const documentRef = { createElement(tag) { return new FakeElement(tag); } };
function flatten(node) {
  return [node.textContent, ...node.children.flatMap(flatten)].join("\n");
}
const status = (overrides = {}) => ({
  currentTerms: {
    terms_version: "3", terms_hash: "a".repeat(64),
    canonical_terms: { schema: "w3m-acquisition-terms-v1", note: "<script>alert(1)</script>" },
  },
  acceptances: {
    buyer: { accepted: true, accepted_at: "2026-11-07T01:00:00Z" },
    seller: { accepted: false },
  },
  bothAccepted: false, dealEligible: false,
  ...overrides,
});

Deno.test("agreement panel renders canonical terms as text, never as HTML", () => {
  const container = new FakeElement("div");
  const panel = renderW3MDealAgreementPanel(container, status(), documentRef);
  const output = flatten(panel);
  assertEquals(container.children.length, 1);
  assertEquals(output.includes("<script>alert(1)</script>"), true);
  assertEquals(output.includes("Canonical terms hash:"), true);
  assertEquals(output.includes("Buyer: Accepted"), true);
  assertEquals(output.includes("Seller: Not accepted"), true);
  const details = panel.children.find((node) => node.tagName === "details");
  const pre = details.children.find((node) => node.tagName === "pre");
  assertEquals(pre.textContent.includes("<script>alert(1)</script>"), true);
});

Deno.test("agreement panel clearly reports missing published terms and incomplete gate", () => {
  const container = new FakeElement("div");
  const panel = renderW3MDealAgreementPanel(container, status({ currentTerms: null }), documentRef);
  const output = flatten(panel);
  assertEquals(output.includes("No published canonical agreement terms"), true);
  assertEquals(output.includes("not complete"), true);
});

Deno.test("agreement panel reports the server eligibility state without initiating Safe actions", () => {
  const container = new FakeElement("div");
  const panel = renderW3MDealAgreementPanel(container, status({
    acceptances: {
      buyer: { accepted: true, accepted_at: "2026-11-07T01:00:00Z" },
      seller: { accepted: true, accepted_at: "2026-11-07T01:05:00Z" },
    },
    bothAccepted: true, dealEligible: true,
  }), documentRef);
  const output = flatten(panel);
  assertEquals(output.includes("Both parties accepted"), true);
  assertEquals(output.includes("eligible for the next V1 gate"), true);
  assertEquals(output.includes("Execute Safe"), false);
});

Deno.test("agreement panel rejects malformed status and malformed canonical terms", () => {
  const container = new FakeElement("div");
  assertThrows(() => renderW3MDealAgreementPanel(container, {}, documentRef));
  assertThrows(() => renderW3MDealAgreementPanel(container, status({
    currentTerms: { terms_version: "3", terms_hash: "bad", canonical_terms: [] },
  }), documentRef));
});
