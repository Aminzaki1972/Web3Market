// Shared strict Bearer-token parser for W3M HTTP entrypoints.
export function extractW3MBearerToken(authorization: string | null): string | null {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}
