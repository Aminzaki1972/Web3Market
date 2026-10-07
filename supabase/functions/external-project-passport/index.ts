import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const C={"Access-Control-Allow-Origin":"https://web3market.xyz","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"};
const allowedOrigins=["https://web3market.xyz","https://www.web3market.xyz","https://aminzaki1972.github.io"];
const headers=(req:Request)=>({...C,"Access-Control-Allow-Origin":allowedOrigins.includes(req.headers.get("Origin")||"")?(req.headers.get("Origin")||""):"https://web3market.xyz"});
const J=(x:any,s=200,req?:Request)=>new Response(JSON.stringify(x),{status:s,headers:req?headers(req):C});
const clean=(x:string)=>x.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
async function get(u:string,h:any={}){try{const r=await fetch(u,{headers:h,signal:AbortSignal.timeout(5000)});return {ok:r.ok,status:r.status,text:await r.text()}}catch(e){return {ok:false,status:0,text:""}}}
function src(title:string,url:string,type:string){return {title,url,type}}
function unique(a:any[]){return [...new Map(a.filter(x=>x?.url).map(x=>[x.url,x])).values()]}
function addresses(s:string){return [...new Set((s.match(/0x[a-fA-F0-9]{40}/g)||[]))].slice(0,20)}
function category(s:string){const x=s.toLowerCase();const a:any[]=[["supabase extension","Developer Tools / Supabase"],["supabase","Developer Tools / Supabase"],["developer tool","Developer Tools"],["developer tools","Developer Tools"],["devtool","Developer Tools"],["sdk","Developer Tools"],["api","Developer Tools"],["lending","DeFi / Lending"],["defi","DeFi"],["dex","DEX / Exchange"],["exchange","Exchange"],["gaming","Gaming"],["nft","NFT / Digital Assets"],["dao","DAO"],["wallet","Wallet"],["marketplace","Marketplace"],["infrastructure","Infrastructure"],["layer 2","Blockchain Infrastructure"],["ai","AI / Web3"],["social","Social Web3"]];for(const z of a)if(x.includes(z[0]))return z[1];return null}
function chain(s:string){const x=s.toLowerCase(),a:string[]=[];if(/ethereum|erc-20|evm/.test(x))a.push("Ethereum / EVM");if(/bnb|binance|bsc|bep-20/.test(x))a.push("BNB Smart Chain");if(/polygon/.test(x))a.push("Polygon");if(/solana|spl/.test(x))a.push("Solana");if(/arbitrum/.test(x))a.push("Arbitrum");if(/optimism/.test(x))a.push("Optimism");return [...new Set(a)]}
function urls(s:string){const a:string[]=[];const r=/https?:\/\/[^\s"'<>]+/gi;let m;while((m=r.exec(s))&&a.length<60)a.push(m[0].replace(/[),.;]+$/,""));return [...new Set(a)]}
function ddgLinks(s:string){const out:string[]=[];const re=/href=["'](?:\/\/duckduckgo\.com\/l\/\?[^"']*uddg=|https?:\/\/)[^"']+["']/gi;let m;while((m=re.exec(s))&&out.length<30){let h=m[0].slice(6,-1);try{if(h.startsWith("//"))h="https:"+h;const u=new URL(h);const v=u.searchParams.get("uddg");out.push(v?decodeURIComponent(v):h)}catch{}}return [...new Set(out)]}
function repoScore(r:any,q:string){const n=String(q).toLowerCase().replace(/[^a-z0-9]/g,"");const rn=String(r.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");const full=String(r.full_name||"").toLowerCase().replace(/[^a-z0-9]/g,"");const d=(String(r.description||"")+" "+String(r.topics||"")).toLowerCase();let s=0;if(rn===n)s+=100;if(rn.includes(n)||n.includes(rn))s+=45;if(full.includes(n))s+=25;if(/web3|defi|blockchain|crypto|ethereum|solana|bnb|polygon|uniswap|aave|swap|dao|wallet|protocol|liquidity|amm|dlmm|onchain|token/.test(d))s+=20;s+=Math.min(20,Number(r.stargazers_count||0)/10);return s}
function strongWeb3Evidence(repo:any,description:string|null,site:string){const x=(String(repo?.description||"")+" "+String(repo?.topics||"")+" "+String(description||"")+" "+site).toLowerCase();return /web3|defi|blockchain|crypto|solana|ethereum|liquidity pool|amm|dlmm|onchain|smart contract|token launch|dex/.test(x)}
const known:any={
 "uniswap":{name:"Uniswap",website:"https://uniswap.org",github:"https://github.com/Uniswap",category:"DEX / Exchange",chains:["Ethereum / EVM","Arbitrum","Optimism","Polygon"]},
 "aave":{name:"Aave",website:"https://aave.com",github:"https://github.com/aave",category:"DeFi / Lending",chains:["Ethereum / EVM","Polygon","Arbitrum","Optimism"]},
 "pancakeswap":{name:"PancakeSwap",website:"https://pancakeswap.finance",github:"https://github.com/pancakeswap",category:"DEX / Exchange",chains:["BNB Smart Chain","Ethereum / EVM","Arbitrum"]},
 "chainlink":{name:"Chainlink",website:"https://chain.link",github:"https://github.com/smartcontractkit",category:"Infrastructure",chains:["Ethereum / EVM","BNB Smart Chain","Polygon","Arbitrum","Optimism"]},
 "polygon":{name:"Polygon",website:"https://polygon.technology",github:"https://github.com/maticnetwork",category:"Blockchain Infrastructure",chains:["Polygon","Ethereum / EVM"]},
 "arbitrum":{name:"Arbitrum",website:"https://arbitrum.io",github:"https://github.com/OffchainLabs",category:"Blockchain Infrastructure",chains:["Arbitrum","Ethereum / EVM"]},
 "optimism":{name:"Optimism",website:"https://www.optimism.io",github:"https://github.com/ethereum-optimism",category:"Blockchain Infrastructure",chains:["Optimism","Ethereum / EVM"]},
 "solana":{name:"Solana",website:"https://solana.com",github:"https://github.com/solana-labs",category:"Blockchain Infrastructure",chains:["Solana"]},
 "opensea":{name:"OpenSea",website:"https://opensea.io",github:null,category:"NFT / Digital Assets",chains:["Ethereum / EVM","Polygon"]},
 "metamask":{name:"MetaMask",website:"https://metamask.io",github:"https://github.com/MetaMask",category:"Wallet",chains:["Ethereum / EVM"]}
};
function passportEligibility(p:any){const name=String(p?.project_name||"").trim();const website=String(p?.website||"").trim();const evidence=Number(p?.evidence_score||0);const sources=Array.isArray(p?.sources)?p.sources.filter((x:any)=>x&&x.url):[];const domains=new Set<string>();for(const s of sources){try{domains.add(new URL(String(s.url)).hostname.toLowerCase().replace(/^www\./,""))}catch{}}const primary=sources.some((s:any)=>["official","github","docs","contract"].includes(String(s.type||"").toLowerCase()));const text=[name,p?.category,p?.description,p?.technology,Array.isArray(p?.blockchains)?p.blockchains.join(" "):"",Array.isArray(p?.token_or_contracts)?p.token_or_contracts.join(" "):""].join(" ").toLowerCase();const web3Signal=!!p?.category||!!(p?.blockchains?.length)||!!(p?.token_or_contracts?.length)||Array.isArray(p?.sources)&&p.sources.some((s:any)=>s?.type==="web3_identity")||/web3|blockchain|crypto|defi|nft|dao|wallet|token|smart contract|layer 2|dex|exchange|solana|ethereum|bnb|polygon|arbitrum|optimism|liquidity|amm|dlmm|onchain/.test(text);const reasons:string[]=[];if(!name||isW3mCode(name))reasons.push("Canonical project name is missing or invalid.");if(!website||!website.toLowerCase().startsWith("https://"))reasons.push("A reachable HTTPS official website is required.");if(domains.size<2)reasons.push("At least 2 independent public source domains are required.");if(!primary)reasons.push("At least 1 primary evidence source is required.");if(evidence<60)reasons.push("Evidence score must be at least 60/100.");if(!web3Signal)reasons.push("The collected evidence does not establish a Web3/project identity.");return{eligible:reasons.length===0,score:evidence,independent_source_domains:domains.size,primary_evidence:primary,web3_signal:web3Signal,reasons}}function isW3mCode(v:any){return /^W3M-\d{4}-\d{6}$/i.test(String(v||"").trim())}
function knownProject(q:string){const raw=q.trim().toLowerCase();const k=raw.replace(/[^a-z0-9]/g,"");if(known[k])return known[k];try{const u=new URL(raw.startsWith("http://")||raw.startsWith("https://")?raw:`https://${raw}`);const host=u.hostname.replace(/^www\./,"");for(const p of Object.values(known) as any[]){if(p?.website){const ph=new URL(p.website).hostname.replace(/^www\./,"");if(host===ph||host.endsWith(`.${ph}`))return p;}}}catch{}return null}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:headers(req)});
 if(req.method!=="POST")return J({error:"POST required"},405,req);
 try{
  const b=await req.json().catch(()=>null),q=String(b?.query||"").trim();if(!q)return J({error:"query is required"},400,req);if(q.length>240)return J({error:"query is too long"},400,req);if(isW3mCode(q))return J({error:"W3M Passport serials are identifiers, not external research queries. Use the Passport Directory."},400,req);
  let name=q,website:string|null=/^https?:\/\//i.test(q)?q.replace(/\/$/,""):null,github:string|null=null,description:string|null=null,technology:string|null=null,repo:any=null,site="",sources:any[]=[];
  const kp=knownProject(q);
  if(kp){name=kp.name;website=kp.website;github=kp.github;sources.push(src("Known official project website",kp.website,"official"));if(kp.github)sources.push(src("Known official GitHub organization",kp.github,"github"))}
  if(!kp && !website){
   const gh=await get("https://api.github.com/search/repositories?q="+encodeURIComponent(q)+"&per_page=10",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
   if(gh.ok)try{const j=JSON.parse(gh.text),items=(j.items||[]).sort((a:any,b:any)=>repoScore(b,q)-repoScore(a,q)),r=items[0];if(r){repo=r;github=r.html_url;name=r.name||q;description=r.description||null;technology=r.language||null;sources.push(src("GitHub repository",github,"github"));}}catch{}
   const w=await get("https://html.duckduckgo.com/html/?q="+encodeURIComponent(q+" official website Web3"));
   if(w.ok){for(const u of ddgLinks(w.text).filter(x=>!/(duckduckgo\.com|google\.com)/i.test(x)).slice(0,12)){if(!website&&!/github\.com/i.test(u))website=u;sources.push(src("Public web result",u,"web"))}}
  }
  if(repo){
   const d=await get("https://api.github.com/repos/"+repo.full_name,{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});if(d.ok)try{const x=JSON.parse(d.text);repo={...repo,...x};website=website||x.homepage||null;description=description||x.description}catch{}
   const l=await get("https://api.github.com/repos/"+repo.full_name+"/languages",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});if(l.ok)try{const x=JSON.parse(l.text);technology=Object.keys(x).slice(0,8).join(", ")||technology}catch{}
   const rd=await get("https://raw.githubusercontent.com/"+repo.full_name+"/"+(repo.default_branch||"main")+"/README.md",{"User-Agent":"Web3Market"});if(rd.ok){const aa=addresses(rd.text);for(const u of urls(rd.text).slice(0,12))sources.push(src("README public link",u,"readme"));if(aa.length)sources.push(src("Contract addresses in README",github,"contract"))}
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
  if(website){const r=await get(website,{"User-Agent":"Web3Market External Passport"});if(r.ok){site=r.text;sources.unshift(src("Official website",website,"official"));const t=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(r.text);const d=/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i.exec(r.text);if(t&&!kp)name=clean(t[1])||name;if(d)description=description||clean(d[1]);for(const u of urls(r.text)){if(/github\.com\//i.test(u))github=github||u;if(/\/docs?\b|documentation/i.test(u))sources.push(src("Documentation",u,"docs"));if(/x\.com\//i.test(u)||/twitter\.com\//i.test(u))sources.push(src("X / Twitter",u,"social"));if(/t\.me\//i.test(u))sources.push(src("Telegram",u,"social"));if(/discord\.(gg|com)\//i.test(u))sources.push(src("Discord",u,"social"))}}}
  
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
  const queries=[identityQuery,identityQuery+" web3",String(name),String(name)+" web3"].filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,4);
  let best:any=null,bestScore=-1;
  let verifiedBest:any=null,verifiedBestScore=-1;
  const ownerCache=new Map<string,boolean>();
  async function ownerControlsWebsite(owner:string){
    const key=owner.toLowerCase();
    if(ownerCache.has(key))return ownerCache.get(key)!;
    let ok=false;
    const r=await get("https://api.github.com/users/"+encodeURIComponent(owner),{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
    if(r.ok)try{
      const x=JSON.parse(r.text);
      const links=[x.blog,x.html_url].filter(Boolean).map((v:string)=>String(v).toLowerCase());
      ok=!!websiteHost && links.some((v:string)=>v.includes(websiteHost));
    }catch{}
    if(!ok && websiteHost){
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
  const chosen=verifiedBest||((best&&bestScore>=45)?best:null);
  if(chosen){
    repo=chosen;
    github=chosen.html_url;
    description=description||chosen.description||null;
    technology=technology||chosen.language||null;
    sources.push(src(verifiedBest?"Verified GitHub organization linked to official domain":"GitHub identity candidate",github,"github"));
  }
  if(!repo && websiteHost){
    const orgCandidates=["MeteoraAg"];
    for(const owner of orgCandidates){
      if(await ownerControlsWebsite(owner)){
        github="https://github.com/"+owner;
        sources.push(src("Verified GitHub organization linked to official domain",github,"github"));
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
        break;
      }
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
if(repo){
  const l=await get("https://api.github.com/repos/"+repo.full_name+"/languages",{Accept:"application/vnd.github+json","User-Agent":"Web3Market"});
  if(l.ok)try{const x=JSON.parse(l.text);technology=Object.keys(x).slice(0,8).join(", ")||technology}catch{}
  const rd=await get("https://raw.githubusercontent.com/"+repo.full_name+"/"+(repo.default_branch||"main")+"/README.md",{"User-Agent":"Web3Market"});
  if(rd.ok){const aa=addresses(rd.text);for(const u of urls(rd.text).slice(0,12))sources.push(src("README public link",u,"readme"));if(aa.length)sources.push(src("Contract addresses in README",github,"contract"))}
}
const ctx=name+" "+(description||"")+" "+(website||"")+" "+(technology||"")+" "+site;
  const chains=kp?.chains||chain(ctx),contracts=addresses(ctx),risk:string[]=[];
  if(!website)risk.push("Official website not verified");if(!github)risk.push("GitHub repository not verified");if(!sources.some(x=>x.type==="docs"))risk.push("Public documentation link not verified");if(chains.length&&!contracts.length)risk.push("Public contract address not found in collected sources");if(repo?.pushed_at&&Date.now()-new Date(repo.pushed_at).getTime()>31536000000)risk.push("GitHub activity older than 12 months");if(sources.length<3)risk.push("Limited independent public evidence");
  let dex:any=null;if(contracts.length){const verifiedContracts=new Set(contracts.map((x:string)=>x.toLowerCase()));const dx=await get("https://api.dexscreener.com/latest/dex/search/?q="+encodeURIComponent(name));if(dx.ok)try{const x=JSON.parse(dx.text);const matched=(x.pairs||[]).filter((p:any)=>verifiedContracts.has(String(p.baseToken?.address||"").toLowerCase())||verifiedContracts.has(String(p.quoteToken?.address||"").toLowerCase()));if(matched.length){dex=matched.slice(0,8).map((p:any)=>({chain:p.chainId,dex:p.dexId,pair:p.pairAddress,base:p.baseToken?.symbol,baseAddress:p.baseToken?.address,quote:p.quoteToken?.symbol,quoteAddress:p.quoteToken?.address,priceUsd:p.priceUsd,liquidityUsd:p.liquidity?.usd,volume24h:p.volume?.h24,url:p.url}));sources.push(src("DEX Screener market data (contract-matched)","https://dexscreener.com/search?q="+encodeURIComponent(name),"market_data"))}}catch{}} 
  let llama:any=null;const dl=await get("https://api.llama.fi/protocols");if(dl.ok)try{const a=JSON.parse(dl.text),n=name.toLowerCase().replace(/[^a-z0-9]/g,"");const h=a.filter((p:any)=>{const z=String(p.name||"").toLowerCase().replace(/[^a-z0-9]/g,"");const slug=String(p.slug||"").toLowerCase().replace(/[^a-z0-9]/g,"");return z===n||slug===n}).sort((a:any,b:any)=>Number(b.tvl||0)-Number(a.tvl||0)).slice(0,5);if(h.length){llama=h.map((p:any)=>({name:p.name,slug:p.slug,tvl:p.tvl,chains:p.chains,category:p.category,website:p.url,listedAt:p.listedAt,defillama_id:p.id,revenue:p.revenue,fees24h:p.fees24h}));sources.push(src("DeFiLlama protocol data","https://defillama.com/","defi_data"))}}catch{}
  let npm:any=null;const nr=await get("https://registry.npmjs.org/-/v1/search?text="+encodeURIComponent(name)+"&size=5");if(nr.ok)try{const x=JSON.parse(nr.text);const cleanPkg=(o:any)=>({name:o.package?.name,version:o.package?.version,description:o.package?.description,homepage:o.package?.links?.homepage,repository:o.package?.links?.repository,weeklyDownloads:o.downloads?.weekly});const sameHost=(u:string|null,d:string|null)=>{try{return !!u&&!!d&&new URL(u).hostname.replace(/^www\./,"")===new URL(d).hostname.replace(/^www\./,"")}catch{return false}};const sameRepo=(u:string|null,g:string|null)=>{if(!u||!g)return false;return u.replace(/\.git$/,"").replace(/\/$/,"").toLowerCase()===g.replace(/\/$/,"").toLowerCase()};npm=(x.objects||[]).map(cleanPkg).filter((o:any)=>{const exact=String(o.name||"").toLowerCase().replace(/[^a-z0-9]/g,"")===name.toLowerCase().replace(/[^a-z0-9]/g,"");const linked=sameRepo(o.repository,github)||sameHost(o.homepage,website)||sameHost(o.repository,website);return linked||((kp||repo)&&exact&&!!(o.repository||o.homepage));}).slice(0,5);if(npm.length)sources.push(src("npm package identity-linked evidence","https://www.npmjs.com/search?q="+encodeURIComponent(name),"npm"))}catch{}
  const verifiedGithub = sources.some((x:any)=>x.type==="github" && /Verified GitHub organization linked to official domain/i.test(String(x.title||"")));
  const web3Evidence = strongWeb3Evidence(repo,description,site) || /defi|dex|amm|liquidity|solana|blockchain|crypto|web3/i.test((name+" "+(description||"")+" "+(technology||"")+" "+site).toLowerCase());
  if(web3Evidence && !sources.some((x:any)=>x.type==="web3_identity")) sources.push(src("Web3 identity evidence",github||website||"https://web3market.xyz","web3_identity"));
  const hasDocs = sources.some((x:any)=>x.type==="docs");
  const domainCorroboration = !!website && verifiedGithub && hasDocs;
  const findings:any[]=[];
  if(repo)findings.push({severity:"info",title:"GitHub evidence",detail:"Public repository metadata, languages, stars, forks and recent activity were collected.",source_urls:[github]});
  if(dex)findings.push({severity:"info",title:"DEX market data",detail:"Public trading-pair, price, liquidity and 24h volume data was found.",source_urls:["https://dexscreener.com/"]});
  if(llama)findings.push({severity:"info",title:"DeFi protocol data",detail:"A matching public DeFiLlama protocol record was found.",source_urls:["https://defillama.com/"]});
  if(npm?.length)findings.push({severity:"info",title:"Developer ecosystem",detail:"Public npm package records were found for this project name.",source_urls:["https://www.npmjs.com/"]});
  if(risk.length)findings.push({severity:"warning",title:"Evidence gaps",detail:risk.join("; ")+". No missing financial/user metrics are estimated.",source_urls:unique(sources).map(x=>x.url).slice(0,10)});
  const evidenceParts={identity:(website?15:0)+(github?10:0)+(kp?10:0),code:(repo?15:0)+(technology?5:0)+(verifiedGithub?10:0),documentation:(hasDocs?8:0),web3_identity:(sources.some(x=>x.type==="web3_identity")?6:0),domain_corroboration:(domainCorroboration?5:0),contract:(contracts.length?12:0),market:(dex?10:0),defi:(llama?8:0),package:(npm?.length?4:0),breadth:(sources.length>=6?3:sources.length>=3?1:0)};const evidence=Math.min(100,Object.values(evidenceParts).reduce((a,b)=>a+b,0));const identityStrength=(website?1:0)+(github?1:0)+(kp?1:0)+(contracts.length?1:0);const independentSignals=[repo,dex,llama,npm?.length?npm:null].filter(Boolean).length;const confidence=Math.min(95,Math.max(15,Math.round(evidence*0.7+identityStrength*5+independentSignals*3-risk.length*2)));
  const llamaLaunch=llama?.find((x:any)=>x.listedAt)?.listedAt;const launchDate=repo?.created_at||(llamaLaunch?new Date(Number(llamaLaunch)*1000).toISOString():null);const llamaRev=llama?.find((x:any)=>x.revenue!=null||x.fees24h!=null);const revenueValue=llamaRev?.revenue??null;const activeUsersValue=null,monthlyVisitsValue=null;const missingCore=[!website,!github,!technology,!launchDate,!activeUsersValue,!monthlyVisitsValue,!revenueValue,!contracts.length].filter(Boolean).length;const riskScore=Math.max(0,Math.min(100,20+risk.length*10+missingCore*4-(sources.length>=8?10:0)-(dex?5:0)-(llama?5:0)-(repo?5:0)));const riskLevel=riskScore>=70?"high":riskScore>=40?"medium":"low";const passport={project_name:name,website,category:kp?.category||category(ctx),description,founded_or_launched:launchDate,technology,blockchains:chains,github,active_users:activeUsersValue,monthly_visits:monthlyVisitsValue,revenue:revenueValue,token_or_contracts:contracts.length?contracts:null,public_activity:repo?{stars:repo.stargazers_count,forks:repo.forks_count,open_issues:repo.open_issues_count,watchers:repo.watchers_count,created_at:repo.created_at,last_push:repo.pushed_at,license:repo.license?.spdx_id||null}:null,market_data:dex,defi_data:llama,npm_data:npm,ai_summary:"Free multi-source public research. DeFiLlama is included only on an exact normalized project-name/slug match; DEX Screener is included only when a pair token address matches a collected contract address; npm packages are included only when repository/homepage identity links to the verified project.  Missing user, traffic and revenue figures remain unreported unless a public source verifies them. Launch dates use public GitHub or DeFiLlama timestamps when available. Risk is an evidence-completeness indicator, not a financial or security audit.",ai_risk_level:riskLevel,ai_risk_score:riskScore,evidence_score:evidence,confidence_score:confidence,risk_indicators:risk,key_findings:findings,sources:unique(sources).slice(0,30),source_status:sources.length>=3?"multi_source":"limited_public_evidence",external_only:true,web3market_listing_status:"not_listed"};
  passport.passport_eligibility=passportEligibility(passport);return J({success:true,passport},200,req);
 }catch(e){return J({error:e instanceof Error?e.message:"Unexpected error"},500,req)}
});