export const SKIP=/^(node_modules|vendor|\.git|dist|build|coverage|\.next|\.cache|target|bin|obj)(\/|$)/i;
export const SKIP_EXT=/\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|tar|gz|mp4|mp3|woff2?|ttf|eot)$/i;
const CODE=/\.(sol|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|sql|html?|css|scss|sass|less|vue|svelte|php|rb|swift|c|h|cc|cpp|hpp|sh|bash|ps1)$/i;
const IMPORTANT=new Set(["package.json","package-lock.json","pnpm-lock.yaml","yarn.lock","requirements.txt","pyproject.toml","Cargo.toml","go.mod","pom.xml","build.gradle","build.gradle.kts","settings.gradle","settings.gradle.kts","composer.json","composer.lock","Gemfile","Gemfile.lock","Dockerfile","docker-compose.yml","docker-compose.yaml","Makefile","deno.json","deno.jsonc","tsconfig.json","vite.config.js","vite.config.ts","next.config.js","next.config.ts","webpack.config.js","foundry.toml","hardhat.config.js","hardhat.config.ts","truffle-config.js","remappings.txt"]);
export function tier(p:string){const b=p.split("/").pop()||"";if(IMPORTANT.has(b)||p.startsWith("supabase/")||p.startsWith(".github/")||/\.(ya?ml|json)$/.test(p))return 2;if(CODE.test(p))return 1;return 3;}
const TEST_PATH=/(^|\/)(tests?|specs?|__tests__|__mocks__|fixtures?|mocks?|harness|certora|echidna|medusa)(\/|$)|\.(test|spec)\.[^.]+$/i;
const CRITICAL_PATH=/(^|\/)(contracts?|src\/contracts?|supabase\/functions|api|app\/api|pages\/api|server|middleware|auth|security|escrow|settlement|payment|payments|wallet|multisig|access-control|accesscontrol|policies)(\/|$)/i;
const CRITICAL_FILE=/(^|\/)(middleware|auth|authorization|authentication|escrow|settlement|payment|payments|wallet|multisig|access-control|accesscontrol|rls|security)\.[^.]+$/i;
export function auditPriority(p:string){
 const b=p.split("/").pop()||"";
 if(TEST_PATH.test(p))return 4;
 // First inspect contracts and code paths that commonly enforce trust boundaries or move assets.
 if(/\.sol$/i.test(p)||CRITICAL_PATH.test(p)||CRITICAL_FILE.test(p))return 0;
 // Dependency manifests and build/runtime configuration help establish the attack surface.
 if(IMPORTANT.has(b)||p.startsWith(".github/")||/\.(ya?ml|json)$/i.test(p))return 1;
 if(CODE.test(p))return 2;
 return 3;
}
export function selectAuditCandidates(tree:any[],limit=100){const allCandidates=tree.filter((x:any)=>x.type==="blob"&&!SKIP.test(x.path)&&!SKIP_EXT.test(x.path)&&tier(x.path)<=2).sort((a:any,b:any)=>auditPriority(a.path)-auditPriority(b.path)||a.path.localeCompare(b.path));return {allCandidates,candidates:allCandidates.slice(0,limit),candidateCount:allCandidates.length};}
// Coverage deliberately uses the full eligible-file denominator, not the capped selected list.
export function calculateAuditCoverage(scanned:number,eligible:number){return Math.max(0,Math.min(100,Math.round(scanned/Math.max(1,eligible)*100)));}


export function selectAuditBatch<T extends { path: string }>(candidates: T[], batchIndex: number, batchSize = 100) {
  const size = Math.max(1, Math.floor(Number.isFinite(batchSize) ? batchSize : 100));
  const requestedIndex = Math.max(0, Math.floor(Number.isFinite(batchIndex) ? batchIndex : 0));
  const totalBatches = Math.max(1, Math.ceil(candidates.length / size));
  const index = Math.min(requestedIndex, totalBatches - 1);
  const start = index * size;
  const end = Math.min(candidates.length, start + size);
  return { candidates: candidates.slice(start, end), batchIndex: index, totalBatches, start, end };
}


// Split every selected file into bounded evidence chunks; never silently drop a file
// merely because its content is larger than the model context budget.
export function buildAuditChunks(files: Array<{ path: string; content: string }>, maxChars = 90000): string[] {
  const limit = Math.max(1024, Math.floor(Number.isFinite(maxChars) ? maxChars : 90000));
  const chunks: string[] = [];
  let current = "";
  for (const file of files) {
    const content = String(file.content || "");
    const header = "===== FILE: " + file.path + " =====\n";
    const partSize = Math.max(1, limit - header.length - 160);
    for (let offset = 0, part = 0; offset < content.length || (!content.length && part === 0); offset += partSize, part++) {
      const lineStart = content.slice(0, offset).split("\n").length;
      const block = header + "[content part " + (part + 1) + ", starts near line " + lineStart + "]\n" + content.slice(offset, offset + partSize) + "\n";
      if (current && current.length + block.length > limit) {
        chunks.push(current);
        current = "";
      }
      current += block;
      if (!content.length) break;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
