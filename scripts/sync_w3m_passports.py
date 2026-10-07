import html
import json
import os
import pathlib
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

with urllib.request.urlopen(req, timeout=30) as response:
    if response.status != 200:
        raise RuntimeError(f"Supabase returned HTTP {response.status}")
    rows = json.load(response)

rows = [row for row in rows if row.get("identity_code")]
print(f"Loaded {len(rows)} W3M identities.")

def esc(value):
    return html.escape(str(value or ""), quote=True)

def ld(value):
    return (
        '<script type="application/ld+json">'
        + json.dumps(value, ensure_ascii=False)
        + "</script>"
    )

pathlib.Path("passport").mkdir(exist_ok=True)

for row in rows:
    ident = str(row["identity_code"])
    name = row.get("project_name") or "Web3 Project"
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
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": name,
        "url": page_url,
        "identifier": {
            "@type": "PropertyValue",
            "propertyID": "W3M Passport",
            "value": ident,
        },
    }

    web = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": f"{name} — {ident} | W3M Passport",
        "description": description,
        "url": page_url,
        "identifier": ident,
        "isPartOf": {
            "@type": "WebSite",
            "name": "Web3Market",
            "url": BASE + "/",
        },
        "about": [
            {"@type": "Thing", "name": "Web3 project"},
            {"@type": "Thing", "name": "Web3 due diligence"},
            {"@type": "Thing", "name": "AI project research"},
        ],
    }

    breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "Web3Market",
                "item": BASE + "/",
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": "W3M Passport Directory",
                "item": BASE + "/passports.html",
            },
            {
                "@type": "ListItem",
                "position": 3,
                "name": f"{name} — {ident}",
                "item": page_url,
            },
        ],
    }

    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
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
                    "text": f"The full W3M AI Passport can be opened from {page_url} through the Web3Market Passport interface.",
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
<meta name="keywords" content="{esc(name)}, {esc(ident)}, W3M Passport, Web3 project, Web3 due diligence, AI project research, blockchain project research">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{esc(page_url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(name)} — {esc(ident)} | W3M Passport">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(page_url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(name)} — {esc(ident)} | W3M Passport">
<meta name="twitter:description" content="{esc(description)}">
{ld(org)}
{ld(web)}
{ld(breadcrumb)}
{ld(faq)}
</head>
<body>
<main>
<p>Web3Market W3M Project Passport</p>
<h1>{esc(name)}</h1>
<p><strong>{esc(ident)}</strong></p>
<p>Passport status: {esc(status)}</p>
<p>First seen: {esc(first_seen)}</p>
<p>Public W3M identity record for Web3 project research and due diligence.</p>
<p><a href="{esc(full_url)}">View Full AI Passport</a></p>
<p><a href="{BASE}/passports.html">W3M Passport Directory</a></p>
<p><a href="{BASE}/marketplace.html">Explore Web3Market Marketplace</a></p>
</main>
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

pathlib.Path("sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "\n".join(urls)
    + "\n</urlset>\n",
    encoding="utf-8",
)

print(f"Generated {len(rows)} Passport pages and sitemap entries.")
