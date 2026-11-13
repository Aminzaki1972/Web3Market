import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { confirmW3MDealDelivery, getW3MDealAgreementStatus } from "./w3m-deal-agreement-client.js";

const DEAL_ID = "71000000-0000-4000-8000-000000000001";

Deno.test("agreement status normalizes final delivery confirmation", async () => {
  const status = await getW3MDealAgreementStatus({
    dealId: DEAL_ID,
    accessToken: "local-test-session",
    request: async () => ({
      ok: true,
      result: {
        deal_id: DEAL_ID,
        viewer_role: "buyer",
        both_accepted: true,
        deal_eligible: false,
        current_terms: null,
        acceptances: {
          buyer: { accepted: true, accepted_at: "2026-11-08T10:00:00Z" },
          seller: { accepted: true, accepted_at: "2026-11-08T10:01:00Z" },
        },
        assets: [],
        final_delivery_confirmation: {
          confirmed: false,
          stale: true,
          confirmation_id: "7b000000-0000-4000-8000-00000000000b",
          terms_version: 2,
          terms_hash: "c".repeat(64),
          asset_set_digest: "b".repeat(64),
          asset_count: 2,
          current_asset_count: null,
          confirmed_at: "2026-11-08T09:00:00Z",
        },
      },
    }),
  });
  assertEquals(status.finalDeliveryConfirmation.confirmed, false);
  assertEquals(status.finalDeliveryConfirmation.stale, true);
  assertEquals(status.finalDeliveryConfirmation.assetCount, 2);
  assertEquals(status.finalDeliveryConfirmation.termsVersion, "2");
});

Deno.test("final delivery confirmation client submits only the deal ID", async () => {
  let sent;
  const result = await confirmW3MDealDelivery({
    dealId: DEAL_ID,
    accessToken: "local-test-session",
    request: async (body) => {
      sent = body;
      return {
        ok: true,
        result: {
          confirmation_id: "7b000000-0000-4000-8000-00000000000b",
          terms_version: 2,
          terms_hash: "c".repeat(64),
          asset_set_digest: "b".repeat(64),
          asset_count: 2,
          confirmed_at: "2026-11-08T10:00:00Z",
          created: true,
        },
      };
    },
  });
  assertEquals(sent, { action: "confirm_delivery", deal_id: DEAL_ID });
  assertEquals(result.confirmationId, "7b000000-0000-4000-8000-00000000000b");
  assertEquals(result.assetCount, 2);
  assertEquals(result.created, true);
});

Deno.test("final delivery confirmation client rejects malformed confirmation records", async () => {
  await assertRejects(() => confirmW3MDealDelivery({
    dealId: DEAL_ID,
    accessToken: "local-test-session",
    request: async () => ({ ok: true, result: { confirmation_id: "bad" } }),
  }));
});
