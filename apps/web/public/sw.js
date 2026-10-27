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

const VERSION = "mila-v4";
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
//   { conversationId, messageId, title, body, senderName, isGroup,
//     hasAttachment, isRequest }
// Το body είναι πάντα κενό: ο server δεν ξέρει τι γράφει το μήνυμα (είναι
// κρυπτογραφημένο από άκρη σε άκρη), άρα η ειδοποίηση λέει μόνο «Νέο μήνυμα».

// Ο service worker δεν έχει πρόσβαση στο i18n του app, οπότε τα λίγα κείμενά
// του είναι εδώ, με την ίδια λογική επιλογής γλώσσας.
const GREEK = (self.navigator.language || "").toLowerCase().startsWith("el");
const TEXT = GREEK
  ? {
      fallback: "Νέο μήνυμα",
      request: "Νέο αίτημα συνομιλίας",
      file: "Συνημμένο",
      voiceCall: "Εισερχόμενη κλήση",
      videoCall: "Εισερχόμενη βιντεοκλήση",
      missedVoice: "Αναπάντητη κλήση",
      missedVideo: "Αναπάντητη βιντεοκλήση",
      answer: "Απάντηση",
      decline: "Απόρριψη",
      report: "Νέα αναφορά",
    }
  : {
      fallback: "New message",
      request: "New message request",
      file: "Attachment",
      voiceCall: "Incoming call",
      videoCall: "Incoming video call",
      missedVoice: "Missed call",
      missedVideo: "Missed video call",
      answer: "Answer",
      decline: "Decline",
      report: "New report",
    };

/** Εισερχόμενη / αναπάντητη κλήση. Ίδιο tag ανά κλήση, ώστε το «αναπάντητη»
 *  να αντικαθιστά το «σε καλεί» στην οθόνη. */
async function showCall(data) {
  const ring = data.event === "ring";
  const text = ring
    ? data.video ? TEXT.videoCall : TEXT.voiceCall
    : data.video ? TEXT.missedVideo : TEXT.missedVoice;
  const body = data.isGroup && data.callerName ? `${data.callerName}: ${text}` : text;
  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `call:${data.callId}`,
    renotify: true,
    data: {
      kind: "call",
      callId: data.callId,
      conversationId: data.conversationId || null,
      ring,
    },
  };
  if (ring) {
    // Μένει στην οθόνη μέχρι να την πατήσεις, και δονείται σαν τηλέφωνο.
    options.requireInteraction = true;
    options.vibrate = [600, 300, 600, 300, 600, 300, 600, 300, 600];
    options.actions = [
      { action: "decline", title: TEXT.decline },
      { action: "answer", title: TEXT.answer },
    ];
  }
  await self.registration.showNotification(data.title || "Mila", options);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  event.waitUntil(
    (async () => {
      // { type: "report" }: νέα αναφορά, μόνο στους συντονιστές (0014). Δεν
      // λέει ποιος ή τι: οι λεπτομέρειες είναι στον SQL editor (δες
      // docs/MODERATION.md). Φαίνεται και με ανοιχτό το app, αφού μέσα στο app
      // δεν υπάρχει άλλη ένδειξη.
      if (data.type === "report") {
        await self.registration.showNotification("Mila", {
          body: TEXT.report,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: "mila-report",
          renotify: true,
          data: { kind: "report" },
        });
        return;
      }

      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Το app είναι ανοιχτό και μπροστά: το μήνυμα (ή η κλήση) φαίνεται ήδη
      // στην οθόνη, η ειδοποίηση θα ήταν θόρυβος.
      if (windows.some((w) => w.visibilityState === "visible" && w.focused)) return;

      if (data.type === "call" && data.callId) {
        await showCall(data);
        return;
      }

      const text =
        data.body ||
        (data.isRequest ? TEXT.request : data.hasAttachment ? TEXT.file : TEXT.fallback);
      // Σε ομάδα ο τίτλος είναι το όνομα της ομάδας· το ποιος έγραψε μπαίνει μπροστά.
      const body = data.isGroup && data.senderName ? `${data.senderName}: ${text}` : text;
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
  const info = event.notification.data || {};

  // Κλήση: «Απάντηση» ανοίγει το app και σηκώνει. «Απόρριψη» λέει σε ένα
  // ανοιχτό παράθυρο να την απορρίψει, αλλιώς ανοίγει το app για να το κάνει
  // (ο service worker δεν έχει τη σύνδεση του χρήστη για να το κάνει μόνος).
  if (info.kind === "call" && info.callId) {
    const action =
      event.action === "decline" || event.action === "answer" ? event.action : "show";
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const w of windows) {
          if ("focus" in w) {
            if (action !== "decline") await w.focus();
            w.postMessage({ type: "call-action", action, callId: info.callId, conversationId: info.conversationId });
            return;
          }
        }
        await self.clients.openWindow(
          `/?call=${encodeURIComponent(info.callId)}&action=${action}`,
        );
      })(),
    );
    return;
  }

  const id = info.conversationId;

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
