// W3M Protocol V1 Safe deployment policy.
// Owner order is stable for auditability; Safe execution requires 2 of these 3 owners.
export const W3M_SAFE_OWNER_ROLES = Object.freeze(["buyer", "seller", "platform"] as const);
export const W3M_SAFE_DEFAULT_THRESHOLD = 2;

export function buildW3MSafeConfiguration({
  buyerWallet,
  sellerWallet,
  platformWallet,
}: {
  buyerWallet: string;
  sellerWallet: string;
  platformWallet: string;
}) {
  const owners = [buyerWallet, sellerWallet, platformWallet];
  if (owners.some((owner) => typeof owner !== "string" || !/^0x[0-9a-f]{40}$/i.test(owner))) {
    throw new Error("W3M_SAFE_OWNER_ADDRESS_INVALID");
  }
  if (new Set(owners.map((owner) => owner.toLowerCase())).size !== 3) {
    throw new Error("W3M_SAFE_OWNERS_MUST_BE_DISTINCT");
  }
  return {
    owners,
    threshold: W3M_SAFE_DEFAULT_THRESHOLD,
    ownerRoles: [...W3M_SAFE_OWNER_ROLES],
  };
}
