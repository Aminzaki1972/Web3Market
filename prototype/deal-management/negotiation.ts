/**
 * Pure negotiation and agreement-version rules for the isolated sandbox.
 * No persistence, authentication, hashing, network, wallet or signing side effects.
 */
export type DealParty = "buyer" | "seller" | "platform";
export type OfferStatus = "open" | "accepted" | "rejected" | "superseded";
export type PriceOffer = {
  id: string;
  amountUsdt: bigint;
  proposer: "buyer" | "seller";
  status: OfferStatus;
};
export type NegotiationState = {
  listingPriceUsdt: bigint;
  offers: PriceOffer[];
  preliminarySellerAcceptance: boolean;
  finalPriceAccepted: boolean;
};

export type PriceAction =
  | { type: "counter"; offerId: string; amountUsdt: bigint }
  | { type: "accept"; offerId: string }
  | { type: "reject"; offerId: string }
  | { type: "preliminary_seller_accept"; offerId: string };

export function startNegotiation(listingPriceUsdt: bigint, initialBuyerOffer: bigint, offerId: string): NegotiationState {
  if (listingPriceUsdt <= 0n || initialBuyerOffer <= 0n || !offerId.trim()) {
    throw new Error("Listing price, initial offer and offer ID must be valid");
  }
  return {
    listingPriceUsdt,
    offers: [{ id: offerId, amountUsdt: initialBuyerOffer, proposer: "buyer", status: "open" }],
    preliminarySellerAcceptance: false,
    finalPriceAccepted: false,
  };
}

/**
 * A seller's preliminary acceptance is explicitly non-binding: it does not
 * accept/close the offer, lock the price, or authorize agreement/deposit.
 */
export function applyPriceAction(
  state: NegotiationState,
  actor: "buyer" | "seller",
  action: PriceAction,
): NegotiationState {
  if (state.finalPriceAccepted) throw new Error("Price negotiation is already accepted");
  const current = state.offers.find((offer) => offer.id === action.offerId && offer.status === "open");
  if (!current) throw new Error("Open offer not found");

  if (action.type === "preliminary_seller_accept") {
    if (actor !== "seller" || current.proposer !== "buyer" || state.preliminarySellerAcceptance) {
      throw new Error("Only the seller may preliminarily accept the buyer's initial offer");
    }
    return { ...state, preliminarySellerAcceptance: true };
  }

  if (current.proposer === actor) throw new Error("A party cannot respond to its own offer");

  if (action.type === "accept") {
    return {
      ...state,
      offers: state.offers.map((offer) => offer.id === current.id ? { ...offer, status: "accepted" } : offer),
      finalPriceAccepted: true,
    };
  }

  if (action.type === "reject") {
    return {
      ...state,
      offers: state.offers.map((offer) => offer.id === current.id ? { ...offer, status: "rejected" } : offer),
    };
  }

  if (action.amountUsdt <= 0n || !action.offerId.trim() ||
      state.offers.some((offer) => offer.id === action.offerId)) {
    throw new Error("Counter-offer amount and unique ID must be valid");
  }
  return {
    ...state,
    offers: [
      ...state.offers.map((offer) => offer.id === current.id ? { ...offer, status: "superseded" as const } : offer),
      { id: action.offerId, amountUsdt: action.amountUsdt, proposer: actor, status: "open" },
    ],
  };
}

export type AgreementApprovalState = {
  version: number;
  snapshotHash: string;
  approvals: Partial<Record<DealParty, { version: number; snapshotHash: string }>>;
};

export function createAgreement(version: number, snapshotHash: string): AgreementApprovalState {
  if (!Number.isInteger(version) || version < 1 || !/^0x[0-9a-fA-F]{64}$/.test(snapshotHash)) {
    throw new Error("Agreement version and 32-byte snapshot hash are required");
  }
  return { version, snapshotHash: snapshotHash.toLowerCase(), approvals: {} };
}

/** A changed agreement version/hash invalidates every previous approval. */
export function reviseAgreement(
  current: AgreementApprovalState,
  nextVersion: number,
  nextSnapshotHash: string,
): AgreementApprovalState {
  if (nextVersion !== current.version + 1) throw new Error("Agreement versions must increase by exactly one");
  return createAgreement(nextVersion, nextSnapshotHash);
}

export function approveAgreement(
  state: AgreementApprovalState,
  party: DealParty,
  version: number,
  snapshotHash: string,
): AgreementApprovalState {
  if (version !== state.version || snapshotHash.toLowerCase() !== state.snapshotHash) {
    throw new Error("Approval must reference the exact current agreement version and hash");
  }
  if (state.approvals[party]) throw new Error("Party has already approved this agreement version");
  return {
    ...state,
    approvals: { ...state.approvals, [party]: { version, snapshotHash: state.snapshotHash } },
  };
}

export function isAgreementFullyApproved(state: AgreementApprovalState): boolean {
  return (["buyer", "seller", "platform"] as const).every((party) =>
    state.approvals[party]?.version === state.version &&
    state.approvals[party]?.snapshotHash === state.snapshotHash
  );
}
