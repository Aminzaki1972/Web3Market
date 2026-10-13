const capabilities = [
  {
    number: "01",
    title: "Discover",
    description: "Explore Web3 projects, AI apps, SaaS products, websites, and digital businesses.",
  },
  {
    number: "02",
    title: "Analyze",
    description: "Prepare a foundation for project evidence, AI due diligence, and valuation workflows.",
  },
  {
    number: "03",
    title: "Deal Room",
    description: "Plan structured offers, due diligence, asset delivery, and settlement workflows.",
  },
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Web3Market home">
          <span className="brand-mark">W3M</span>
          <span>Web3Market</span>
        </a>
        <span className="preview-pill"><span className="status-dot" /> Private migration preview</span>
      </header>

      <section className="hero">
        <p className="eyebrow">THE WEB3 PROJECT MARKETPLACE</p>
        <h1>Good projects deserve<br /><span>a clearer path to a deal.</span></h1>
        <p className="hero-copy">
          Discover Web3 projects and digital businesses, evaluate their evidence,
          and prepare for structured acquisition workflows.
        </p>
        <div className="hero-actions">
          <a className="primary-action" href="#capabilities">Explore the preview <span aria-hidden="true">↗</span></a>
          <a className="secondary-action" href="https://web3market.xyz/">Visit current website</a>
        </div>
        <p className="notice">Migration preview only. The existing production website and its data remain unchanged.</p>
      </section>

      <section className="capabilities" id="capabilities" aria-labelledby="capabilities-title">
        <div className="section-heading">
          <p className="eyebrow">BUILT FOR DIGITAL OWNERSHIP</p>
          <h2 id="capabilities-title">From discovery to due diligence.</h2>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="capability-card" key={item.number}>
              <span className="card-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>© Web3Market</span>
        <span>Parallel Next.js build · Not connected to production services</span>
      </footer>
    </main>
  );
}
