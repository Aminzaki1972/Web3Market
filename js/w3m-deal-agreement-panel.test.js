import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { renderW3MDealAgreementPanel } from "./w3m-deal-agreement-panel.js";

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.textContent = ""; this.className = ""; this.style = {}; this.listeners = {}; this.value = ""; }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
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
  finalDeliveryConfirmation: { confirmed: false, stale: false },
  assets: [{
    assetId: "79000000-0000-4000-8000-000000000009",
    assetName: "repository: Source code", status: "delivered",
    deliveryUrl: "https://example.invalid/repo",
    deliveredAt: "2026-11-07T02:00:00Z", acceptedAt: null,
    events: [{
      eventType: "delivered", attemptNumber: 1,
      evidenceDigest: "d".repeat(64), occurredAt: "2026-11-07T02:00:00Z",
    }],
  }],
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
  assertEquals(output.includes("Included assets and delivery evidence"), true);
  assertEquals(output.includes("repository: Source code"), true);
  assertEquals(output.includes("SHA-256 " + "d".repeat(64)), true);
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
  assertEquals(output.includes("separate required steps"), true);
  assertEquals(output.includes("Execute Safe"), false);
});

Deno.test("agreement panel rejects malformed status and malformed canonical terms", () => {
  const container = new FakeElement("div");
  assertThrows(() => renderW3MDealAgreementPanel(container, {}, documentRef));
  assertThrows(() => renderW3MDealAgreementPanel(container, status({
    currentTerms: { terms_version: "3", terms_hash: "bad", canonical_terms: [] },
  }), documentRef));
});


Deno.test("seller receives a delivery form and submits only that asset's evidence", async () => {
  const container = new FakeElement("div");
  const calls = [];
  const panel = renderW3MDealAgreementPanel(container, status({ viewerRole: "seller" }), documentRef, {
    onAssetAction: async (payload) => { calls.push(payload); },
  });
  const form = panel.children.find((node) => node.tagName === "article").children.find((node) => node.tagName === "form");
  assertEquals(Boolean(form), true);
  const url = form.children.find((node) => node.tagName === "input");
  const evidence = form.children.find((node) => node.tagName === "textarea");
  url.value = "https://example.invalid/new-delivery";
  evidence.value = "Repository transfer confirmation";
  await form.listeners.submit({ preventDefault() {} });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].action, "deliver");
  assertEquals(calls[0].assetId, "79000000-0000-4000-8000-000000000009");
  assertEquals(calls[0].deliveryUrl, url.value);
  assertEquals(calls[0].evidence, evidence.value);
});

Deno.test("buyer receives accept and reject controls only for delivered assets", async () => {
  const container = new FakeElement("div");
  const calls = [];
  const panel = renderW3MDealAgreementPanel(container, status({ viewerRole: "buyer" }), documentRef, {
    onAssetAction: async (payload) => { calls.push(payload); },
  });
  const article = panel.children.find((node) => node.tagName === "article");
  const actions = article.children.find((node) => node.className === "w3m-v1-buyer-asset-actions");
  assertEquals(Boolean(actions), true);
  const buttons = actions.children.filter((node) => node.tagName === "button");
  for (const button of buttons) await button.listeners.click();
  assertEquals(calls.map((call) => call.action).join(","), "accept,reject");
  assertEquals(calls.every((call) => call.assetId === "79000000-0000-4000-8000-000000000009"), true);
});

Deno.test("buyer can confirm the complete asset set only after every asset is accepted", async () => {
  const container = new FakeElement("div");
  const calls = [];
  const acceptedAsset = {
    ...status().assets[0],
    status: "accepted",
    acceptedAt: "2026-11-08T10:00:00Z",
  };
  const panel = renderW3MDealAgreementPanel(container, status({
    viewerRole: "buyer",
    bothAccepted: true,
    assets: [acceptedAsset],
  }), documentRef, {
    onFinalDeliveryConfirm: async () => { calls.push("confirm"); },
  });
  const section = panel.children.find((node) => node.className === "w3m-v1-final-delivery-confirmation");
  const button = section.children.find((node) => node.tagName === "button");
  assertEquals(button.textContent, "Confirm all delivered assets");
  await button.listeners.click();
  assertEquals(calls.join(","), "confirm");
});

Deno.test("final delivery confirmation shows stale history and requires a fresh buyer confirmation", () => {
  const container = new FakeElement("div");
  const acceptedAsset = {
    ...status().assets[0],
    status: "accepted",
    acceptedAt: "2026-11-08T10:00:00Z",
  };
  const panel = renderW3MDealAgreementPanel(container, status({
    viewerRole: "buyer",
    bothAccepted: true,
    assets: [acceptedAsset],
    finalDeliveryConfirmation: { confirmed: false, stale: true },
  }), documentRef, {
    onFinalDeliveryConfirm: async () => {},
  });
  const section = panel.children.find((node) => node.className === "w3m-v1-final-delivery-confirmation");
  const output = flatten(section);
  assertEquals(output.includes("no longer matches the latest asset delivery"), true);
  assertEquals(section.children.some((node) => node.tagName === "button"), true);
});

Deno.test("confirmed final delivery is displayed without exposing signatures", () => {
  const container = new FakeElement("div");
  const panel = renderW3MDealAgreementPanel(container, status({
    finalDeliveryConfirmation: {
      confirmed: true,
      stale: false,
      confirmationId: "7b000000-0000-4000-8000-00000000000b",
      confirmedAt: "2026-11-08T10:00:00Z",
      assetSetDigest: "b".repeat(64),
      assetCount: 3,
    },
  }), documentRef);
  const section = panel.children.find((node) => node.className === "w3m-v1-final-delivery-confirmation");
  const output = flatten(section);
  assertEquals(output.includes("Buyer confirmed the complete asset set"), true);
  assertEquals(output.includes("SHA-256 " + "b".repeat(64)), true);
});

