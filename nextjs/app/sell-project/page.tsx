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
  targetMarkets: string;
  projectTypes: string;
  services: string;
  hasRevenue: string;
  revenuePeriod: string;
  selectedAssets: string;
  buyerPitch: string;
  assetNotes: string;
  appStoreUrl: string;
  yearlyProfit: string;
  growthRate: string;
  totalSales: string;
  monthlyVolume: string;
  conversionRate: string;
  lastActiveDate: string;
  trafficSources: string;
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
  facebookUrl: string;
  instagramUrl: string;
  youtubeUrl: string;
  tiktokUrl: string;
  redditUrl: string;
  mediumUrl: string;
  otherSocialUrl: string;
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
  targetAudience: "", targetMarkets: "", projectTypes: "", services: "", hasRevenue: "", revenuePeriod: "", selectedAssets: "", buyerPitch: "", assetNotes: "", appStoreUrl: "", yearlyProfit: "", growthRate: "", totalSales: "", monthlyVolume: "", conversionRate: "", lastActiveDate: "", trafficSources: "", marketOpportunity: "", competitiveAdvantage: "", competitors: "", monthlyVisits: "", activeUsers: "", customers: "",
  yearlyRevenue: "", monthlyExpenses: "", revenueSources: "", financialNotes: "", reasonForSale: "", saleType: "Full acquisition",
  demoUrl: "", documentationUrl: "", twitterUrl: "", telegramUrl: "", discordUrl: "", linkedinUrl: "", facebookUrl: "", instagramUrl: "", youtubeUrl: "", tiktokUrl: "", redditUrl: "", mediumUrl: "", otherSocialUrl: "",
  askingPrice: "", currency: "USD", negotiable: true, monthlyRevenue: "", monthlyProfit: "",
  users: "", transferTerms: "", transferPeriod: "", ownershipDeclaration: false,
};

function restoreDraft(value: unknown): ListingDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...emptyDraft };

  const candidate = value as Partial<ListingDraft>;
  const restored: ListingDraft = { ...emptyDraft };
  (Object.keys(emptyDraft) as Array<keyof ListingDraft>).forEach((key) => {
    const incoming = candidate[key];
    const expected = emptyDraft[key];
    if (typeof incoming === typeof expected) {
      Object.assign(restored, { [key]: incoming });
    }
  });
  return restored;
}

function validHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}
function validGithubRepo(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.hostname.toLowerCase() === "github.com" &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname);
  } catch { return false; }
}

function mediaFileError(file: File, kind: "image" | "video"): string | null {
  const allowed = kind === "image"
    ? ["image/png", "image/jpeg", "image/webp"]
    : ["video/mp4", "video/webm", "video/quicktime"];
  const maxBytes = kind === "video" ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
  if (!allowed.includes(file.type)) {
    return kind === "video" ? "Choose an MP4, WebM, or MOV video." : "Choose a PNG, JPG, or WebP image.";
  }
  if (file.size > maxBytes) {
    return (kind === "video" ? "Video" : "Image") + " exceeds the " + (maxBytes / (1024 * 1024)) + " MB limit.";
  }
  return null;
}

function validNonNegativeNumber(value: string): boolean {
  if (!value.trim()) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function optionalNonNegativeNumberError(value: string, label: string): string | null {
  if (!value.trim()) return null;
  return validNonNegativeNumber(value) ? null : label + " must be a valid non-negative number";
}

function optionalRateError(value: string, label: string, min: number, max?: number): string | null {
  if (!value.trim()) return null;
  const normalized = value.trim().endsWith("%") ? value.trim().slice(0, -1).trim() : value.trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    return max === undefined
      ? label + " must be a valid number greater than or equal to " + min
      : label + " must be a valid number between " + min + " and " + max;
  }
  return null;
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
      if (saved) setDraft(restoreDraft(JSON.parse(saved)));
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
      validNonNegativeNumber(draft.askingPrice),
      ((Boolean(draft.projectUrl.trim()) && validHttpsUrl(draft.projectUrl) && !/(^|\.)github\.com$/i.test(new URL(draft.projectUrl).hostname)) || (Boolean(draft.githubUrl.trim()) && validGithubRepo(draft.githubUrl))),
      (!draft.projectUrl.trim() || (validHttpsUrl(draft.projectUrl) && !/(^|\.)github\.com$/i.test(new URL(draft.projectUrl).hostname))),
      (!draft.githubUrl.trim() || validGithubRepo(draft.githubUrl)),
      Boolean(draft.transferTerms.trim()),
      draft.ownershipDeclaration,
    ];
    return { count: checks.filter(Boolean).length, total: checks.length, percent: Math.round(checks.filter(Boolean).length / checks.length * 100) };
  }, [draft]);

  function update<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function toggleListValue(key: "projectTypes" | "services" | "targetAudience" | "selectedAssets", value: string, checked: boolean) {
    const current = draft[key].split(",").map(item => item.trim()).filter(Boolean);
    const next = checked ? Array.from(new Set([...current, value])) : current.filter(item => item !== value);
    update(key, next.join(", "));
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
    if (!validNonNegativeNumber(draft.askingPrice)) errors.push("valid non-negative asking price");
    const numericFields: Array<[string, string]> = [
      ["monthly revenue", draft.monthlyRevenue], ["monthly profit", draft.monthlyProfit],
      ["yearly revenue", draft.yearlyRevenue], ["yearly profit", draft.yearlyProfit], ["monthly expenses", draft.monthlyExpenses],
      ["monthly volume", draft.monthlyVolume], ["total sales", draft.totalSales],
      ["users / customers", draft.users], ["active users", draft.activeUsers],
      ["paying customers", draft.customers], ["monthly visits", draft.monthlyVisits],
    ];
    numericFields.forEach(([label, value]) => {
      const error = optionalNonNegativeNumberError(value, label);
      if (error) errors.push(error);
    });
    const growthError = optionalRateError(draft.growthRate, "growth rate", -100);
    if (growthError) errors.push(growthError);
    const conversionError = optionalRateError(draft.conversionRate, "conversion rate", 0, 100);
    if (conversionError) errors.push(conversionError);
    const integerFields: Array<[string, string]> = [
      ["users / customers", draft.users], ["active users", draft.activeUsers],
      ["paying customers", draft.customers], ["monthly visits", draft.monthlyVisits],
      ["total sales", draft.totalSales],
    ];
    integerFields.forEach(([label, value]) => {
      if (value.trim() && validNonNegativeNumber(value) && !Number.isInteger(Number(value))) {
        errors.push(label + " must be a whole number");
      }
    });
    if (draft.yearCreated.trim()) {
      const year = Number(draft.yearCreated);
      if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear() + 1) {
        errors.push("valid year created");
      }
    }
    if (draft.lastActiveDate.trim()) {
      const activeDate = new Date(draft.lastActiveDate + "T00:00:00");
      if (Number.isNaN(activeDate.getTime()) || activeDate > new Date()) {
        errors.push("last active date must be a valid date no later than today");
      }
    }
    if (draft.fullDescription.length > 20000) errors.push("full description (maximum 20,000 characters)");
    const hasWebsite = Boolean(draft.projectUrl.trim());
    const hasRepository = Boolean(draft.githubUrl.trim());
    if (!hasWebsite && !hasRepository) errors.push("at least one project reference (official website or GitHub repository)");
    if (hasWebsite && (!validHttpsUrl(draft.projectUrl) || /(^|\.)github\.com$/i.test(new URL(draft.projectUrl).hostname))) errors.push("valid official HTTPS website (keep GitHub in its own field)");
    if (hasRepository && !validGithubRepo(draft.githubUrl)) errors.push("valid GitHub owner/repository URL");
    const optionalLinks: Array<[string, string]> = [
      ["demo URL", draft.demoUrl], ["documentation URL", draft.documentationUrl],
      ["X / Twitter URL", draft.twitterUrl], ["Telegram URL", draft.telegramUrl],
      ["Discord URL", draft.discordUrl], ["LinkedIn URL", draft.linkedinUrl], ["App Store URL", draft.appStoreUrl],
      ["Facebook URL", draft.facebookUrl], ["Instagram URL", draft.instagramUrl], ["YouTube URL", draft.youtubeUrl],
      ["TikTok URL", draft.tiktokUrl], ["Reddit URL", draft.redditUrl], ["Medium URL", draft.mediumUrl], ["Other social URL", draft.otherSocialUrl],
    ];
    optionalLinks.forEach(([label, value]) => {
      if (value.trim() && !validHttpsUrl(value)) errors.push(label + " must use HTTPS");
    });
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
            <label className="field full-field">Full project description <b>*</b><span className="field-hint">Explain the problem, solution, features, current status, users, technology and what a buyer receives.</span><textarea value={draft.fullDescription} onChange={e => update("fullDescription", e.target.value)} minLength={50} maxLength={20000} rows={6} placeholder="Describe the product, differentiators, traction, roadmap, and included assets..." /><small>{draft.fullDescription.length} characters · 50 minimum for preview validation</small></label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>02</span><div><h2>Website and source code</h2><p>At least one reference is required: provide the official website, the GitHub repository, or both. Keep them in separate fields.</p></div></div>
          <div className="listing-fields">
            <label className="field">Official website <input type="url" value={draft.projectUrl} onChange={e => update("projectUrl", e.target.value)} placeholder="https://yourproject.com" /><small className={draft.projectUrl && !validHttpsUrl(draft.projectUrl) ? "field-error" : "field-hint"}>{draft.projectUrl && !validHttpsUrl(draft.projectUrl) ? "Enter a valid HTTPS URL." : "Must use HTTPS and must not be a GitHub repository link."}</small></label>
            <label className="field">GitHub repository <input type="url" value={draft.githubUrl} onChange={e => update("githubUrl", e.target.value)} placeholder="https://github.com/owner/repository" /><small className={draft.githubUrl && !validGithubRepo(draft.githubUrl) ? "field-error" : "field-hint"}>{draft.githubUrl && !validGithubRepo(draft.githubUrl) ? "Use the format https://github.com/owner/repository." : "Use the canonical owner/repository URL. Do not put this in the website field."}</small></label>
            <label className="field">Project category <b>*</b><select value={draft.category} onChange={e => update("category", e.target.value)}><option value="">Select a category</option><option>DeFi</option><option>Infrastructure</option><option>AI / Web3</option><option>GameFi</option><option>NFT / Digital Assets</option><option>SaaS / Digital Business</option><option>Developer Tools</option><option>Other</option></select></label>
            <label className="field">Development stage<select value={draft.projectStage} onChange={e => update("projectStage", e.target.value)}><option>Idea</option><option>Prototype</option><option>Testnet</option><option>Production Beta</option><option>Live Product</option><option>Revenue-Generating</option></select></label>
            <label className="field">Blockchain / network<input value={draft.blockchain} onChange={e => update("blockchain", e.target.value)} placeholder="e.g. BNB Chain, Ethereum, Solana" /></label>
            <label className="field">Business model<input value={draft.businessModel} onChange={e => update("businessModel", e.target.value)} placeholder="e.g. subscription, transaction fee, SaaS" /></label>
            <label className="field">Technology stack<input value={draft.techStack} onChange={e => update("techStack", e.target.value)} placeholder="e.g. Next.js, Solidity, PostgreSQL" /></label>
            <label className="field">Year created<input type="number" min="1990" max="2100" value={draft.yearCreated} onChange={e => update("yearCreated", e.target.value)} placeholder="e.g. 2025" /></label>
            <fieldset className="field full-field"><legend>Project types</legend><div className="listing-choice-grid">{["Website", "SaaS", "AI application", "Smart contract", "DeFi protocol", "Mobile app", "Game", "Marketplace", "Developer tool", "Other"].map(value => <label className="choice" key={value}><input type="checkbox" checked={draft.projectTypes.split(",").map(item => item.trim()).includes(value)} onChange={e => toggleListValue("projectTypes", value, e.target.checked)} /> {value}</label>)}</div></fieldset>
            <fieldset className="field full-field"><legend>Industry / service categories</legend><div className="listing-choice-grid">{["Health", "Education", "Marketing", "Sales", "Finance", "Web3", "AI", "Social", "Business", "Real Estate", "Travel", "Gaming", "Media", "Freelance", "Other"].map(value => <label className="choice" key={value}><input type="checkbox" checked={draft.services.split(",").map(item => item.trim()).includes(value)} onChange={e => toggleListValue("services", value, e.target.checked)} /> {value}</label>)}</div></fieldset>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>03</span><div><h2>Market, audience and competitive position</h2><p>Describe the intended users and why buyers may choose this project.</p></div></div>
          <div className="listing-fields">
            <fieldset className="field full-field"><legend>Target audience</legend><div className="listing-choice-grid">{["Developers", "Business Owners", "Companies", "Freelancers", "Startups", "Investors", "Students", "Professionals", "Consumers", "Enterprises", "General Users"].map(value => <label className="choice" key={value}><input type="checkbox" checked={draft.targetAudience.split(",").map(item => item.trim()).includes(value)} onChange={e => toggleListValue("targetAudience", value, e.target.checked)} /> {value}</label>)}</div></fieldset>
            <label className="field full-field">Target markets<input value={draft.targetMarkets} onChange={e => update("targetMarkets", e.target.value)} placeholder="e.g. Global, Egypt, GCC, Europe" /></label>
            <label className="field full-field">Buyer pitch<textarea rows={3} value={draft.buyerPitch} onChange={e => update("buyerPitch", e.target.value)} placeholder="Why should a buyer choose this project?" /></label>
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
            <label className="field">App Store URL<input type="url" value={draft.appStoreUrl} onChange={e => update("appStoreUrl", e.target.value)} placeholder="https://apps.apple.com/..." /></label>
            <label className="field">Facebook URL<input type="url" value={draft.facebookUrl} onChange={e => update("facebookUrl", e.target.value)} placeholder="https://facebook.com/..." /></label>
            <label className="field">Instagram URL<input type="url" value={draft.instagramUrl} onChange={e => update("instagramUrl", e.target.value)} placeholder="https://instagram.com/..." /></label>
            <label className="field">YouTube URL<input type="url" value={draft.youtubeUrl} onChange={e => update("youtubeUrl", e.target.value)} placeholder="https://youtube.com/..." /></label>
            <label className="field">TikTok URL<input type="url" value={draft.tiktokUrl} onChange={e => update("tiktokUrl", e.target.value)} placeholder="https://tiktok.com/@..." /></label>
            <label className="field">Reddit URL<input type="url" value={draft.redditUrl} onChange={e => update("redditUrl", e.target.value)} placeholder="https://reddit.com/..." /></label>
            <label className="field">Medium URL<input type="url" value={draft.mediumUrl} onChange={e => update("mediumUrl", e.target.value)} placeholder="https://medium.com/..." /></label>
            <label className="field">Other public link<input type="url" value={draft.otherSocialUrl} onChange={e => update("otherSocialUrl", e.target.value)} placeholder="https://..." /></label>
          </div>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>05</span><div><h2>Files and media</h2><p>Select media to check the interface. These files are not uploaded or persisted.</p></div></div>
          <div className="listing-fields">
            <label className="field">Project logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (!file) { setLogoName(""); return; } const error = mediaFileError(file, "image"); if (error) { e.target.value = ""; setLogoName("Rejected: " + error); return; } setLogoName(file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " MB"); }} /><small>{logoName ? (logoName.startsWith("Rejected:") ? logoName : "Selected: " + logoName) : "PNG, JPG or WebP · Max 8 MB. Files are not uploaded in this preview."}</small></label>
            <label className="field">Cover image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (!file) { setCoverName(""); return; } const error = mediaFileError(file, "image"); if (error) { e.target.value = ""; setCoverName("Rejected: " + error); return; } setCoverName(file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " MB"); }} /><small>{coverName ? (coverName.startsWith("Rejected:") ? coverName : "Selected: " + coverName) : "PNG, JPG or WebP · Max 8 MB"}</small></label>
            <label className="field">Demo video<input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={e => { const file = e.target.files?.[0]; if (!file) { setVideoName(""); return; } const error = mediaFileError(file, "video"); if (error) { e.target.value = ""; setVideoName("Rejected: " + error); return; } setVideoName(file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " MB"); }} /><small>{videoName ? (videoName.startsWith("Rejected:") ? videoName : "Selected: " + videoName) : "MP4, WebM or MOV · Max 50 MB"}</small></label>
            <label className="field">Screenshots<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => { const files = Array.from(e.target.files || []); const invalid = files.find(file => mediaFileError(file, "image")); if (invalid) { e.target.value = ""; setScreenshots(["Rejected: " + invalid.name + " — " + mediaFileError(invalid, "image")]); return; } setScreenshots(files.map(file => file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " MB")); }} /><small>{screenshots.length ? (screenshots[0].startsWith("Rejected:") ? screenshots[0] : screenshots.length + " file(s): " + screenshots.join(", ")) : "Select multiple screenshots · Each image max 8 MB"}</small></label>
          </div>
          <p className="media-warning">For this stage, file selection is only a UI test. Reloading the page will not retain the selected files.</p>
        </section>

        <section className="listing-section">
          <div className="listing-section-heading"><span>06</span><div><h2>Price and performance</h2><p>Use honest figures; do not report estimates as verified metrics.</p></div></div>
          <div className="listing-fields">
            <label className="field">Asking price <b>*</b><input type="number" min="0" step="0.01" value={draft.askingPrice} onChange={e => update("askingPrice", e.target.value)} placeholder="0.00" /></label>
            <label className="field">Currency<select value={draft.currency} onChange={e => update("currency", e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>USDT</option><option>BNB</option></select></label>
            <label className="field">Generates revenue?<select value={draft.hasRevenue} onChange={e => update("hasRevenue", e.target.value)}><option value="">Not specified</option><option value="Yes">Yes</option><option value="No">No</option></select></label>
            <label className="field">Revenue period<select value={draft.revenuePeriod} onChange={e => update("revenuePeriod", e.target.value)}><option value="">Not specified</option><option value="Monthly">Monthly</option><option value="Yearly">Yearly</option><option value="Both">Both</option></select></label>
            <label className="field">Monthly revenue<input type="number" min="0" step="0.01" value={draft.monthlyRevenue} onChange={e => update("monthlyRevenue", e.target.value)} placeholder="0 if none" /></label>
            <label className="field">Monthly profit<input type="number" step="0.01" value={draft.monthlyProfit} onChange={e => update("monthlyProfit", e.target.value)} placeholder="0 if none" /></label>
            <label className="field">Yearly revenue<input type="number" min="0" step="0.01" value={draft.yearlyRevenue} onChange={e => update("yearlyRevenue", e.target.value)} placeholder="0 if none" /></label>
            <label className="field">Yearly profit<input type="number" min="0" step="0.01" value={draft.yearlyProfit} onChange={e => update("yearlyProfit", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Monthly expenses<input type="number" min="0" step="0.01" value={draft.monthlyExpenses} onChange={e => update("monthlyExpenses", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Users / customers<input type="number" min="0" step="1" value={draft.users} onChange={e => update("users", e.target.value)} placeholder="Total users" /></label>
            <label className="field">Active users<input type="number" min="0" step="1" value={draft.activeUsers} onChange={e => update("activeUsers", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Paying customers<input type="number" min="0" step="1" value={draft.customers} onChange={e => update("customers", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Monthly visits<input type="number" min="0" step="1" value={draft.monthlyVisits} onChange={e => update("monthlyVisits", e.target.value)} placeholder="Optional" /></label>
            <label className="field">Total sales<input type="number" min="0" step="1" value={draft.totalSales} onChange={e => update("totalSales", e.target.value)} placeholder="Number of completed sales" /></label>
            <label className="field">Monthly transaction volume<input type="number" min="0" step="0.01" value={draft.monthlyVolume} onChange={e => update("monthlyVolume", e.target.value)} placeholder="Optional monetary volume" /></label>
            <label className="field">Growth rate<input value={draft.growthRate} onChange={e => update("growthRate", e.target.value)} placeholder="e.g. 12% (state the period in notes)" /></label>
            <label className="field">Conversion rate<input value={draft.conversionRate} onChange={e => update("conversionRate", e.target.value)} placeholder="e.g. 3.4%" /></label>
            <label className="field">Last active date<input type="date" value={draft.lastActiveDate} onChange={e => update("lastActiveDate", e.target.value)} /></label>
            <label className="field full-field">Traffic sources<textarea rows={2} value={draft.trafficSources} onChange={e => update("trafficSources", e.target.value)} placeholder="Organic, social, paid, referrals; include measurement period" /></label>
            <label className="field">Revenue sources<input value={draft.revenueSources} onChange={e => update("revenueSources", e.target.value)} placeholder="e.g. subscriptions, fees, ads" /></label>
            <label className="field">Currently generating revenue?<select value={draft.hasRevenue} onChange={e => update("hasRevenue", e.target.value)}><option value="">Not specified</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field">Revenue reporting period<select value={draft.revenuePeriod} onChange={e => update("revenuePeriod", e.target.value)}><option value="">Not specified</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option><option value="lifetime">Lifetime / cumulative</option></select></label>
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
            <fieldset className="field full-field"><legend>Assets included in the sale</legend><div className="listing-choice-grid">{["Source code", "Domain name", "Brand / logo", "Website", "Smart contracts", "Mobile app", "Customer database (where lawful)", "Social accounts (where transferable)", "Documentation", "Design files", "AI models / prompts", "Other assets"].map(value => <label className="choice" key={value}><input type="checkbox" checked={draft.selectedAssets.split(",").map(item => item.trim()).includes(value)} onChange={e => toggleListValue("selectedAssets", value, e.target.checked)} /> {value}</label>)}</div></fieldset>
            <label className="field full-field">Assets included / excluded — details<textarea rows={3} value={draft.assetNotes} onChange={e => update("assetNotes", e.target.value)} placeholder="Clarify exclusions, ownership restrictions, licences, and transfer limitations..." /></label>
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
