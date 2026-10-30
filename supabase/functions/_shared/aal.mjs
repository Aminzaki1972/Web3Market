export function verifiedAal(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)));
    return typeof claims?.aal === 'string' ? claims.aal : null;
  } catch {
    return null;
  }
}
