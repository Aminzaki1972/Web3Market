import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const H={"Content-Type":"application/json","Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const J=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
async function sha(s:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function normalizeUrl(v:any){const raw=String(v||"").trim();if(!/^https?:\/\//i.test(raw))return raw.toLowerCase().replace(/\/$/,"");try{const u=new URL(raw);u.hash="";u.search="";u.pathname=u.pathname.replace(/\/$/,"");return u.toString().toLowerCase()}catch{return raw.toLowerCase().replace(/\/$/,"")}}
function domainOf(v:any){try{return new URL(/^https?:\/\//i.test(String(v))?String(v):"https://"+String(v)).hostname.toLowerCase().replace(/^www\./,"")}catch{return String(v||"").toLowerCase().replace(/^https?:\/\//,"").split("/")[0].replace(/^www\./,"")}}
function githubNorm(v:any){try{const raw=String(v||"").trim();const u=new URL(/^https?:\/\//i.test(raw)?raw:"https://"+raw);if(u.hostname.toLowerCase().replace(/^www\./,"")!=="github.com")return "";const p=u.pathname.split("/").filter(Boolean);return p.length>=2?("github.com/"+p[0]+"/"+p[1]).toLowerCase():""}catch{return ""}}
function isW3mCode(v:any){return /^W3M-\d{4}-\d{6}$/i.test(String(v||"").trim())}
function sanitizeSourceUrl(v:any){const raw=String(v||"").trim();if(!/^https?:\/\//i.test(raw))return "";try{const m=raw.match(/^https?:\/\/[^\s<>"\]\)]+/i);if(!m)return "";const u=new URL(m[0]);u.hash="";u.search="";u.pathname=u.pathname.replace(/\*+$/,"").replace(/\)+$/,"").replace(/\]+$/,"").replace(/\|+$/,"").replace(/\s+$/,"");return u.toString()}catch{return ""}}
function sanitizePassport(p:any){const out={...p};out.sources=Array.isArray(p?.sources)?p.sources.map((s:any)=>({...s,url:sanitizeSourceUrl(s?.url)})).filter((s:any)=>s.url):[];return out}
function collectAliases(p:any,q:string){const out:any[]=[];const add=(type:string,value:any,confidence:number,verified:boolean)=>{const n=type==="github"?githubNorm(value):type==="domain"?domainOf(value):normalizeUrl(value);if(!n)return;if(!out.some(x=>x.type===type&&x.normalized===n))out.push({type,value:String(value),normalized:n,confidence,verified})};if(p.website){add("domain",p.website,1,false);add("website",p.website,.95,false)}if(p.github)add("github",p.github,1,false);if(q&&/^https?:\/\//i.test(q))add("website",q,.7,false);for(const s of Array.isArray(p.sources)?p.sources:[]){const u=String(s?.url||"");if(!u)continue;const d=domainOf(u);if(d==="github.com")add("github",u,.85,false)}return out}
function passportEligibility(p:any){
 const name=String(p?.project_name||"").trim(); const website=String(p?.website||"").trim(); const evidence=Number(p?.evidence_score||0); const identityScore=Number(p?.identity_score ?? p?.confidence_score ?? 0);
 const sources=Array.isArray(p?.sources)?p.sources.filter((x:any)=>x&&x.url):[]; const domains=new Set<string>(); let officialDomain="";
 try{officialDomain=new URL(website).hostname.toLowerCase().replace(/^www\./,"")}catch{}
 for(const s of sources){try{domains.add(new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,""))}catch{}}
 const primary=sources.some((s:any)=>["official","github","docs","contract"].includes(String(s.type||"").toLowerCase()));
 const verifiedGithub=sources.some((s:any)=>String(s.type||"").toLowerCase()==="github"&&/verified github (?:organization|repository) linked to official domain/i.test(String(s.title||"")));
 const knownOfficial=sources.some((s:any)=>/known official project website/i.test(String(s.title||"")));
 const normalizedName=name.toLowerCase().replace(/[^a-z0-9]+/g,""); const independentIdentityDomains=new Set<string>();
 for(const s of sources){try{const d=new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,"");const title=String(s.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"");if(d&&d!==officialDomain&&normalizedName&&title.includes(normalizedName))independentIdentityDomains.add(d)}catch{}}
 const identityCorroboration=verifiedGithub||knownOfficial||independentIdentityDomains.size>0;
 const web3Signal=p?.web3_evidence_verified===true;
 const text=[name,p?.category,p?.description,p?.technology,Array.isArray(p?.blockchains)?p.blockchains.join(" "):"",Array.isArray(p?.token_or_contracts)?p.token_or_contracts.join(" "):""].join(" ").toLowerCase();
 const reasons:string[]=[]; if(!name||isW3mCode(name))reasons.push("Canonical project name is missing or invalid."); if(!website||!/^https:\/\//i.test(website))reasons.push("An official HTTPS website is required.");
 const officialSource=sources.some((s:any)=>String(s.type||"").toLowerCase()==="official"&&(()=>{try{return new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,"")===officialDomain}catch{return false}})());
 if(!officialSource)reasons.push("The official HTTPS website must be reachable and present as primary evidence."); if(identityScore<60)reasons.push("Identity score must be at least 60/100 before a W3M serial can be issued."); if(domains.size<2)reasons.push("At least 2 independent public source domains are required."); if(!primary)reasons.push("At least 1 primary evidence source is required."); if(evidence<60)reasons.push("Evidence score must be at least 60/100."); if(!web3Signal)reasons.push("Project-specific Web3 evidence was not independently verified; generic names, software repositories, or Web terminology do not qualify."); if(!identityCorroboration)reasons.push("Identity corroboration is required from an official identity reference, a verified GitHub organization, or an independent public source that explicitly identifies the same project.");
 return {eligible:reasons.length===0,score:evidence,identity_score:identityScore,independent_source_domains:domains.size,primary_evidence:primary,web3_signal:web3Signal,identity_corroboration:identityCorroboration,identity_corroboration_domains:[...independentIdentityDomains],reasons};
}
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers:H});if(req.method!=="POST")return J({error:"POST required"},405);try{const b=await req.json().catch(()=>null),q=String(b?.query||"").trim();if(!q||q.length>240)return J({error:"query is required or too long"},400);
const normalizedQuery=q.toLowerCase().replace(/[^a-z0-9]+/g,"");const genericExternalNames=new Set(["w3m","web3","ai","crypto","defi","finance","wallet","exchange","blockchain","token","dao","nft"]);const queryIsDirectUrl=/^https?:\/\//i.test(q)||/^github\.com\//i.test(q)||/^https?:\/\/github\.com\//i.test(q);if(!queryIsDirectUrl&&(normalizedQuery.length<=3||genericExternalNames.has(normalizedQuery)))return J({error:"The search term is ambiguous. Enter the specific official HTTPS website or GitHub repository. A generic/short name cannot receive a W3M Passport."},400);if(isW3mCode(q))return J({error:"W3M Passport serials must be resolved through the Passport Directory, not external research."},400);const base=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const research=await fetch(base+"/functions/v1/external-project-passport",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q})});const d=await research.json().catch(()=>null);if(!research.ok||!d?.success||!d?.passport)return J({error:d?.error||"Passport research failed"},502);const p=sanitizePassport(d.passport);const eligibility=typeof passportEligibility==="function"?passportEligibility(p):null;if(!eligibility?.eligible)return J({success:false,eligible:false,error:"This project does not currently meet the W3M Passport eligibility requirements.",eligibility},422);if(isW3mCode(p?.project_name))return J({error:"Research returned a W3M Passport serial as the project name; nothing was persisted."},422);if(!String(p?.project_name||"").trim())return J({error:"Research returned no canonical project name; nothing was persisted."},422);const canonical=String(p.website||q).trim().toLowerCase().replace(/^https?:\/\//,"").replace(/\/$/,"").slice(0,500)||q.toLowerCase();
const incomingIdentityFingerprint=await sha(JSON.stringify({website:p.website||null,github:p.github||null,project_name:p.project_name||q}));
const db=createClient(base,service);
const aliases=collectAliases(p,q);
const identityScore=Number(p?.identity_score ?? p?.confidence_score ?? 0);
const identityVerdict=String(p?.identity_verdict || (identityScore>=60 ? "verified" : identityScore>=45 ? "probable" : "candidate"));
const entityType=String(p?.entity_type || "independent_project");
const parentIdentityCode=String(p?.parent_identity_code || "").trim();
const conflicts:any[]=[];
for(const a of aliases){
 const {data:hits,error:he}=await db.from("project_identity_aliases").select("identity_id,verified").eq("alias_type",a.type).eq("normalized_value",a.normalized);
 if(he)throw he;
 for(const h of hits||[]){
  if(h.verified)conflicts.push({alias_type:a.type,normalized_value:a.normalized,identity_id:h.identity_id});
 }
}
const uniqueConflictIds=[...new Set(conflicts.map(x=>String(x.identity_id)))];
let allowedParentConflict=false;
if(uniqueConflictIds.length===1 && parentIdentityCode){
 const {data:parent}=await db.from("project_identities").select("id,identity_code").eq("identity_code",parentIdentityCode).maybeSingle();
 allowedParentConflict=!!parent?.id && String(parent.id)===uniqueConflictIds[0];
}
if(uniqueConflictIds.length>1 || (uniqueConflictIds.length===1 && !allowedParentConflict)){
 await db.from("project_identities").update({conflict_status:"possible"}).in("id",uniqueConflictIds);
 return J({success:false,eligible:false,error:"Identity conflict detected. A verified domain or GitHub identity is already linked to another W3M identity.",conflict_status:"possible",conflicts},409);
}
const {data:row,error:e}=await db.from("external_passports").upsert({canonical_key:canonical,project_name:String(p.project_name||q).slice(0,300),website_url:p.website||null,canonical_url:p.website||null,external_only:true,last_searched_at:new Date().toISOString(),status:"active",updated_at:new Date().toISOString()},{onConflict:"canonical_key"}).select("id,w3m_identity_id").single();if(e)throw e;let identityId=row.w3m_identity_id;let identity:any=null;if(identityId){const {data:i}=await db.from("project_identities").select("*").eq("id",identityId).maybeSingle();identity=i;if(identity && String(identity.identity_fingerprint||"")!==incomingIdentityFingerprint){identityId=null;identity=null}}if(!identityId && parentIdentityCode){const {data:parent,error:pe}=await db.from("project_identities").select("*").eq("identity_code",parentIdentityCode).maybeSingle();if(pe)throw pe;if(parent?.id){identityId=parent.id;identity=parent;}}
if(!identityId){for(const a of aliases){const {data:hit}=await db.from("project_identity_aliases").select("identity_id,confidence,verified").eq("alias_type",a.type).eq("normalized_value",a.normalized).maybeSingle();if(hit?.identity_id&&hit.verified){const {data:linked}=await db.from("project_identities").select("identity_status").eq("id",hit.identity_id).maybeSingle();if(String(linked?.identity_status||"").toLowerCase()==="verified"){identityId=hit.identity_id;break}}}}if(identityId){const currentStatus=String(identity?.identity_status||"").toLowerCase();if(currentStatus!=="verified" && identityVerdict==="verified"){const {data:upgraded,error:upgradeError}=await db.from("project_identities").update({identity_status:"verified",identity_score:identityScore,identity_verdict:identityVerdict,entity_type:entityType}).eq("id",identityId).select("*").single();if(upgradeError)throw upgradeError;identity=upgraded}}if(!identityId){const {data:lastIdentity,error:lastError}=await db.from("project_identities").select("sequence_no").order("sequence_no",{ascending:false}).limit(1).maybeSingle();if(lastError)throw lastError;const sequenceNo=Number(lastIdentity?.sequence_no||0)+1;const code="W3M-"+new Date().getUTCFullYear()+"-"+String(sequenceNo).padStart(6,"0"),fingerprint=await sha(JSON.stringify({website:p.website||null,github:p.github||null,project_name:p.project_name||q}));let parentId=null;if(parentIdentityCode){const {data:parent}=await db.from("project_identities").select("id,identity_code").eq("identity_code",parentIdentityCode).maybeSingle();if(parent?.id)parentId=parent.id;}const {data:i,error:ie}=await db.from("project_identities").insert({identity_code:code,sequence_no:sequenceNo,project_name:String(p.project_name||q).slice(0,300),first_seen_at:new Date().toISOString(),identity_fingerprint:fingerprint,identity_status:identityVerdict==="verified"?"verified":"probable",root_project:!parentId,entity_type:entityType,parent_identity_id:parentId,relationship_type:parentId?"child":"root",identity_score:identityScore,identity_verdict:identityVerdict}).select("*").single();if(ie)throw ie;identityId=i.id;identity=i}for(const a of aliases){const row={identity_id:identityId,alias_type:a.type,alias_value:a.value.slice(0,1000),normalized_value:a.normalized,confidence:a.confidence,verified:(a.verified || identityVerdict==="verified"),source_type:"passport_research",source_url:a.value,last_seen_at:new Date().toISOString()};const {data:ex,error:fe}=await db.from("project_identity_aliases").select("id").eq("alias_type",a.type).eq("normalized_value",a.normalized).maybeSingle();if(fe)throw fe;if(ex?.id){const {error:ue}=await db.from("project_identity_aliases").update(row).eq("id",ex.id);if(ue)throw ue}else{const {error:ie}=await db.from("project_identity_aliases").insert(row);if(ie)throw ie}}await db.from("external_passports").update({w3m_identity_id:identityId,project_name:String(identity?.project_name||p.project_name||q).slice(0,300),updated_at:new Date().toISOString()}).eq("id",row.id);if(!identity){const {data:i}=await db.from("project_identities").select("*").eq("id",identityId).single();identity=i}const fingerprint=await sha(JSON.stringify(p,Object.keys(p).sort()));const payload={passport_id:row.id,fingerprint,source_count:Array.isArray(p.sources)?p.sources.length:0,passport_payload:p,collection_status:"success"};const {data:exs,error:fs}=await db.from("external_passport_snapshots").select("id").eq("passport_id",row.id).eq("fingerprint",fingerprint).maybeSingle();if(fs)throw fs;let snap;if(exs?.id){const {data:u,error:ue}=await db.from("external_passport_snapshots").update(payload).eq("id",exs.id).select("id").single();if(ue)throw ue;snap=u}else{const {data:i,error:ie}=await db.from("external_passport_snapshots").insert(payload).select("id").single();if(ie)throw ie;snap=i}await db.from("external_passports").update({current_snapshot_id:snap.id,last_searched_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id);return J({
 success:true,
 eligible:true,
 eligibility,
 serial:identity?.identity_code||null,
 passport:{
  ...p,
  passport_eligibility:eligibility,
  passport_id:row.id,
  snapshot_id:snap.id,
  w3m_identity_id:identityId,
  w3m_identity_code:identity?.identity_code||null,
  w3m_first_seen_at:identity?.first_seen_at||null,
  w3m_identity_status:identity?.identity_status||"unverified",
  w3m_identity_score:Number(identity?.identity_score||identityScore||0),
  w3m_identity_verdict:identity?.identity_verdict||identityVerdict,
  w3m_entity_type:identity?.entity_type||entityType,
  w3m_parent_identity_code:parentIdentityCode||null,
  w3m_relationship_type:identity?.relationship_type||"root",
  monitoring_available:true
 }
})}catch(e){return J({error:e instanceof Error?e.message:"Unexpected error"},500)}});