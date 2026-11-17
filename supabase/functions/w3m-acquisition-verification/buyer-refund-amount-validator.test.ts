import { parseW3MRefundAmount } from "./buyer-refund-amount-validator.ts";

Deno.test("refund amount validator accepts integer and decimal token amounts", () => {
  for (const value of ["0", "10", "10.25", "0.000000000000000001", "999999999999999999999.123456789012345678"]) {
    if (parseW3MRefundAmount(value, "amount") !== value) throw new Error("Valid amount changed");
  }
});

Deno.test("refund amount validator rejects malformed or imprecise values", () => {
  for (const value of [null, 10, "", "01", "-1", "1.", ".1", "1.1234567890123456789", "1\\\\.2", "1e3", " 1 "]) {
    let rejected = false;
    try { parseW3MRefundAmount(value, "amount"); } catch { rejected = true; }
    if (!rejected) throw new Error("Malformed refund amount was accepted: " + String(value));
  }
});
