/* Service worker του Mila.
 *
 * Στρατηγική:
 *  - Πλοήγηση (το index.html): network-first. Έτσι μια νέα έκδοση φαίνεται
 *    αμέσως μόλις ο χρήστης ξαναμπεί, χωρίς να κολλάει σε παλιό build.
 *  - /assets/*: cache-first. Το Vite βάζει hash στο όνομα, οπότε το
 *    περιεχόμενο δεν αλλάζει ποτέ για δεδομένο URL — ασφαλές να μείνει.
 *  - Οτιδήποτε άλλο (Supabase API, realtime, storage, fonts): δεν το αγγίζουμε.
 */

const VERSION = "mila-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // Πλοήγηση → network-first, με το cached shell ως δίχτυ για offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error())),
    );
    return;
  }

  // Hashed build assets → cache-first.
  if (sameOrigin && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
