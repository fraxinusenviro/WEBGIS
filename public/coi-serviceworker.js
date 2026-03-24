/* coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT
 * From https://github.com/gzzcl/coi-serviceworker
 * Enables SharedArrayBuffer on GitHub Pages by setting COOP/COEP headers via service worker.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function handleFetch(request) {
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return new Response();
  }

  const r = await fetch(request).catch((e) => e);
  if (r instanceof Error) throw r;

  const { body, status, statusText } = r;

  // Don't tamper with non-ok or empty responses
  if (status === 0) return r;

  const newHeaders = new Headers(r.headers);
  newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
  newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
  newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

  return new Response(body, { status, statusText, headers: newHeaders });
}

self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event.request));
});
