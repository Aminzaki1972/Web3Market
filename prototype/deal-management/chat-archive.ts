/**
 * Append-only Deal Room conversation archive MODEL for sandbox tests.
 *
 * This does not authenticate users, persist records, store attachment bytes,
 * deliver messages, or provide tamper-proof storage. A trusted backend must
 * derive authorId/role from an authenticated session and append atomically.
 */
export type DealChatRole = "buyer" | "seller" | "admin";

export type DealChatParticipants = {
  buyerId: string;
  sellerId: string;
  /** Admin identities allowed to join this deal conversation when needed. */
  adminIds: readonly string[];
};

export type DealChatMessage = Readonly<{
  id: string;
  dealId: string;
  authorId: string;
  role: DealChatRole;
  createdAt: number;
  content: string;
  attachmentRefs: readonly string[];
  /** A correction is a new message referencing an earlier message, never an edit. */
  correctionOf?: string;
}>;

function nonBlank(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function authorizedRole(authorId: string, role: DealChatRole, participants: DealChatParticipants): boolean {
  if (role === "buyer") return authorId === participants.buyerId;
  if (role === "seller") return authorId === participants.sellerId;
  return role === "admin" && participants.adminIds.includes(authorId);
}

/**
 * Appends one message to the deal archive. The returned array is a new value;
 * existing entries are preserved byte-for-byte and cannot be edited/deleted
 * through this API. Identity and time are still caller inputs in this model.
 */
export function appendDealChatMessage(
  archive: readonly DealChatMessage[],
  participants: DealChatParticipants,
  message: DealChatMessage,
): readonly DealChatMessage[] {
  if (!nonBlank(message.id) || !nonBlank(message.dealId) ||
      !nonBlank(message.authorId) || !["buyer", "seller", "admin"].includes(message.role) ||
      !authorizedRole(message.authorId, message.role, participants)) {
    throw new Error("Chat sender identity or role is invalid for this deal");
  }
  if (archive.some(item => item.id === message.id)) {
    throw new Error("Chat message ID already exists");
  }
  if (archive.some(item => item.dealId !== message.dealId)) {
    throw new Error("A deal archive cannot mix deal IDs");
  }
  if (!Number.isFinite(message.createdAt) ||
      (archive.length > 0 && message.createdAt < archive[archive.length - 1].createdAt)) {
    throw new Error("Chat timestamp must be valid and chronological");
  }
  if (message.content.length > 2000 ||
      (message.content.trim().length === 0 && message.attachmentRefs.length === 0) ||
      message.attachmentRefs.some(ref => !nonBlank(ref)) ||
      new Set(message.attachmentRefs).size !== message.attachmentRefs.length) {
    throw new Error("Chat content or attachment references are invalid");
  }
  if (message.correctionOf !== undefined &&
      !archive.some(item => item.id === message.correctionOf && item.dealId === message.dealId)) {
    throw new Error("A correction must reference an existing message in the same deal");
  }
  const frozenEntries = archive.map(item => Object.freeze({
    ...item, attachmentRefs: Object.freeze([...item.attachmentRefs]),
  }));
  const appended = Object.freeze({
    ...message, attachmentRefs: Object.freeze([...message.attachmentRefs]),
  });
  return Object.freeze([...frozenEntries, appended]);
}
