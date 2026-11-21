// W3M Protocol V1 — require a Supabase-verified administrator session at AAL2.
// The Auth server validates the supplied JWT for both user identity and MFA assurance.
export interface W3MAdminAuthClient {
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    mfa: {
      getAuthenticatorAssuranceLevel(token: string): Promise<{ data: { currentLevel?: string | null } | null; error: unknown }>;
    };
  };
}

export async function authenticateVerifiedAdminAal2(
  client: W3MAdminAuthClient,
  token: string,
): Promise<string | null> {
  if (typeof token !== "string" || !token.trim() || token.length > 8192) return null;
  try {
    const [userResult, aalResult] = await Promise.all([
      client.auth.getUser(token),
      client.auth.mfa.getAuthenticatorAssuranceLevel(token),
    ]);
    if (userResult.error || aalResult.error) return null;
    const userId = userResult.data.user?.id;
    if (typeof userId !== "string" || !userId.trim()) return null;
    if (aalResult.data?.currentLevel !== "aal2") return null;
    return userId;
  } catch {
    return null;
  }
}
