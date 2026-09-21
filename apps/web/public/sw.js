/* Service worker του Mila.
 *
 * Στρατηγική:
 *  - Πλοήγηση (το index.html): network-first. Έτσι μια νέα έκδοση φαίνεται
 *    αμέσως μόλις ο χρήστης ξαναμπεί, χωρίς να κολλάει σε παλιό build.
 *  - /assets/*: cache-first. Το Vite βάζει hash στο όνομα, οπότε το
 *    περιεχόμενο δεν αλλάζει ποτέ για δεδομένο URL — ασφαλές να μείνει.
 *  - Οτιδήποτε άλλο (Supabase API, realtime, storage, fonts): δεν το αγγίζουμε.
 *
 * Επίσης εδώ φτάνουν οι ειδοποιήσεις (push) όταν το app είναι κλειστό — δες το
 * κάτω μέρος του αρχείου.
 */

const VERSION = "mila-v2";
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

// ---------------------------------------------------------------------------
// Ειδοποιήσεις
// ---------------------------------------------------------------------------
// Το μήνυμα φτάνει κρυπτογραφημένο από την Edge Function «push» και ο browser
// το έχει ήδη αποκρυπτογραφήσει πριν φτάσει εδώ. Περιεχόμενο:
//   { conversationId, messageId, title, body, hasAttachment, isRequest }

// Ο service worker δεν έχει πρόσβαση στο i18n του app, οπότε τα λίγα κείμενά
// του είναι εδώ, με την ίδια λογική επιλογής γλώσσας.
const GREEK = (self.navigator.language || "").toLowerCase().startsWith("el");
const TEXT = GREEK
  ? { fallback: "Νέο μήνυμα", request: "Νέο αίτημα συνομιλίας", file: "Συνημμένο" }
  : { fallback: "New message", request: "New message request", file: "Attachment" };

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Το app είναι ανοιχτό και μπροστά: το μήνυμα φαίνεται ήδη στην οθόνη,
      // η ειδοποίηση θα ήταν θόρυβος.
      if (windows.some((w) => w.visibilityState === "visible" && w.focused)) return;

      const body =
        data.body ||
        (data.hasAttachment ? TEXT.file : data.isRequest ? TEXT.request : TEXT.fallback);
      await self.registration.showNotification(data.title || "Mila", {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        // Ίδιο tag ανά συνομιλία: δέκα μηνύματα από τον ίδιο άνθρωπο δεν
        // γίνονται δέκα ειδοποιήσεις, η καινούργια αντικαθιστά την παλιά.
        tag: data.conversationId || "mila",
        renotify: true,
        data: { conversationId: data.conversationId || null },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.conversationId;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Υπάρχει ήδη ανοιχτό παράθυρο: το φέρνουμε μπροστά και του λέμε ποια
      // συνομιλία να ανοίξει. Αλλιώς ανοίγουμε καινούργιο στο /?c=<id>.
      for (const w of windows) {
        if ("focus" in w) {
          await w.focus();
          if (id) w.postMessage({ type: "open-conversation", id });
          return;
        }
      }
      await self.clients.openWindow(id ? `/?c=${encodeURIComponent(id)}` : "/");
    })(),
  );
});
