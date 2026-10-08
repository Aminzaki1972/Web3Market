import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const C={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"};
const allowedOrigins=["https://web3market.xyz","https://www.web3market.xyz","https://aminzaki1972.github.io"];
const headers=(req:Request)=>({...C,"Access-Control-Allow-Origin":allowedOrigins.includes(req.headers.get("Origin")||"")?(req.headers.get("Origin")||""):"https://web3market.xyz"});
const J=(x:any,s=200,req?:Request)=>new Response(JSON.stringify(x),{status:s,headers:req?headers(req):C});
const clean=(x:string)=>x.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
async function get(u:string,h:any={}){try{const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(5000)});return {ok:r.ok,status:r.status,text:await r.text()}}catch(e){return {ok:false,status:0,text:""}}}
function src(title:string,url:string,type:string){return {title,url,type}}
function unique(a:any[]){const rank=(x:any)=>{const t=String(x?.title||"");if(/Verified GitHub organization linked to official domain/i.test(t))return 100;if(/Known official project website/i.test(t))return 90;if(String(x?.type||"").toLowerCase()==="official")return 80;return 10};const m=new Map<string,any>();for(const x of a.filter(x=>x?.url)){const k=String(x.url);const prev=m.get(k);if(!prev||rank(x)>rank(prev))m.set(k,x)}return [...m.values()]}
function addresses(s:string){return [...new Set((s.match(/0x[a-fA-F0-9]{40}/g)||[]))].slice(0,20)}
function category(s:string){const x=s.toLowerCase();const a:any[]=[["supabase extension","Developer Tools / Supabase"],["supabase","Developer Tools / Supabase"],["developer tool","Developer Tools"],["developer tools","Developer Tools"],["devtool","Developer Tools"],["sdk","Developer Tools"],["api","Developer Tools"],["lending","DeFi / Lending"],["defi","DeFi"],["dex","DEX / Exchange"],["exchange","Exchange"],["gaming","Gaming"],["nft","NFT / Digital Assets"],["dao","DAO"],["wallet","Wallet"],["marketplace","Marketplace"],["infrastructure","Infrastructure"],["layer 2","Blockchain Infrastructure"],["ai","AI / Web3"],["social","Social Web3"]];for(const z of a)if(x.includes(z[0]))return z[1];return null}
function chain(s:string){const x=s.toLowerCase(),a:string[]=[];if(/ethereum|erc-20|evm/.test(x))a.push("Ethereum / EVM");if(/bnb|binance|bsc|bep-20/.test(x))a.push("BNB Smart Chain");if(/polygon/.test(x))a.push("Polygon");if(/solana|spl/.test(x))a.push("Solana");if(/arbitrum/.test(x))a.push("Arbitrum");if(/optimism/.test(x))a.push("Optimism");return [...new Set(a)]}
function urls(s:string){const a:string[]=[];const r=/https?:\/\/[^\s"'<>]+/gi;let m;while((m=r.exec(s))&&a.length<60)a.push(m[0].replace(/[),.;]+$/,""));return [...new Set(a)]}
function ddgLinks(s:string){const out:string[]=[];const re=/href=["'](?:\/\/duckduckgo\.com\/l\/\?[^"']*uddg=|https?:\/\/)[^"']+["']/gi;let m;while((m=re.exec(s))&&out.length<30){let h=m[0].slice(6,-1);try{if(h.startsWith("//"))h="https:"+h;const u=new URL(h);const v=u.searchParams.get("uddg");out.push(v?decodeURIComponent(v):h)}catch{}}return [...new Set(out)]}
function evidenceUrlAllowed(raw:string){try{const u=new URL(raw);const h=u.hostname.replace(/^www\\./i,"").toLowerCase();if(!/^https?:$/.test(u.protocol))return false;if(/^(viem\\.sh|nodereal\\.io|your-rpc-endpoint|nodejs\\.org|npmjs\\.com|typescriptlang\\.org|developer\\.mozilla\\.org|developer\\.mozilla\\.com|w3\\.org|reactjs\\.org|nextjs\\.org|deno\\.land)$/.test(h))return false;if(/(^|\\.)example\\.(com|org|net)$|localhost|127\\.0\\.0\\.1/i.test(h))return false;return true}catch{return false}}
function filteredEvidenceUrls(text:string){return urls(text).filter(evidenceUrlAllowed).slice(0,12)}
function repoScore(r:any,q:string){const n=String(q).toLowerCase().replace(/[^a-z0-9]/g,"");const rn=String(r.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");const full=String(r.full_name||"").toLowerCase().replace(/[^a-z0-9]/g,"");const d=(String(r.description||"")+" "+String(r.topics||"")).toLowerCase();let s=0;if(rn===n)s+=100;if(rn.includes(n)||n.includes(rn))s+=45;if(full.includes(n))s+=25;if(/web3|defi|blockchain|crypto|ethereum|solana|bnb|polygon|uniswap|aave|swap|dao|wallet|protocol|liquidity|amm|dlmm|onchain|token/.test(d))s+=20;s+=Math.min(20,Number(r.stargazers_count||0)/10);return s}
function strongWeb3Evidence(repo:any,description:string|null,site:string){const x=(String(repo?.description||"")+" "+String(repo?.topics||"")+" "+String(description||"")+" "+site).toLowerCase();return /web3|defi|blockchain|crypto|solana|ethereum|liquidity pool|amm|dlmm|onchain|smart contract|token launch|dex/.test(x)}
const known:any={};
function passportEligibility(p:any){
 const name=String(p?.project_name||"").trim(); const website=String(p?.website||"").trim(); const evidence=Number(p?.evidence_score||0); const identityScore=Number(p?.identity_score ?? p?.confidence_score ?? 0);
 const sources=Array.isArray(p?.sources)?p.sources.filter((x:any)=>x&&x.url):[]; const domains=new Set<string>(); let officialDomain="";
 try{officialDomain=new URL(website).hostname.toLowerCase().replace(/^www\./,"")}catch{}
 for(const s of sources){try{domains.add(new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,""))}catch{}}
 const primary=sources.some((s:any)=>["official","github","docs","contract"].includes(String(s.type||"").toLowerCase()));
 const verifiedGithub=sources.some((s:any)=>String(s.type||"").toLowerCase()==="github"&&/verified github organization linked to official domain/i.test(String(s.title||"")));
 const knownOfficial=sources.some((s:any)=>/known official project website/i.test(String(s.title||"")));
 const normalizedName=name.toLowerCase().replace(/[^a-z0-9]+/g,""); const independentIdentityDomains=new Set<string>();
 for(const s of sources){try{const d=new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,"");const title=String(s.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"");if(d&&d!==officialDomain&&normalizedName&&title.includes(normalizedName))independentIdentityDomains.add(d)}catch{}}
 const identityCorroboration=verifiedGithub||knownOfficial||independentIdentityDomains.size>0;
 const text=[name,p?.category,p?.description,p?.technology,Array.isArray(p?.blockchains)?p.blockchains.join(" "):"",Array.isArray(p?.token_or_contracts)?p.token_or_contracts.join(" "):""].join(" ").toLowerCase();
 const web3Signal=!!(p?.blockchains?.length)||!!(p?.token_or_contracts?.length)||Array.isArray(p?.sources)&&p.sources.some((s:any)=>s?.type==="web3_identity")||/web3|blockchain|crypto|defi|nft|dao|wallet|token|smart contract|layer 2|dex|exchange|solana|ethereum|bnb|polygon|arbitrum|optimism|liquidity|amm|dlmm|onchain/.test(text);
 const reasons:string[]=[]; if(!name||isW3mCode(name))reasons.push("Canonical project name is missing or invalid."); if(!website||!/^https:\/\//i.test(website))reasons.push("A reachable HTTPS official website is required.");
 const officialSource=sources.some((s:any)=>String(s.type||"").toLowerCase()==="official"&&(()=>{try{return new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,"")===officialDomain}catch{return false}})());
 if(!officialSource)reasons.push("The official HTTPS website must be reachable and present as primary evidence."); if(identityScore<60)reasons.push("Identity score must be at least 60/100 before a W3M serial can be issued."); if(domains.size<2)reasons.push("At least 2 independent public source domains are required."); if(!primary)reasons.push("At least 1 primary evidence source is required."); if(evidence<60)reasons.push("Evidence score must be at least 60/100."); if(!web3Signal)reasons.push("The collected evidence does not establish a Web3/project identity."); if(!identityCorroboration)reasons.push("Identity corroboration is required from an official identity reference, a verified GitHub organization, or an independent public source that explicitly identifies the same project.");
 return{eligible:reasons.length===0,score:evidence,identity_score:identityScore,independent_source_domains:domains.size,primary_evidence:primary,web3_signal:web3Signal,identity_corroboration:identityCorroboration,identity_corroboration_domains:[...independentIdentityDomains],reasons};
}
function isW3mCode(v:any){return /^W3M-\d{4}-\d{6}$/i.test(String(v||"").trim())}
function knownProject(q:string){return null}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(req)});
 if(req.method!=="POST")return J({error:"POST required"},405,req);
 try{
  const b=await req.json().catch(()=>null),q=String(b?.query||"").trim();if(!q)return J({error:"query is required"},400,req);if(q.length>240)return J({error:"query is too long"},400,req);if(isW3mCode(q))return J({error:"W3M Passport serials are identifiers, not external research queries. Use the Passport Directory."},400,req);
  let collectedContractAddresses:string[]=[];
  let name=q,website:string|null=/^https?:\/\//i.test(q)?q.replace(/\/$/,""):null,github:string|null=null,description:string|null=null,technology:string|null=null,repo:any=null,site="",sources:any[]=[],verifiedGithubName:string|null=null;
  // Resolve GitHub URLs before normal website parsing.
  // github.com/{org} is an organization identity, not the project name "GitHub".
  if(/^https?:\/\/github\.com\//i.test(q)){
    const u=new URL(q); const parts=u.pathname.split("/").filter(Boolean);
    if(parts.length>=1){
      const owner=parts[0], repoName=parts[1];
      try{
        if(repoName){
          const rr=await fetch("https://api.github.com/repos/"+owner+"/"+repoName,{headers:{accept:"application/vnd.github+json","user-agent":"W3M-Passport"}});
          if(rr.ok){ const rj=await rr.json(); repo=rj.html_url||("https://github.com/"+owner+"/"+repoName); github="https://github.com/"+owner; name=String(rj.name||repoName); description=String(rj.description||""); technology=String(rj.language||""); if(rj.homepage) website=String(rj.homepage); addSource({title:"GitHub repository identity",url:repo,type:"github"}); }
        }else{
          const gr=await fetch("https://api.github.com/orgs/"+owner,{headers:{accept:"application/vnd.github+json","user-agent":"W3M-Passport"}});
          if(gr.ok){ const gj=await gr.json();
            if(String(gj.type||"").toLowerCase()==="organization"){
              github="https://github.com/"+(gj.login||owner); name=String(gj.name||gj.login||owner); description=String(gj.description||""); if(gj.blog) website=String(gj.blog); if(gj.is_verified){ verifiedGithubName=name; addSource({title:"Verified GitHub organization linked to official domain",url:github,type:"github"}); } else addSource({title:"GitHub organization identity",url:github,type:"github"});
              if(!gj.is_verified) addSource({title:"GitHub organization identity",url:github,type:"github"});
              const rr=await fetch("https://api.github.com/orgs/"+(gj.login||owner)+"/repos?per_page=10&sort=updated",{headers:{accept:"application/vnd.github+json","user-agent":"W3M-Passport"}});
              if(rr.ok){ const repos=await rr.json(); if(Array.isArray(repos)) for(const rj of repos.slice(0,5)) if(rj.html_url) addSource({title:"GitHub organization repository",url:String(rj.html_url),type:"github"}); }
            }
          }
        }
      }catch{}
    }
  }

  const kp=knownProject(q);
  if(kp){name=kp.name;website=kp.website;github=kp.github;sources.push(src("Known official project website",kp.website,"official"));if(kp.github)sources.push(src("Known official GitHub organization",kp.github,"github"))}
  if(!kp && !website){
   const gh=await get("https://api.github.com/search/repositories?q="+encodeURIComponent(q)+"&per_page=10",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
   if(gh.ok)try{
     const j=JSON.parse(gh.text),items=(j.items||[]).sort((a:any,b:any)=>repoScore(b,q)-repoScore(a,q)),r=items[0];
     if(r){
       repo=r;github=r.html_url;name=r.name||q;description=r.description||null;technology=r.language||null;
       sources.push(src("GitHub repository",github,"github"));
       // Recover the official website from the repository owner/org profile when the repo itself has no homepage.
       const owner=String(r?.owner?.login||"");
       if(owner && !website){
         const pr=await get("https://api.github.com/users/"+encodeURIComponent(owner),{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
         if(pr.ok)try{
           const px=JSON.parse(pr.text),blog=String(px?.blog||"").trim();
           if(/^https?:\/\//i.test(blog)){
             const bh=new URL(blog).hostname.replace(/^www\./i,"").toLowerCase();
             const qn=String(q).toLowerCase().replace(/[^a-z0-9]/g,"");
             const on=owner.toLowerCase().replace(/[^a-z0-9]/g,"");
             const likely=bh.includes(qn)||on.includes(qn)||qn.includes(on);
             if(likely) website=blog.replace(/\/$/,"");
           }
         }catch{}
       }
     }
   }catch{}
   const w=await get("https://html.duckduckgo.com/html/?q="+encodeURIComponent(q+" official website Web3"));
   if(w.ok){for(const u of ddgLinks(w.text).filter(x=>!/(duckduckgo\.com|google\.com)/i.test(x)).slice(0,12)){if(!website&&!/github\.com/i.test(u))website=u;sources.push(src("Public web result",u,"web"))}}
  }
  if(repo){
   const d=await get("https://api.github.com/repos/"+repo.full_name,{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});if(d.ok)try{const x=JSON.parse(d.text);repo={...repo,...x};website=website||x.homepage||null;description=description||x.description}catch{}
   // Generic owner-profile fallback: GitHub organizations often publish the official website on their profile,
   // while individual repositories may have no homepage field. Resolve only when the profile link matches
   // the searched identity, avoiding arbitrary third-party links.
   if(!website){
     try{
       const owner=String(repo?.owner?.login||"");
       if(owner){
         const page=await get("https://github.com/"+encodeURIComponent(owner),{"User-Agent":"Web3Market External Passport"});
         if(page.ok){
           const links=urls(page.text).filter(u=>/^https:\/\//i.test(u)&&!/github\.com\//i.test(u));
           const qn=String(q).toLowerCase().replace(/[^a-z0-9]/g,"");
           const on=owner.toLowerCase().replace(/[^a-z0-9]/g,"");
           const candidate=links.find(u=>{
             try{
               const h=new URL(u).hostname.replace(/^www\./i,"").toLowerCase().replace(/[^a-z0-9]/g,"");
               return h.includes(qn)||on.includes(qn)||qn.includes(on);
             }catch{return false}
           });
           if(candidate)website=candidate.replace(/\/$/,"");
         }
       }
     }catch{}
   }
   const l=await get("https://api.github.com/repos/"+repo.full_name+"/languages",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});if(l.ok)try{const x=JSON.parse(l.text);technology=Object.keys(x).slice(0,8).join(", ")||technology}catch{}
   const rd=await get("https://raw.githubusercontent.com/"+repo.full_name+"/"+(repo.default_branch||"main")+"/README.md",{"User-Agent":"Web3Market"});if(rd.ok){const aa=addresses(rd.text);for(const u of filteredEvidenceUrls(rd.text)){sources.push(src("README public link",u,"readme"));if(!website){try{const ru=new URL(u);const rh=ru.hostname.replace(/^www\\./i,"").toLowerCase();const target=String(q).toLowerCase().replace(/^https?:\/\//i,"").replace(/^www\./,"").split(/[/?#]/)[0].toLowerCase();const projectHost=target||String(repo?.name||"").toLowerCase().replace(/[^a-z0-9.-]/g,"");if(rh===projectHost||rh==="web3market.xyz"||rh.endsWith(".web3market.xyz"))website=u.replace(/\/$/,"")}catch{}}}if(aa.length){collectedContractAddresses.push(...aa);sources.push(src("Contract addresses in README",github,"contract"))}}
  }
  if(github&&!repo){
   const m=github.match(/github\.com\/([^/]+)(?:\/([^/#?]+))?/i);
   if(m){
    if(m[2]){
     const r=await get("https://api.github.com/repos/"+m[1]+"/"+m[2],{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
     if(r.ok)try{repo=JSON.parse(r.text);name=repo.name||name;description=description||repo.description;technology=technology||repo.language}catch{}
    }else{
     const r=await get("https://api.github.com/orgs/"+m[1]+"/repos?per_page=10&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
     if(r.ok)try{const rs=JSON.parse(r.text),langs=[...new Set(rs.map((x:any)=>x.language).filter(Boolean))].slice(0,8);technology=langs.join(", ")||technology;const best=rs.sort((x:any,y:any)=>Number(y.stargazers_count||0)-Number(x.stargazers_count||0))[0];if(best){repo=best;description=description||best.description;name=kp?.name||name;}}catch{}
    }
   }
  }
  // Verify an already-discovered GitHub organization against the official website domain.
  if(website && github && !sources.some((x:any)=>x.type==="github" && /Verified GitHub organization linked to official domain/i.test(String(x.title||"")))){
    try{
      const host=new URL(website).hostname.replace(/^www\./i,"").toLowerCase();
      const gm=github.match(/github\.com\/([^/]+)/i);
      if(gm){
        const owner=gm[1];
        const profile=await get("https://api.github.com/users/"+encodeURIComponent(owner),{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
        let verified=false;
        if(profile.ok)try{
          const x=JSON.parse(profile.text);
          const links=[x.blog,x.html_url].filter(Boolean).map((v:string)=>String(v).toLowerCase());
          verified=links.some((v:string)=>v.includes(host));
        }catch{}
        if(!verified){
          const page=await get("https://github.com/"+encodeURIComponent(owner),{"User-Agent":"Web3Market External Passport"});
          if(page.ok){
            const body=page.text.toLowerCase();
            verified=body.includes(host)||body.includes("https://"+host)||body.includes("http://"+host);
          }
        }
        if(verified)sources.push(src("Verified GitHub organization linked to official domain","https://github.com/"+owner,"github"));
      }
    }catch{}
  }

  if(website){try{const wu=new URL(website);const wh=wu.hostname.replace(/^www\./i,"");if(wh==="jup.ag"||wh.endsWith(".jup.ag")){sources.push(src("Official Jupiter Developer Documentation","https://developers.jup.ag/","docs"));sources.push(src("Official Jupiter Support Documentation","https://support.jup.ag/","docs"));}}catch{}const r=await get(website,{"User-Agent":"Web3Market External Passport"});if(r.ok){site=r.text;sources.unshift(src("Official website",website,"official"));const t=/<title[^>]*>([\\s\\S]*?)<\/title>/i.exec(r.text);const d=/<meta[^>]+(?:name|property)=[\"'](?:description|og:description)[\"'][^>]+content=[\"']([^\"']*)[\"']/i.exec(r.text);const siteName=/<meta[^>]+(?:property|name)=[\"'](?:og:site_name|application-name)[\"'][^>]+content=[\"']([^\"']*)[\"']/i.exec(r.text);if(!kp){const candidate=clean(siteName?.[1]||"");if(candidate&&candidate.length<=80)name=candidate;else if(t){const title=clean(t[1]);const stripped=title.split(/\s+[|—–-]\s+/)[0].trim();name=stripped||title||name;}}if(d)description=description||clean(d[1]);for(const u of urls(r.text)){if(/github\.com\//i.test(u))github=github||u;if(/\/docs?\b|documentation|^https?:\/\/docs\.|\.docs\./i.test(u))sources.push(src("Documentation",u,"docs"));if(/x\.com\//i.test(u)||/twitter\.com\//i.test(u))sources.push(src("X / Twitter",u,"social"));if(/t\.me\//i.test(u))sources.push(src("Telegram",u,"social"));if(/discord\.(gg|com)\//i.test(u))sources.push(src("Discord",u,"social"))}}}
  
// URL-first identity recovery: resolve GitHub and enrich evidence after reading the official website.
if(website && !repo && github){
  const m=github.match(/github\.com\/([^/]+)(?:\/([^/#?]+))?/i);
  if(m){
    if(m[2]){
      const rr=await get("https://api.github.com/repos/"+m[1]+"/"+m[2],{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
      if(rr.ok)try{repo=JSON.parse(rr.text);name=kp?.name||repo.name||name;description=description||repo.description||null;technology=technology||repo.language||null}catch{}
    }else{
      const rr=await get("https://api.github.com/orgs/"+m[1]+"/repos?per_page=20&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
      if(rr.ok)try{const rs=JSON.parse(rr.text)||[];const best=rs.sort((a:any,b:any)=>repoScore(b,name)-repoScore(a,name))[0];if(best){repo=best;description=description||best.description||null;technology=technology||best.language||null}}catch{}
    }
  }
}
if(website && !repo && !github){
  let identityQuery="";
  let websiteHost="";
  try{
    const u=new URL(website);
    websiteHost=u.hostname.replace(/^www\./i,"").toLowerCase();
    identityQuery=websiteHost.replace(/\.[a-z]{2,}$/i,"").replace(/[-_]+/g," ");
  }catch{
    identityQuery=String(q).replace(/^https?:\/\//i,"").replace(/^www\./i,"").split(/[/?#]/)[0].replace(/\.[a-z]{2,}$/i,"").replace(/[-_]+/g," ");
  }
  const queries=[identityQuery,identityQuery+" web3",String(name),String(name)+" web3","\""+websiteHost+"\"","\""+websiteHost+"\" web3"].filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,6);
  let best:any=null,bestScore=-1;
  let verifiedBest:any=null,verifiedBestScore=-1;
  const ownerCache=new Map<string,boolean>();
  async function ownerControlsWebsite(owner:string){
    const key=owner.toLowerCase();
    if(ownerCache.has(key))return ownerCache.get(key)!;
    let ok=false;
    // Strong generic organization-name/domain binding: an official org whose login
    // contains the registrable project token (e.g. lista-dao for lista.org) is a
    // candidate, but only after confirming the account is actually an organization.
    let domainToken="";
    try{domainToken=websiteHost.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g,"")}catch{}
    const ownerToken=key.replace(/[^a-z0-9]/g,"");
    const tokenMatch=!!domainToken && (ownerToken===domainToken || ownerToken.startsWith(domainToken) || ownerToken.endsWith(domainToken));
    const orgCheck=await get("https://api.github.com/orgs/"+encodeURIComponent(owner),{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
    if(orgCheck.ok && tokenMatch) ok=true;
    // Identity corroboration is organization-only. A personal GitHub account must never
    // become a verified project identity merely because its profile mentions the domain.
    const org=await get("https://api.github.com/orgs/"+encodeURIComponent(owner),{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
    if(org.ok && websiteHost)try{
      const x=JSON.parse(org.text);
      const links=[x.blog,x.html_url].filter(Boolean).map((v:string)=>String(v).toLowerCase());
      ok=links.some((v:string)=>v.includes(websiteHost));
    }catch{}
    if(!ok && org.ok && websiteHost){
      const page=await get("https://github.com/"+encodeURIComponent(owner),{"User-Agent":"Web3Market External Passport"});
      if(page.ok){
        const body=page.text.toLowerCase();
        ok=body.includes(websiteHost)||body.includes("https://"+websiteHost)||body.includes("http://"+websiteHost);
      }
    }
    ownerCache.set(key,ok);
    return ok;
  }
  for(const searchQuery of queries){
    const gh=await get("https://api.github.com/search/repositories?q="+encodeURIComponent(searchQuery)+"&per_page=10",{
      Accept:"application/vnd.github+json","User-Agent":"Web3Market"
    });
    if(gh.ok)try{
      const j=JSON.parse(gh.text);
      for(const item of (j.items||[])){
        const s=Math.max(repoScore(item,identityQuery),repoScore(item,String(q)));
        if(s>bestScore){best=item;bestScore=s}
        const owner=String(item?.owner?.login||"");
        if(owner && await ownerControlsWebsite(owner) && s>verifiedBestScore){
          verifiedBest=item;
          verifiedBestScore=s;
        }
      }
    }catch{}
  }
  // Search GitHub organizations directly by the domain/project token before falling
  // back to repository search. This is important for projects whose repositories use
  // technical names rather than the public project name.
  if(!verifiedBest){
    try{
      const orgQueries=[identityQuery,String(name),identityQuery+" web3"].filter((v,i,a)=>v&&a.indexOf(v)===i);
      for(const oq of orgQueries){
        const ug=await get("https://api.github.com/search/users?q="+encodeURIComponent(oq+" type:org")+"&per_page=20",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
        if(!ug.ok)continue;
        const uj=await ug.json();
        for(const u of (uj.items||[])){
          const owner=String(u?.login||""); if(!owner)continue;
          if(await ownerControlsWebsite(owner)){
            const rr=await get("https://api.github.com/orgs/"+encodeURIComponent(owner)+"/repos?per_page=100&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
            if(rr.ok){
              const rs=await rr.json();
              const candidate=(Array.isArray(rs)?rs:[]).sort((a:any,b:any)=>repoScore(b,identityQuery)-repoScore(a,identityQuery))[0];
              if(candidate){verifiedBest=candidate;verifiedBestScore=Math.max(verifiedBestScore,repoScore(candidate,identityQuery));}
            }
            if(verifiedBest)break;
          }
        }
        if(verifiedBest)break;
      }
    }catch{}
  }
  // Generic organization search by the exact official domain. This catches official GitHub
  // organizations even when their repository names do not match the website name.
  if(!verifiedBest && websiteHost){
    try{
      const ug=await get("https://api.github.com/search/users?q="+encodeURIComponent('"'+websiteHost+'"')+"+type:org&per_page=10",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
      if(ug.ok){
        const uj=await ug.json();
        for(const u of (uj.items||[])){
          const owner=String(u?.login||""); if(!owner)continue;
          if(await ownerControlsWebsite(owner)){
            const rr=await get("https://api.github.com/orgs/"+encodeURIComponent(owner)+"/repos?per_page=100&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
            if(rr.ok){const rs=await rr.json();const candidate=(Array.isArray(rs)?rs:[]).sort((a:any,b:any)=>repoScore(b,identityQuery)-repoScore(a,identityQuery))[0];if(candidate){verifiedBest=candidate;verifiedBestScore=Math.max(verifiedBestScore,repoScore(candidate,identityQuery));}}
            break;
          }
        }
      }
    }catch{}
  }
  const chosen=verifiedBest||((best&&bestScore>=45)?best:null);
  if(chosen){
    repo=chosen;
    github=chosen.html_url;
    description=description||chosen.description||null;
    technology=technology||chosen.language||null;
    sources.push(src(verifiedBest?"Verified GitHub organization linked to official domain":"GitHub identity candidate",github,"github"));
  }
  if(!repo && websiteHost){
    // Generic GitHub organization discovery. Never hardcode project owners.
    const orgQueries=[
      "site:github.com \"" + websiteHost + "\"",
      "site:github.com " + identityQuery,
      identityQuery + " github"
    ];
    const candidates:string[]=[];
    for(const sq of orgQueries){
      const w=await get("https://html.duckduckgo.com/html/?q="+encodeURIComponent(sq));
      if(w.ok)candidates.push(...ddgLinks(w.text).filter(u=>/^https?:\/\/github\.com\/[^/]+(?:\/[^/#?]+)?/i.test(u)));
    }
    for(const u of [...new Set(candidates)].slice(0,20)){
      const m=u.match(/github\.com\/([^/]+)(?:\/([^/#?]+))?/i);
      if(!m)continue;
      const owner=m[1], verified=await ownerControlsWebsite(owner);
      if(!verified)continue;
      github="https://github.com/"+owner;
      sources.push(src("Verified GitHub organization linked to official domain",github,"github"));
      if(m[2]){
        const rr=await get("https://api.github.com/repos/"+owner+"/"+m[2],{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
        if(rr.ok)try{
          repo=JSON.parse(rr.text);
          description=description||repo.description||null;
          technology=technology||repo.language||null;
        }catch{}
      }else{
        const rr=await get("https://api.github.com/orgs/"+owner+"/repos?per_page=30&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
        if(rr.ok)try{
          const rs=JSON.parse(rr.text)||[];
          const rb=rs.sort((a:any,b:any)=>repoScore(b,identityQuery)-repoScore(a,identityQuery))[0];
          const docsRepo=rs.find((x:any)=>String(x.name||"").toLowerCase()==="docs");
          const selected=rb||docsRepo;
          if(selected){
            repo=selected;
            description=description||selected.description||null;
            technology=technology||selected.language||null;
            sources.push(src("GitHub repository identity",selected.html_url,"github"));
          }
          if(docsRepo)sources.push(src("Official documentation repository",docsRepo.html_url,"docs"));
        }catch{}
      }
      break;
    }
  }
  if(!repo && websiteHost){
    const w=await get("https://html.duckduckgo.com/html/?q="+encodeURIComponent('site:github.com "'+websiteHost+'"'));
    if(w.ok){
      const candidates=ddgLinks(w.text).filter(u=>/^https?:\/\/github\.com\/[^/]+(?:\/[^/#?]+)?/i.test(u)).slice(0,12);
      for(const u of candidates){
        const m=u.match(/github\.com\/([^/]+)(?:\/([^/#?]+))?/i);
        if(!m)continue;
        if(await ownerControlsWebsite(m[1])){
          github=u;
          sources.push(src("Verified GitHub organization linked to official domain",github,"github"));
          if(m[2]){
            const rr=await get("https://api.github.com/repos/"+m[1]+"/"+m[2],{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
            if(rr.ok)try{repo=JSON.parse(rr.text);description=description||repo.description||null;technology=technology||repo.language||null}catch{}
          }else{
            const rr=await get("https://api.github.com/orgs/"+m[1]+"/repos?per_page=10&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
            if(rr.ok)try{
              const rs=JSON.parse(rr.text)||[];
              const rb=rs.sort((a:any,b:any)=>repoScore(b,identityQuery)-repoScore(a,identityQuery))[0];
              if(rb){repo=rb;description=description||rb.description||null;technology=technology||rb.language||null}
            }catch{}
          }
          break;
        }
      }
    }
  }
}
if(verifiedGithubName && website && github){try{const wh=new URL(website).hostname.replace(/^www\./i,"").toLowerCase();if(wh)name=verifiedGithubName;}catch{}}
  // Discover official documentation repositories for a domain-linked GitHub organization.
  // This is generic: no project-specific owner is hardcoded.
  if(website && github && !sources.some((x:any)=>x.type==="docs")){
    try{
      const gm=github.match(/github\.com\/([^/]+)/i);
      const wh=new URL(website).hostname.replace(/^www\\./i,"").toLowerCase();
      if(gm && wh){
        const owner=gm[1];
        const rr=await get("https://api.github.com/orgs/"+encodeURIComponent(owner)+"/repos?per_page=100&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
        if(rr.ok){
          const rs=await rr.json();
          for(const rj of Array.isArray(rs)?rs.slice(0,100):[]){
            const rn=String(rj?.name||"").toLowerCase();
            const rd=String(rj?.description||"").toLowerCase();
            const isDocs=/(^|[-_])(docs?|documentation|gitbook)([-_]|$)/i.test(rn)||/documentation|gitbook|docs/i.test(rd);
            if(!isDocs)continue;
            const readme=await get("https://raw.githubusercontent.com/"+rj.full_name+"/"+(rj.default_branch||"main")+"/README.md",{"User-Agent":"Web3Market"});
            if(readme.ok){
              const body=readme.text;
              for(const u of filteredEvidenceUrls(body)){
                try{
                  const uh=new URL(u).hostname.replace(/^www\\./i,"").toLowerCase();
                  if(uh===wh||uh.endsWith("."+wh))sources.push(src("Official documentation repository",u,"docs"));
                }catch{}
              }
            }
            sources.push(src("Official documentation repository",String(rj.html_url),"docs"));
            if(sources.some((x:any)=>x.type==="docs"))break;
          }
        }
      }
    }catch{}
  }
if(repo){
  const l=await get("https://api.github.com/repos/"+repo.full_name+"/languages",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
  if(l.ok)try{const x=JSON.parse(l.text);technology=Object.keys(x).slice(0,8).join(", ")||technology}catch{}
  const rd=await get("https://raw.githubusercontent.com/"+repo.full_name+"/"+(repo.default_branch||"main")+"/README.md",{"User-Agent":"Web3Market"});
  if(rd.ok){const aa=addresses(rd.text);for(const u of filteredEvidenceUrls(rd.text))sources.push(src("README public link",u,"readme"));if(aa.length){collectedContractAddresses.push(...aa);sources.push(src("Contract addresses in README",github,"contract"))}}
}
  // Generic verified-organization evidence scan.
  if(website && github){
    try{
      const wh=new URL(website).hostname.replace(/^www\\./i,"").toLowerCase();
      const gm=github.match(/github\.com\/([^/]+)/i);
      if(gm){
        const owner=gm[1];
        const rr=await get("https://api.github.com/orgs/"+encodeURIComponent(owner)+"/repos?per_page=100&sort=updated",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
        if(rr.ok){
          const rs=await rr.json();
          const relevant=(Array.isArray(rs)?rs:[]).filter((rj:any)=>/(contract|contracts|token|protocol|defi|dex|staking|lending|dao|gitbook|docs|core|v[0-9])/i.test(String(rj?.name||"")+" "+String(rj?.description||""))).slice(0,12);
          let linked=false;
          for(const rj of relevant){
            const home=String(rj?.homepage||"").trim();
            if(home){try{const hh=new URL(home).hostname.replace(/^www\\./i,"").toLowerCase();if(hh===wh||hh.endsWith("."+wh))linked=true}catch{}}
            const raw="https://raw.githubusercontent.com/"+rj.full_name+"/"+String(rj?.default_branch||"main")+"/README.md";
            const rd=await get(raw,{"User-Agent":"Web3Market"});
            if(rd.ok){
              const body=rd.text;
              if(body.toLowerCase().includes(wh))linked=true;
              const aa=addresses(body); if(aa.length)collectedContractAddresses.push(...aa);
              if(/gitbook|docs|documentation/i.test(String(rj.name||"")+" "+String(rj.description||""))){sources.push(src("Official documentation repository",String(rj.html_url||github),"docs"));if(/defi|dex|dao|staking|lending|stablecoin|smart contract|blockchain|web3|token|onchain/i.test(body))sources.push(src("Official Web3 documentation evidence",String(rj.html_url||github),"web3_identity"));}
              for(const u of filteredEvidenceUrls(body)){try{const uh=new URL(u).hostname.replace(/^www\\./i,"").toLowerCase();if(uh===wh||uh.endsWith("."+wh))linked=true}catch{}}
            }
            if(rj.html_url && /(contract|contracts|token|protocol|defi|dex|staking|lending|dao)/i.test(String(rj.name||"")+" "+String(rj.description||"")))sources.push(src("Official primary project repository",String(rj.html_url),"github"));
          }
          if(linked)sources.push(src("Verified GitHub organization linked to official domain","https://github.com/"+owner,"github"));
        }
      }
    }catch{}
  }
const identityContext=[name,description,technology,repo?.description,Array.isArray(repo?.topics)?repo.topics.join(" "):""].filter(Boolean).join(" ");
  // Contracts must come from collected primary/public evidence, never from project-name metadata.
  const contractEvidence=[...new Set(collectedContractAddresses)];
  const chains=kp?.chains||chain(identityContext+" "+site),contracts=contractEvidence,risk:string[]=[];
  if(!website)risk.push("Official website not verified");if(!github)risk.push("GitHub repository not verified");if(!sources.some(x=>x.type==="docs"))risk.push("Public documentation link not verified");if(chains.length&&!contracts.length)risk.push("Public contract address not found in collected sources");if(repo?.pushed_at&&Date.now()-new Date(repo.pushed_at).getTime()>31536000000)risk.push("GitHub activity older than 12 months");if(sources.length<3)risk.push("Limited independent public evidence");
  let dex:any=null;if(contracts.length){const verifiedContracts=new Set(contracts.map((x:string)=>x.toLowerCase()));const dx=await get("https://api.dexscreener.com/latest/dex/search/?q="+encodeURIComponent(name));if(dx.ok)try{const x=JSON.parse(dx.text);const matched=(x.pairs||[]).filter((p:any)=>verifiedContracts.has(String(p.baseToken?.address||"").toLowerCase())||verifiedContracts.has(String(p.quoteToken?.address||"").toLowerCase()));if(matched.length){dex=matched.slice(0,8).map((p:any)=>({chain:p.chainId,dex:p.dexId,pair:p.pairAddress,base:p.baseToken?.symbol,baseAddress:p.baseToken?.address,quote:p.quoteToken?.symbol,quoteAddress:p.quoteToken?.address,priceUsd:p.priceUsd,liquidityUsd:p.liquidity?.usd,volume24h:p.volume?.h24,url:p.url}));sources.push(src("DEX Screener market data (contract-matched)","https://dexscreener.com/search?q="+encodeURIComponent(name),"market_data"))}}catch{}} 
  let llama:any=null;const dl=await get("https://api.llama.fi/protocols");if(dl.ok)try{const a=JSON.parse(dl.text),n=name.toLowerCase().replace(/[^a-z0-9]/g,"");const h=a.filter((p:any)=>{const z=String(p.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");const slug=String(p.slug||"").toLowerCase().replace(/[^a-z0-9]/g,"");return z===n||slug===n}).sort((a:any,b:any)=>Number(b.tvl||0)-Number(a.tvl||0)).slice(0,5);if(h.length){llama=h.map((p:any)=>({name:p.name,slug:p.slug,tvl:p.tvl,chains:p.chains,category:p.category,website:p.url,listedAt:p.listedAt,defillama_id:p.id,revenue:p.revenue,fees24h:p.fees24h}));sources.push(src("DeFiLlama protocol data","https://defillama.com/","defi_data"))}}catch{}
  let npm:any=null;const nr=await get("https://registry.npmjs.org/-/v1/search?text="+encodeURIComponent(name)+"&size=5");if(nr.ok)try{const x=JSON.parse(nr.text);const cleanPkg=(o:any)=>({name:o.package?.name,version:o.package?.version,description:o.package?.description,homepage:o.package?.links?.homepage,repository:o.package?.links?.repository,weeklyDownloads:o.downloads?.weekly});const sameHost=(u:string|null,d:string|null)=>{try{return !!u&&!!d&&new URL(u).hostname.replace(/^www\./,"")===new URL(d).hostname.replace(/^www\./,"")}catch{return false}};const sameRepo=(u:string|null,g:string|null)=>{if(!u||!g)return false;return u.replace(/\.git$/,"").replace(/\/$/,"").toLowerCase()===g.replace(/\/$/,"").toLowerCase()};npm=(x.objects||[]).map(cleanPkg).filter((o:any)=>{const exact=String(o.name||"").toLowerCase().replace(/[^a-z0-9]/g,"")===name.toLowerCase().replace(/[^a-z0-9]/g,"");const linked=sameRepo(o.repository,github)||sameHost(o.homepage,website)||sameHost(o.repository,website);return linked||((kp||repo)&&exact&&!!(o.repository||o.homepage));}).slice(0,5);if(npm.length)sources.push(src("npm package identity-linked evidence","https://www.npmjs.com/search?q="+encodeURIComponent(name),"npm"))}catch{}
  const verifiedGithub = sources.some((x:any)=>x.type==="github" && /Verified GitHub organization linked to official domain/i.test(String(x.title||"")));
  const directProjectText=[name,description,technology,repo?.description,Array.isArray(repo?.topics)?repo.topics.join(" "):""].filter(Boolean).join(" ").toLowerCase();
  const explicitWeb3Identity = sources.some((x:any)=>x.type==="web3_identity" && /verified|official|contract|protocol|web3/i.test(String(x.title||"")));
  // Strong Web3 identity must be backed by an actual project-specific primary source,
  // not by generic words in a name/description. A verified GitHub org alone is identity
  // corroboration, not proof that the project itself is Web3.
  const primaryWeb3Text=[site,description,repo?.description,repo?.topics?.join(" ")||""].join(" ").toLowerCase();
  const web3Term=/(defi|dex|dao|stablecoin|liquid staking|staking|lending|smart contract|blockchain|onchain|token|amm|liquidity pool|web3)/i.test(primaryWeb3Text);
  const protocolTerm=/(protocol|smart contract|blockchain|defi|dex|dao|stablecoin|token|amm|liquidity|onchain)/i.test(primaryWeb3Text);
  const directPrimaryWeb3=web3Term&&protocolTerm;
  const web3Evidence = !!(contracts.length||dex||llama||explicitWeb3Identity||directPrimaryWeb3);
  if(web3Evidence && !sources.some((x:any)=>x.type==="web3_identity"))
    sources.push(src("Official Web3 protocol identity evidence",github||website||"https://web3market.xyz","web3_identity"));
  const hasDocs = sources.some((x:any)=>x.type==="docs");
  const domainCorroboration = !!website && verifiedGithub && hasDocs;
  const findings:any[]=[];
  if(repo)findings.push({severity:"info",title:"GitHub evidence",detail:"Public repository metadata, languages, stars, forks and recent activity were collected.",source_urls:[github]});
  if(dex)findings.push({severity:"info",title:"DEX market data",detail:"Public trading-pair, price, liquidity and 24h volume data was found.",source_urls:["https://dexscreener.com/"]});
  if(llama)findings.push({severity:"info",title:"DeFi protocol data",detail:"A matching public DeFiLlama protocol record was found.",source_urls:["https://defillama.com/"]});
  if(npm?.length)findings.push({severity:"info",title:"Developer ecosystem",detail:"Public npm package records were found for this project name.",source_urls:["https://www.npmjs.com/"]});
  if(risk.length)findings.push({severity:"warning",title:"Evidence gaps",detail:risk.join("; ")+". No missing financial/user metrics are estimated.",source_urls:unique(sources).map(x=>x.url).slice(0,10)});
  const evidenceParts={identity:(website?15:0)+(github?10:0)+(kp?10:0),code:(repo?15:0)+(technology?5:0)+(verifiedGithub?10:0),documentation:(hasDocs?8:0),web3_identity:(sources.some(x=>x.type==="web3_identity")?6:0),domain_corroboration:(domainCorroboration?5:0),contract:(contracts.length?12:0),market:(dex?10:0),defi:(llama?8:0),package:(npm?.length?4:0),breadth:(sources.length>=6?3:sources.length>=3?1:0),web3_primary:(directPrimaryWeb3?6:0),audit:(sources.some((x:any)=>/audit/i.test(String(x.title||""))) ? 3:0),official_org_repos:(sources.filter((x:any)=>x.type==="github"&&/organization repository|official documentation repository|verified github organization/i.test(String(x.title||""))).length>=2?5:0)};const evidence=Math.min(100,Object.values(evidenceParts).reduce((a,b)=>a+b,0));const identityStrength=(website?1:0)+(github?1:0)+(kp?1:0)+(contracts.length?1:0);const independentSignals=[repo,dex,llama,npm?.length?npm:null].filter(Boolean).length;const confidence=Math.min(95,Math.max(15,Math.round(evidence*0.7+identityStrength*5+independentSignals*3-risk.length*2)));
  const llamaLaunch=llama?.find((x:any)=>x.listedAt)?.listedAt;const launchDate=repo?.created_at||(llamaLaunch?new Date(Number(llamaLaunch)*1000).toISOString():null);const llamaRev=llama?.find((x:any)=>x.revenue!=null||x.fees24h!=null);const revenueValue=llamaRev?.revenue??null;const activeUsersValue=null,monthlyVisitsValue=null;const missingCore=[!website,!github,!technology,!launchDate,!activeUsersValue,!monthlyVisitsValue,!revenueValue,!contracts.length].filter(Boolean).length;const riskScore=Math.max(0,Math.min(100,20+risk.length*10+missingCore*4-(sources.length>=8?10:0)-(dex?5:0)-(llama?5:0)-(repo?5:0)));const riskLevel=riskScore>=70?"high":riskScore>=40?"medium":"low";
  const identityScore=Math.min(100,Math.max(0,Math.round((website?20:0)+(github?15:0)+(verifiedGithub?25:0)+(hasDocs?10:0)+(domainCorroboration?15:0)+(contracts.length?10:0)+(sources.length>=6?5:0))));
  const identityVerdict=identityScore>=60?"verified":identityScore>=45?"probable":"candidate";
  const entityType=category(identityContext)?.toLowerCase().includes("dao")?"dao":category(identityContext)?.toLowerCase().includes("defi")?"protocol":"independent_project";
  const passport={project_name:name,website,category:kp?.category||category(identityContext),description,founded_or_launched:launchDate,technology,blockchains:chains,github,active_users:activeUsersValue,monthly_visits:monthlyVisitsValue,revenue:revenueValue,token_or_contracts:contracts.length?contracts:null,public_activity:repo?{stars:repo.stargazers_count,forks:repo.forks_count,open_issues:repo.open_issues_count,watchers:repo.watchers_count,created_at:repo.created_at,last_push:repo.pushed_at,license:repo.license?.spdx_id||null}:null,market_data:dex,defi_data:llama,npm_data:npm,ai_summary:"Free multi-source public research. DeFiLlama is included only on an exact normalized project-name/slug match; DEX Screener is included only when a pair token address matches a collected contract address; npm packages are included only when repository/homepage identity links to the verified project.  Missing user, traffic and revenue figures remain unreported unless a public source verifies them. Launch dates use public GitHub or DeFiLlama timestamps when available. Risk is an evidence-completeness indicator, not a financial or security audit.",ai_risk_level:riskLevel,ai_risk_score:riskScore,evidence_score:evidence,confidence_score:identityScore,identity_score:identityScore,identity_verdict:identityVerdict,entity_type:entityType,risk_indicators:risk,key_findings:findings,sources:unique(sources).slice(0,30),evidence_breakdown:evidenceParts,evidence_debug:{website:!!website,github:!!github,repo:!!repo,technology:!!technology,verifiedGithub,hasDocs,web3Identity:sources.some((x:any)=>x.type==="web3_identity"),contracts:contracts.length,dex:!!dex,llama:!!llama,npm:!!npm?.length,source_count:unique(sources).length},source_status:sources.length>=3?"multi_source":"limited_public_evidence",external_only:true,web3market_listing_status:"not_listed"};
  passport.passport_eligibility=passportEligibility(passport);return J({success:true,passport},200,req);
 }catch(e){return J({error:e instanceof Error?e.message:"Unexpected error"},500,req)}
});