"use client";

import { useEffect, useMemo, useState } from "react";
import "../listing.css";

type ListingDraft = {
  projectName: string;
  shortDescription: string;
  fullDescription: string;
  projectUrl: string;
  githubUrl: string;
  category: string;
  projectStage: string;
  blockchain: string;
  businessModel: string;
  techStack: string;
  yearCreated: string;
  targetAudience: string;
  marketOpportunity: string;
  competitiveAdvantage: string;
  competitors: string;
  monthlyVisits: string;
  activeUsers: string;
  customers: string;
  yearlyRevenue: string;
  monthlyExpenses: string;
  revenueSources: string;
  financialNotes: string;
  reasonForSale: string;
  saleType: string;
  demoUrl: string;
  documentationUrl: string;
  twitterUrl: string;
  telegramUrl: string;
  discordUrl: string;
  linkedinUrl: string;
  askingPrice: string;
  currency: string;
  negotiable: boolean;
  monthlyRevenue: string;
  monthlyProfit: string;
  users: string;
  transferTerms: string;
  transferPeriod: string;
  ownershipDeclaration: boolean;
};

const STORAGE_KEY = "w3m-nextjs-listing-draft-v1";
const emptyDraft: ListingDraft = {
  projectName: "", shortDescription: "", fullDescription: "", projectUrl: "", githubUrl: "",
  category: "", projectStage: "Prototype", blockchain: "", businessModel: "", techStack: "", yearCreated: "",
  targetAudience: "", marketOpportunity: "", competitiveAdvantage: "", competitors: "", monthlyVisits: "", activeUsers: "", customers: "",
  yearlyRevenue: "", monthlyExpenses: "", revenueSources: "", financialNotes: "", reasonForSale: "", saleType: "Full acquisition",
  demoUrl: "", documentationUrl: "", twitterUrl: "", telegramUrl: "", discordUrl: "", linkedinUrl: "",
  askingPrice: "", currency: "USD", negotiable: true, monthlyRevenue: "", monthlyProfit: "",
  users: "", transferTerms: "", transferPeriod: "", ownershipDeclaration: false,
};

function validHttpsUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:"; } catch { return false; }
}
function validGithubRepo(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "github.com" &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname);
  } catch { return false; }
}

export default function SellProjectPage() {
  const [draft, setDraft] = useState<ListingDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("This is a local preview. Nothing is sent to production.");
  const [logoName, setLogoName] = useState("");
  const [coverName, setCoverName] = useState("");
  const [videoName, setVideoName] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setDraft({ ...emptyDraft, ...JSON.parse(saved) });
    } catch { setStatus("Could not restore the local preview draft."); }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      setStatus("Preview draft saved on this device · " + new Date().toLocaleTimeString());
    } catch { setStatus("Browser storage is unavailable. Copy your text before leaving."); }
  }, [draft, loaded]);

  const readiness = useMemo(() => {
    const checks = [
      Boolean(draft.projectName.trim()),
      draft.shortDescription.trim().length >= 20,
      draft.fullDescription.trim().length >= 50,
      Boolean(draft.category),
      draft.askingPrice.trim() !== "" && Number(draft.askingPrice) >= 0,
      validHttpsUrl(draft.projectUrl),
      validGithubRepo(draft.githubUrl),
      Boolean(draft.transferTerms.trim()),
      draft.ownershipDeclaration,
    ];
    return { count: checks.filter(Boolean).length, total: checks.length, percent: Math.round(checks.filter(Boolean).length / checks.length * 100) };
  }, [draft]);

  function update<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function clearDraft() {
    if (!window.confirm("Clear this local preview draft? This does not delete any production listing.")) return;
    window.localStorage.removeItem(STORAGE_KEY);
    setDraft(emptyDraft);
    setLogoName(""); setCoverName(""); setVideoName(""); setScreenshots([]);
    setStatus("Local preview draft cleared. No production data was changed.");
  }
  function submitPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: string[] = [];
    if (!draft.projectName.trim()) errors.push("project name");
    if (draft.shortDescription.trim().length < 20) errors.push("short description (20+ characters)");
    if (draft.fullDescription.trim().length < 50) errors.push("full description (50+ characters)");
    if (!draft.category) errors.push("project category");
    if (!draft.askingPrice.trim() || !Number.isFinite(Number(draft.askingPrice)) || Number(draft.askingPrice) < 0) errors.push("valid asking price");
    if (!validHttpsUrl(draft.projectUrl) || /(^|\.)github\.com$/i.test(new URL(draft.projectUrl).hostname)) errors.push("official HTTPS website");
    if (!validGithubRepo(draft.githubUrl)) errors.push("GitHub owner/repository URL");
    if (!draft.transferTerms.trim()) errors.push("transfer terms");
    if (!draft.ownershipDeclaration) errors.push("ownership confirmation");
    if (errors.length) {
      setStatus("Preview validation: complete " + errors.join("; ") + ". Your local draft is preserved.");
      return;
    }
    setStatus("Preview validation passed. AI review and cloud submission are not enabled in this prototype.");
  }

  return (
    <main className="site-shell listing-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Web3Market home"><span className="brand-mark">W3M</span><span>Web3Market</span></a>
        <span className="preview-pill"><span className="status-dot" /> Private migration preview</span>
      </header>
      <section className="listing-heading">
        <p className="eyebrow">SELLER WORKSPACE · PREVIEW</p>
        <h1 className="listing-title">Create a project listing.</h1>
        <p className="listing-intro">Describe the project clearly, provide the official website and source repository separately, and add transfer details. Incomplete drafts can be saved while you work.</p>
        <div className="listing-safety-note"><strong>Preview only.</strong> This form saves in this browser only. It does not sign in, upload files, call AI review, or write to production Supabase.</div>
      </section>

      <div className="listing-progress" aria-live="polite">
        <div className="listing-progress-top"><strong>Listing readiness</strong><strong>{readiness.percent}%</strong></div>
        <div className="listing-progress-track"><span style={{ width: readiness.percent + "%" }} /></div>
        <p>{readiness.count} of {readiness.total} core checks currently pass. This is guidance, not an approval or valuation.</p>
      </div>

      <form className="listing-form" onSubmit={submitPreview}>
        <section className="listing-section">
          <div className="listing-section-heading"><span>01</span><div><h2>Project identity</h2><p>The project name and two distinct descriptions.</p></div></div>
          <div className="listing-fields">
            <label className="field full-field">Project name <b>*</b><input value={draft.projectName} onChange={e => update("projectName", e.target.value)} placeholder="e.g. Web3 analytics platform" autoComplete="off" /></label>
            <label className="field full-field">Short description <b>*</b><span className="field-hint">A concise summary for search results and listing cards. Aim for one or two sentences.</span><textarea value={draft.shortDescription} onChange={e => update("shortDescription", e.target.value)} minLength={20} maxLength={220} rows={3} placeholder="What does the project do, and who is it for?" /><small>{draft.shortDescription.length}/220 characters · 20 minimum for preview validation</small></label>
            <label className="field full-field">Full project description <b>*</b><span className="field-hint">Explain the problem, solution, features, current status, users, technology and what a buyer receives.</span><textarea value={draft.fullDescription} onChange={e => update("fullDescription", e.target.value)} minLength={50} rows={6} placeholder="Describe the product, differentiators, traction, roadmap, and included assets..." /><small>{draft.fullDescription.length} characters · 50 minimum for preview validation</small></label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>02</span><div><h2>Website and source code</h2><p>Keep the official product website separate from the code repository.</p></div></div>
          <div className="listing-fields">
            <label className="field">Official website <b>*</b><input type="url" value={draft.projectUrl} onChange={e => update("projectUrl", e.target.value)} placeholder="https://yourproject.com" /><small className={draft.projectUrl && !validHttpsUrl(draft.projectUrl) ? "field-error" : "field-hint"}>{draft.projectUrl && !validHttpsUrl(draft.projectUrl) ? "Enter a valid HTTPS URL." : "Must use HTTPS and must not be a GitHub repository link."}</small></label>
            <label className="field">GitHub repository <b>*</b><input type="url" value={draft.githubUrl} onChange={e => update("githubUrl", e.target.value)} placeholder="https://github.com/owner/repository" /><small className={draft.githubUrl && !validGithubRepo(draft.githubUrl) ? "field-error" : "field-hint"}>{draft.githubUrl && !validGithubRepo(draft.githubUrl) ? "Use the format https://github.com/owner/repository." : "Use the canonical owner/repository URL. Do not put this in the website field."}</small></label>
            <label className="field">Project category <b>*</b><select value={draft.category} onChange={e => update("category", e.target.value)}><option value="">Select a category</option><option>DeFi</option><option>Infrastructure</option><option>AI / Web3</option><option>GameFi</option><option>NFT / Digital Assets</option><option>SaaS / Digital Business</option><option>Developer Tools</option><option>Other</option></select></label>
            <label className="field">Development stage<select value={draft.projectStage} onChange={e => update("projectStage", e.target.value)}><option>Idea</option><option>Prototype</option><option>Testnet</option><option>Production Beta</option><option>Live Product</option><option>Revenue-Generating</option></select></label>
            <label className="field">Blockchain / network<input value={draft.blockchain} onChange={e => update("blockchain", e.target.value)} placeholder="e.g. BNB Chain, Ethereum, Solana" /></label>
            <label className="field">Business model<input value={draft.businessModel} onChange={e => update("businessModel", e.target.value)} placeholder="e.g. subscription, transaction fee, SaaS" /></label>
            <label className="field">Technology stack<input value={draft.techStack} onChange={e => update("techStack", e.target.value)} placeholder="e.g. Next.js, Solidity, PostgreSQL" /></label>
            <label className="field">Year created<input type="number" min="1990" max="2100" value={draft.yearCreated} onChange={e => update("yearCreated", e.target.value)} placeholder="e.g. 2025" /></label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>03</span><div><h2>Market, audience and competitive position</h2><p>Describe the intended users and why buyers may choose this project.</p></div></div>
          <div className="listing-fields">
            <label className="field full-field">Target audience<input value={draft.targetAudience} onChange={e => update("targetAudience", e.target.value)} placeholder="Who uses or would use this project?" /></label>
            <label className="field full-field">Market opportunity<textarea rows={3} value={draft.marketOpportunity} onChange={e => update("marketOpportunity", e.target.value)} placeholder="Market, problem solved, and demand signals" /></label>
            <label className="field full-field">Competitive advantage<textarea rows={3} value={draft.competitiveAdvantage} onChange={e => update("competitiveAdvantage", e.target.value)} placeholder="What differentiates this project?" /></label>
            <label className="field full-field">Known competitors<input value={draft.competitors} onChange={e => update("competitors", e.target.value)} placeholder="Optional; separate names with commas" /></label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>04</span><div><h2>Public links and community</h2><p>Keep public references separate from the official website and source repository.</p></div></div>
          <div className="listing-fields">
            <label className="field">Demo URL<input type="url" value={draft.demoUrl} onChange={e => update("demoUrl", e.target.value)} placeholder="https://..." /></label>
            <label className="field">Documentation URL<input type="url" value={draft.documentationUrl} onChange={e => update("documentationUrl", e.target.value)} placeholder="https://..." /></label>
            <label className="field">X / Twitter URL<input type="url" value={draft.twitterUrl} onChange={e => update("twitterUrl", e.target.value)} placeholder="https://x.com/..." /></label>
            <label className="field">Telegram URL<input type="url" value={draft.telegramUrl} onChange={e => update("telegramUrl", e.target.value)} placeholder="https://t.me/..." /></label>
            <label className="field">Discord URL<input type="url" value={draft.discordUrl} onChange={e => update("discordUrl", e.target.value)} placeholder="https://discord.gg/..." /></label>
            <label className="field">LinkedIn URL<input type="url" value={draft.linkedinUrl} onChange={e => update("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/..." /></label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>05</span><div><h2>Files and media</h2><p>Select media to check the interface. These files are not uploaded or persisted.</p></div></div>
          <div className="listing-fields">
            <label className="field">Project logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setLogoName(e.target.files?.[0]?.name || "")} /><small>{logoName ? "Selected: " + logoName : "PNG, JPG or WebP · Upload will be wired after storage-policy review."}</small></label>
            <label className="field">Cover image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setCoverName(e.target.files?.[0]?.name || "")} /><small>{coverName ? "Selected: " + coverName : "PNG, JPG or WebP"}</small></label>
            <label className="field">Demo video<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e => setVideoName(e.target.files?.[0]?.name || "")} /><small>{videoName ? "Selected: " + videoName : "MP4, WebM or MOV"}</small></label>
            <label className="field">Screenshots<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => setScreenshots(Array.from(e.target.files || []).map(f => f.name))} /><small>{screenshots.length ? screenshots.length + " file(s): " + screenshots.join(", ") : "Select multiple screenshots"}</small></label>
          </div>
          <p className="media-warning">For this stage, file selection is only a UI test. Reloading the page will not retain the selected files.</p>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>06</span><div><h2>Price and performance</h2><p>Use honest figures; do not report estimates as verified metrics.</p></div></div>
          <div className="listing-fields">
            <label className="field">Asking price <b>*</b><input type="number" min="0" step="0.01" value={draft.askingPrice} onChange={e => update("askingPrice", e.target.value)} placeholder="0.00" /></label>
            <label className="field">Currency<select value={draft.currency} onChange={e => update("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>USDT</option><option>BNB</option></select></label>
            <label className="field">Monthly revenue<input type="number" min="0" step="0.01" value={draft.monthlyRevenue} onChange={e => update("monthlyRevenue", e.target.value)} placeholder="0 if none" /></label>
            <label className="field">Monthly profit<input type="number" step="0.01" value={draft.monthlyProfit} onChange={e => update("monthlyProfit", e.target.value)} placeholder="0 if none" /></label>
            <label className="field">Yearly revenue<input type="number" min="0" step="0.01" value={draft.yearlyRevenue} onChange={e => update("yearlyRevenue", e.target.value)} placeholder="0 if none" /></label>
            <label className="field">Monthly expenses<input type="number" min="0" step="0.01" value={draft.monthlyExpenses} onChange={e => update("monthlyExpenses", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Users / customers<input type="number" min="0" step="1" value={draft.users} onChange={e => update("users", e.target.value)} placeholder="Total users" /></label>
            <label className="field">Active users<input type="number" min="0" step="1" value={draft.activeUsers} onChange={e => update("activeUsers", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Paying customers<input type="number" min="0" step="1" value={draft.customers} onChange={e => update("customers", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Monthly visits<input type="number" min="0" step="1" value={draft.monthlyVisits} onChange={e => update("monthlyVisits", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Revenue sources<input value={draft.revenueSources} onChange={e => update("revenueSources", e.target.value)} placeholder="e.g. subscriptions, fees, ads" /></label>
            <label className="field full-field">Financial notes<textarea rows={2} value={draft.financialNotes} onChange={e => update("financialNotes", e.target.value)} placeholder="Period covered, evidence available, or important caveats" /></label>
            <label className="field field-checkbox"><input type="checkbox" checked={draft.negotiable} onChange={e => update("negotiable", e.target.checked)} /> Asking price is negotiable</label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>07</span><div><h2>Transfer and ownership</h2><p>Make clear what is included and confirm your right to sell it.</p></div></div>
          <div className="listing-fields">
            <label className="field">Sale type<select value={draft.saleType} onChange={e => update("saleType", e.target.value)}><option>Full acquisition</option><option>Partial acquisition</option><option>Asset sale</option><option>License</option></select></label>
            <label className="field">Reason for sale<input value={draft.reasonForSale} onChange={e => update("reasonForSale", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Expected transfer period<input value={draft.transferPeriod} onChange={e => update("transferPeriod", e.target.value)} placeholder="e.g. 7–14 days" /></label>
            <label className="field full-field">Transfer terms <b>*</b><span className="field-hint">List domains, repositories, contracts, documentation, accounts and any exclusions.</span><textarea rows={4} value={draft.transferTerms} onChange={e => update("transferTerms", e.target.value)} placeholder="What is included in the sale, and how will each asset be transferred?" /></label>
            <label className="field field-checkbox full-field"><input type="checkbox" checked={draft.ownershipDeclaration} onChange={e => update("ownershipDeclaration", e.target.checked)} /> I confirm that I own, or am authorized to sell, this project and the assets I have listed.</label>
          </div>
        </section>

        <div className="listing-actions"><button className="secondary-action" type="button" onClick={clearDraft}>Clear local draft</button><button className="primary-action" type="submit">Validate preview listing <span aria-hidden="true">→</span></button></div>
        <p className="listing-status" role="status" aria-live="polite">{status}</p>
        <p className="listing-disclaimer">Validation in this preview is not AI due diligence, ownership verification, approval, or a production submission.</p>
      </form>
      <footer className="footer"><a href="/">← Back to migration preview</a><span>Isolated prototype · No production writes</span></footer>
    </main>
  );
}
