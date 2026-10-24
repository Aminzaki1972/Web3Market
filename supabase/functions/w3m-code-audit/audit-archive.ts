import { unzipSync } from "npm:fflate@0.8.2";

export function decodeSelectedArchive(zipBytes: Uint8Array, candidates: any[], maxFileBytes = 1000000) {
  const entries = unzipSync(zipBytes);
  const keys = Object.keys(entries);
  const firstPath = keys.find((key) => key.includes("/"));
  const root = firstPath?.split("/")[0];
  if (!root) throw new Error("GitHub archive did not contain a repository root.");

  const files: { path: string; content: string }[] = [];
  let oversizedFiles = 0;
  let unreadableFiles = 0;
  for (const candidate of candidates) {
    if ((candidate.size || 0) > maxFileBytes) {
      oversizedFiles++;
      continue;
    }
    const entry = entries[root + "/" + candidate.path];
    if (!entry) {
      unreadableFiles++;
      continue;
    }
    try {
      files.push({ path: candidate.path, content: new TextDecoder().decode(entry) });
    } catch {
      unreadableFiles++;
    }
  }
  return { files, oversizedFiles, unreadableFiles };
}
