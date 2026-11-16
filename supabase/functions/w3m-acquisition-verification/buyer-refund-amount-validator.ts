// Strict decimal amount validation shared by buyer-refund Edge boundaries.
export function parseW3MRefundAmount(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(?:\\.[0-9]{1,18})?$/.test(value)) {
    throw new Error(label + " malformed");
  }
  return value;
}
