import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const expected = {
  supabase: {
    src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js",
    integrity: "sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK",
  },
  ethers: {
    src: "https://cdn.jsdelivr.net/npm/ethers@6.15.0/dist/ethers.umd.min.js",
    integrity: "sha384-OwtfwhPoP4aGLIw192UbPWjNbSkb7AllEbIhEJ01Yp8MxhNLLNUMA+DSjh6Zct05",
  },
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const failures = [];
let supabaseTags = 0;
let ethersTags = 0;

for (const file of walk(root).filter((p) => p.endsWith(".html"))) {
  const source = fs.readFileSync(file, "utf8");
  for (const tag of source.match(/<script\b[^>]*>/gi) || []) {
    const isSupabase = tag.includes("cdn.jsdelivr.net/npm/@supabase/supabase-js@");
    const isEthers = tag.includes("cdn.jsdelivr.net/npm/ethers@6.15.0/");
    if (!isSupabase && !isEthers) continue;
    const expectedAsset = isSupabase ? expected.supabase : expected.ethers;
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] || "";
    const integrity = tag.match(/\bintegrity=["']([^"']+)["']/i)?.[1] || "";
    const crossorigin = tag.match(/\bcrossorigin=["']([^"']+)["']/i)?.[1] || "";
    if (src !== expectedAsset.src || integrity !== expectedAsset.integrity || crossorigin.toLowerCase() !== "anonymous") {
      failures.push(`${path.relative(root, file)}: CDN script is not pinned with the verified SRI attributes: ${tag}`);
    }
    if (isSupabase) supabaseTags++;
    if (isEthers) ethersTags++;
  }
}

const dynamicLoader = fs.readFileSync(path.join(root, "js/real-marketplace.js"), "utf8");
if (!dynamicLoader.includes(`s.src='${expected.supabase.src}'`) ||
    !dynamicLoader.includes(`s.integrity='${expected.supabase.integrity}'`) ||
    !dynamicLoader.includes("s.crossOrigin='anonymous'")) {
  failures.push("js/real-marketplace.js: dynamic Supabase loader is missing the verified SRI configuration");
}

if (!supabaseTags) failures.push("No pinned Supabase CDN script tags were found.");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`CDN SRI checks passed: ${supabaseTags} Supabase tag(s), ${ethersTags} ethers tag(s), and the dynamic loader.`);
