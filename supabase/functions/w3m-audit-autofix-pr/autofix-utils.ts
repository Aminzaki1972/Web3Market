export function isAllowedAutoFixPath(path: string): boolean {
 const value=String(path||"");
 if(!value||value.startsWith("/")||value.split("/").some(part=>part===".."||part==="."))return false;
 if(/(^|\/)(?:\.env(?:\..*)?|secrets?|credentials?|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|deno\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|go\.sum|\.github|\.git|supabase\/migrations)(?:\/|$)/i.test(value))return false;
 return /\.(?:ts|tsx|js|jsx|mjs|cjs|sol|rs|py|go|java|cs|php|rb|vue|svelte|html|css)$/i.test(value);
}
export function applyExactReplacement(source: string, original: string, replacement: string): string | null {
 if(!original||original===replacement||original.length>12000||replacement.length>12000)return null;
 const first=source.indexOf(original);
 if(first<0||source.indexOf(original,first+1)>=0)return null;
 return source.slice(0,first)+replacement+source.slice(first+original.length);
}
