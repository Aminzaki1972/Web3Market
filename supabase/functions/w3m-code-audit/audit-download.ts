export async function readResponseBytesLimited(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array | null; tooLarge: boolean }> {
  const limit = Math.max(0, Math.floor(maxBytes));
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > limit) {
    try { await response.body?.cancel("Response exceeds configured byte limit"); } catch { /* best effort */ }
    return { bytes: null, tooLarge: true };
  }
  const reader = response.body?.getReader();
  if (!reader) return { bytes: null, tooLarge: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel("Response exceeds configured byte limit"); } catch { /* best effort */ }
        return { bytes: null, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel("Response read failed"); } catch { /* best effort */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* stream may already be released */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, tooLarge: false };
}
