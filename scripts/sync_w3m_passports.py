import html
import json
import os
import pathlib
import re
import urllib.parse
import urllib.request

BASE = "https://web3market.xyz"
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]

api = (
    SUPABASE_URL
    + "/rest/v1/project_identities?select="
      "identity_code,sequence_no,project_name,identity_status,first_seen_at,created_at"
      "&order=sequence_no.asc"
)

req = urllib.request.Request(
    api,
    headers={
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Accept": "application/json",
    },
)

# Supabase DNS/network can occasionally fail on GitHub-hosted runners.
# Retry normal HTTPS first, then resolve through public DNS-over-HTTPS and use curl --resolve.
last_error = None
rows = None
for attempt in range(1, 6):
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status != 200:
                raise RuntimeError(f"Supabase returned HTTP {response.status}")
            rows = json.load(response)
        print(f"Supabase request succeeded on attempt {attempt}.")
        break
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        last_error = exc
        print(f"Supabase request failed on attempt {attempt}/5: {exc}")
        if attempt < 5:
            import time
            time.sleep(attempt * 2)

if rows is None:
    import subprocess
    import tempfile
    host = urllib.parse.urlparse(SUPABASE_URL).hostname
    if not host:
        raise RuntimeError(f"Invalid SUPABASE_URL: {SUPABASE_URL!r}")
    resolved_ips = []
    for resolver in ("https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"):
        try:
            dns_url = resolver + "?" + urllib.parse.urlencode({"name": host, "type": "A"})
            dns_req = urllib.request.Request(dns_url, headers={"Accept": "application/dns-json", "User-Agent": "W3M-Passport-Sync/1.0"})
            with urllib.request.urlopen(dns_req, timeout=15) as response:
                dns = json.load(response)
            for answer in dns.get("Answer", []):
                if answer.get("type") == 1 and answer.get("data"):
                    ip = str(answer["data"]).strip()
                    if ip and ip not in resolved_ips:
                        resolved_ips.append(ip)
        except Exception as exc:
            print(f"DNS-over-HTTPS resolver failed: {resolver}: {exc}")
    if not resolved_ips:
        raise RuntimeError(f"Unable to resolve {host} through public DNS-over-HTTPS; last error={last_error!r}")
    headers = ["-H", f"apikey: {SUPABASE_KEY}", "-H", f"Authorization: Bearer {SUPABASE_KEY}", "-H", "Accept: application/json"]
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        fallback_file = tmp.name
    try:
        for ip in resolved_ips:
            print(f"Trying Supabase HTTPS through {ip}.")
            cmd = ["curl", "--fail", "--silent", "--show-error", "--retry", "4", "--retry-all-errors", "--connect-timeout", "10", "--max-time", "30", "--resolve", f"{host}:443:{ip}", api, *headers, "-o", fallback_file]
            try:
                subprocess.run(cmd, check=True)
                with open(fallback_file, "r", encoding="utf-8") as fh:
                    rows = json.load(fh)
                print(f"Supabase request succeeded through {ip}.")
                break
            except (subprocess.CalledProcessError, OSError, json.JSONDecodeError) as exc:
                last_error = exc
                print(f"HTTPS through {ip} failed: {exc}")
    finally:
        try:
            os.unlink(fallback_file)
        except OSError:
            pass
if rows is None:
    raise RuntimeError(f"Unable to reach Supabase REST API; URL={api!r}; last error={last_error!r}")

rows = [row for row in rows if row.get("identity_code")]
eligible_rows = [row for row in rows if str(row.get("identity_status") or "").lower() == "verified"]
print(f"Loaded {len(rows)} W3M identities; {len(eligible_rows)} are eligible for public Passport SEO.")
# Only verified identities receive public static Passport pages and sitemap entries.
# Remove previously generated pages for identities that are no longer verified.
passport_root = pathlib.Path("passport")
if passport_root.exists():
    for row in rows:
        if str(row.get("identity_status") or "").lower() == "verified":
            continue
        ident_dir = passport_root / str(row["identity_code"])
        if ident_dir.exists():
            for child in ident_dir.iterdir():
                if child.is_file():
                    child.unlink()
            try:
                ident_dir.rmdir()
            except OSError:
                pass
rows = eligible_rows

def esc(value):
    return html.escape(str(value or ""), quote=True)

def ld(value):
    return (
        '<script type="application/ld+json">'
        + json.dumps(value, ensure_ascii=False)
        + "</script>"
    )

def display_name(raw_name, ident):
    value = str(raw_name or "").strip()
    if not value or value == ident or re.fullmatch(r"W3M-\d{4}-\d{6}", value):
        return "Web3 Project"
    return value

pathlib.Path("passport").mkdir(exist_ok=True)

for row in rows:
    ident = str(row["identity_code"])
    name = display_name(row.get("project_name"), ident)
    encoded = urllib.parse.quote(ident, safe="")
    page_url = f"{BASE}/passport/{encoded}/"
    full_url = f"{BASE}/ai-passport.html?identity={encoded}"
    status = str(row.get("identity_status") or "unverified").lower()
    first_seen = row.get("first_seen_at") or row.get("created_at") or "Not available"

    description = (
        f"Public W3M Passport record for {name}. "
        f"W3M Serial: {ident}. Review the project's public identity, status and AI Passport."
    )

    org = {
        "@type": "Organization",
        "@id": page_url + "#entity",
        "name": name,
        "url": page_url,
        "identifier": {
            "@type": "PropertyValue",
            "propertyID": "W3M Passport",
            "value": ident,
        },
        "description": f"Public W3M identity record for {name}, serial {ident}.",
        "memberOf": {
            "@type": "Organization",
            "name": "Web3Market",
            "url": BASE + "/",
        },
    }

    web = {
        "@type": "WebPage",
        "@id": page_url + "#webpage",
        "name": f"{name} — {ident} | W3M Passport",
        "description": description,
        "url": page_url,
        "identifier": ident,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Web3Market",
            "url": BASE + "/",
        },
        "about": {"@id": page_url + "#entity"},
        "mainEntity": {"@id": page_url + "#entity"},
    }

    breadcrumb = {
        "@type": "BreadcrumbList",
        "@id": page_url + "#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Web3Market", "item": BASE + "/"},
            {"@type": "ListItem", "position": 2, "name": "W3M Passport Directory", "item": BASE + "/passports.html"},
            {"@type": "ListItem", "position": 3, "name": f"{name} — {ident}", "item": page_url},
        ],
    }

    graph = {
        "@context": "https://schema.org",
        "@graph": [org, web, breadcrumb],
    }

    faq = {
        "@type": "FAQPage",
        "@id": page_url + "#faq",
        "mainEntity": [
            {
                "@type": "Question",
                "name": f"What is the W3M Passport for {name}?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": f"The W3M Passport is a public identity record for {name}, identified by {ident}.",
                },
            },
            {
                "@type": "Question",
                "name": f"What is {ident}?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": f"{ident} is the W3M Passport serial assigned to the public identity record for {name}.",
                },
            },
            {
                "@type": "Question",
                "name": "Where can I review the full W3M Passport?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": f"The full W3M AI Passport can be opened from the Web3Market Passport interface at {full_url}.",
                },
            },
        ],
    }

    body = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(name)} — {esc(ident)} | W3M Passport</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{esc(page_url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Web3Market">
<meta property="og:title" content="{esc(name)} — {esc(ident)} | W3M Passport">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(page_url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{esc(name)} — {esc(ident)} | W3M Passport">
<meta name="twitter:description" content="{esc(description)}">
<style>
:root{{color-scheme:light}}*{{box-sizing:border-box}}body{{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fb;color:#111827}}a{{color:inherit}}.top{{background:#0b1230;color:#fff;padding:18px 5%;display:flex;justify-content:space-between;align-items:center;gap:16px}}.brand{{font-weight:900;letter-spacing:-.5px}}.brand span{{color:#60a5fa}}.wrap{{width:min(980px,92%);margin:auto}}.hero{{padding:58px 0 34px;background:linear-gradient(135deg,#0b1230,#172554);color:#fff}}.eyebrow{{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd}}h1{{font-size:clamp(34px,6vw,58px);line-height:1.05;margin:12px 0}}.serial{{display:inline-block;padding:9px 13px;border:1px solid rgba(255,255,255,.22);border-radius:999px;font:800 13px ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,.08)}}.content{{padding:28px 0 70px;display:grid;grid-template-columns:1.4fr .8fr;gap:18px}}.card{{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:24px;box-shadow:0 8px 28px rgba(15,23,42,.05)}}.card h2{{margin:0 0 12px;font-size:20px}}.status{{display:inline-block;padding:6px 10px;border-radius:999px;background:#e8f7ef;color:#157347;font-size:11px;font-weight:900;text-transform:uppercase}}.facts{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:18px 0}}.facts div{{border:1px solid #e5e7eb;border-radius:12px;padding:13px;background:#fafbff}}.facts strong,.facts span{{display:block}}.facts strong{{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#667085}}.facts span{{margin-top:5px;font-weight:750;overflow-wrap:anywhere}}.research{{margin:12px 0 18px;padding-left:20px;line-height:1.9;color:#344054}}.faq{{border-top:1px solid #e5e7eb;padding:12px 0}}.faq h3{{font-size:15px;margin:0 0 5px}}.muted{{color:#667085;line-height:1.7}}.links{{display:grid;gap:10px;margin-top:18px}}.btn{{display:block;text-decoration:none;padding:12px 14px;border-radius:11px;background:#eef4ff;color:#1d4ed8;font-weight:850}}footer{{padding:28px 0;color:#667085;font-size:12px}}@media(max-width:720px){{.content{{grid-template-columns:1fr}}}}
</style>
{ld(graph)}
{ld(faq)}
</head>
<body>
<header class="top"><a class="brand" href="{BASE}/">Web3<span>Market</span></a><a href="{BASE}/passports.html">Passport Directory</a></header>
<section class="hero"><div class="wrap"><div class="eyebrow">Public W3M Project Passport</div><h1>{esc(name)}</h1><div class="serial">{esc(ident)}</div></div></section>
<main class="wrap content">
<section class="card">
<h2>W3M Passport Record</h2>
<p class="muted">This public page is the canonical Web3Market entry for the W3M identity serial shown above. It provides a stable, indexable reference to the project's public identity record and full AI Passport.</p>
<div class="facts">
<div><strong>W3M Serial</strong><span>{esc(ident)}</span></div>
<div><strong>Identity Status</strong><span>{esc(status)}</span></div>
<div><strong>First Seen</strong><span>{esc(first_seen)}</span></div>
<div><strong>Record Type</strong><span>Public Web3 identity</span></div>
</div>
<div class="links">
<a class="btn" href="{esc(full_url)}">Open Full AI Passport →</a>
<a class="btn" href="{BASE}/passports.html">Browse W3M Passport Directory →</a>
<a class="btn" href="{BASE}/marketplace.html">Explore Web3Market Marketplace →</a>
</div>
</section>
<aside class="card">
<h2>W3M Research Scope</h2>
<ul class="research">
<li>Identity and serial reference</li>
<li>Public project status</li>
<li>First-seen provenance</li>
<li>AI Passport research entry point</li>
<li>Web3Market marketplace context</li>
</ul>
<p class="muted">Only information available in the public W3M identity record is represented here. Additional project claims are not inferred when evidence is unavailable.</p>
</aside>
<section class="card">
<h2>Frequently Asked Questions</h2>
<div class="faq"><h3>What is the W3M Passport for {esc(name)}?</h3><p class="muted">It is a public W3M identity record identified by <strong>{esc(ident)}</strong>.</p></div>
<div class="faq"><h3>What is {esc(ident)}?</h3><p class="muted">It is the W3M Passport serial assigned to this public identity record.</p></div>
<div class="faq"><h3>Where can I review the full passport?</h3><p class="muted">Use the <a href="{esc(full_url)}">full AI Passport</a> for the available research details.</p></div>
</section>
</main>
<footer class="wrap">Web3Market · W3M Passport · Public project research</footer>
<script src="/js/brand.js?v=20261012" defer></script>
</body>
</html>
"""

    folder = pathlib.Path("passport") / ident
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.html").write_text(body, encoding="utf-8")

urls = [
    f"  <url><loc>{BASE}/</loc></url>",
    f"  <url><loc>{BASE}/marketplace.html</loc></url>",
    f"  <url><loc>{BASE}/passports.html</loc></url>",
    f"  <url><loc>{BASE}/ai-passport.html</loc></url>",
]

for row in rows:
    ident = urllib.parse.quote(str(row["identity_code"]), safe="")
    lastmod = str(row.get("created_at") or row.get("first_seen_at") or "")[:10]
    lm = f"<lastmod>{esc(lastmod)}</lastmod>" if lastmod else ""
    urls.append(f"  <url><loc>{BASE}/passport/{ident}/</loc>{lm}</url>")

# Keep a static directory registry in Git so the public Passport Directory
# remains usable even when Supabase is temporarily unreachable.
registry_rows = []
for row in rows:
    registry_rows.append({
        "identity_code": row.get("identity_code"),
        "sequence_no": row.get("sequence_no"),
        "project_name": display_name(row.get("project_name"), str(row.get("identity_code") or "")),
        "identity_status": row.get("identity_status"),
        "created_at": row.get("created_at"),
        "first_seen_at": row.get("first_seen_at"),
    })
pathlib.Path("passport/registry.json").write_text(
    json.dumps({"generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "rows": registry_rows}, ensure_ascii=False, indent=2) + "\\n",
    encoding="utf-8",
)

pathlib.Path("sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "\n".join(urls)
    + "\n</urlset>\n",
    encoding="utf-8",
)

print(f"Generated {len(rows)} Passport pages and sitemap entries.")
