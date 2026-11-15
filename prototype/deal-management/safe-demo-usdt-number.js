/**
 * Safely convert a six-decimal USDT string into the Number used by the
 * visual-only preview. Reject values whose Number round-trip changes a unit.
 */
export function parseSafeDemoUsdtNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error("Enter a valid USDT amount with up to six decimal places.");
  }
  const [whole, fraction = ""] = raw.split(".");
  const units = BigInt(whole) * 1_000_000n +
    BigInt((fraction + "000000").slice(0, 6));
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric >= 1e21) {
    throw new Error("This amount is outside the supported demo preview range.");
  }
  const [roundedWhole, roundedFraction = ""] = numeric.toFixed(6).split(".");
  const roundTripUnits = BigInt(roundedWhole) * 1_000_000n +
    BigInt(roundedFraction);
  if (roundTripUnits !== units) {
    throw new Error("This amount cannot be represented safely to six USDT decimals in the demo preview.");
  }
  return numeric;
}
