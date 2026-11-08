const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type W3MProtocolTrackClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export class W3MProtocolTrackError extends Error {
  readonly code = "W3M_PROTOCOL_TRACK_UNAVAILABLE";
  constructor(message = "Authoritative deal protocol classification is unavailable.") {
    super(message);
    this.name = "W3MProtocolTrackError";
  }
}

/**
 * Reads the immutable, service-role-only deal classification.
 * No browser-provided hint or missing V1 evidence can select the legacy path.
 */
export async function getW3MDealProtocolTrack(
  admin: W3MProtocolTrackClient,
  dealId: string,
): Promise<"legacy" | "v1"> {
  if (!UUID.test(dealId)) throw new W3MProtocolTrackError("Deal ID is invalid.");
  let result: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    result = await admin.rpc("w3m_get_deal_protocol_track", { p_deal_id: dealId });
  } catch {
    throw new W3MProtocolTrackError();
  }
  if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new W3MProtocolTrackError();
  }
  const row = result.data as Record<string, unknown>;
  const track = row.protocol_track;
  const source = row.assignment_source;
  const expectedSource = track === "legacy"
    ? source === "legacy_backfill" || source === "legacy_insert"
    : track === "v1" && source === "trusted_v1_creation";
  if (String(row.deal_id || "").toLowerCase() !== dealId.toLowerCase() ||
      (track !== "legacy" && track !== "v1") || !expectedSource ||
      typeof row.assigned_at !== "string" || !Number.isFinite(Date.parse(row.assigned_at))) {
    throw new W3MProtocolTrackError("Deal protocol classification is malformed or inconsistent.");
  }
  return track;
}
