const CACHE_NAME = "web3market-pwa-v4";
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/assets/icons/web3market-192.svg", "/assets/icons/web3market-512.svg", "/css/brand.css", "/js/brand.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
  ).then(() => self.clients.claim()));
});

async function brandHtml(response) {
  if (!response || !response.ok) return response;
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;
  const html = await response.text();
  if (html.includes('id="wm-global-brand"') || html.includes("/js/brand.js")) {
    return new Response(html, {status: response.status, headers: response.headers});
  }
  const injection = '\n<script src="/js/brand.js?v=20261008" defer></script>\n';
  const branded = html.includes("</body>") ? html.replace("</body>", injection + "</body>") : html + injection;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(branded, {status: response.status, statusText: response.statusText, headers});
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(brandHtml).catch(() => caches.match("/index.html")));
    return;
  }

  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok && ["script", "style", "image", "font"].includes(event.request.destination)) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});