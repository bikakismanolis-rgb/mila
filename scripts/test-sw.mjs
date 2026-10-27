// Έλεγχος του service worker (apps/web/public/sw.js), χωρίς browser.
//
//   node scripts/test-sw.mjs
//
// Τρέχει το αρχείο μέσα σε μια ψεύτικη «σφαίρα» service worker (ειδοποιήσεις,
// cache, παράθυρα, fetch) και ελέγχει:
//   1. Κάθε push δείχνει ειδοποίηση (αλλιώς το Safari ακυρώνει τη συνδρομή),
//      αθόρυβα και κλείνοντάς την αμέσως όταν το app είναι μπροστά.
//   2. «Σε καλεί» με κουμπιά· «αναπάντητη» και «τέλος» με το ίδιο tag, ώστε να
//      φεύγει το «σε καλεί». Τα ανοιχτά παράθυρα μαθαίνουν για την κλήση.
//   3. Πλοήγηση: οι στατικές σελίδες δεν αγγίζονται, και ως offline «κέλυφος»
//      φυλάγεται μόνο το ίδιο το app.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../apps/web/public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://mila.test";
const APP = '<!doctype html><html><body><div id="root"></div></body></html>';
// Τα αντικείμενα του worker είναι από άλλο «realm» (vm): για σύγκριση, απλό JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

function worker({ language = "el-GR", windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  let open = [];
  const store = new Map();
  const bucket = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const scope = {
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: {
      async showNotification(title, options = {}) {
        shown.push({ title, ...options });
        // Ίδιο tag = η νέα παίρνει τη θέση της παλιάς, όπως στον browser.
        open = open.filter((n) => !options.tag || n.tag !== options.tag);
        const notification = {
          title,
          ...options,
          close: () => (open = open.filter((n) => n !== notification)),
        };
        open.push(notification);
      },
      async getNotifications(filter = {}) {
        return open.filter((n) => !filter.tag || n.tag === filter.tag);
      },
    },
    clients: { matchAll: async () => windows, claim: async () => {}, openWindow: async () => {} },
    skipWaiting: () => {},
    location: { origin: ORIGIN },
    navigator: { language, userAgent: "test" },
    caches: {
      open: async (name) => ({
        put: async (key, response) => bucket(name).set(typeof key === "string" ? key : key.url, response),
        addAll: async () => {},
      }),
      match: async (key) => {
        for (const entries of store.values()) if (entries.has(key)) return entries.get(key);
        return undefined;
      },
      keys: async () => [...store.keys()],
      delete: async (name) => store.delete(name),
    },
    fetch: async () => {
      throw new TypeError("offline");
    },
    Response,
    URL,
    console,
  };
  scope.self = scope;
  vm.createContext(scope);
  vm.runInContext(source, scope);
  return { scope, listeners, shown, open: () => open, store };
}

const tab = (focused) => ({
  visibilityState: focused ? "visible" : "hidden",
  focused,
  messages: [],
  postMessage(message) {
    this.messages.push(message);
  },
});

async function push(w, data) {
  let pending = null;
  const before = w.shown.length;
  w.listeners.push({ data: { json: () => data }, waitUntil: (p) => (pending = p) });
  await pending;
  assert.ok(w.shown.length > before, `every push shows a notification (${JSON.stringify(data)})`);
}

const call = { type: "call", callId: "c1", conversationId: "k1", title: "Ann Archer", callerName: "Ann", video: false, isGroup: false };
const message = { conversationId: "k1", messageId: "m1", title: "Ann Archer", body: "", senderName: "Ann", isGroup: false };

// --- 1. Εισερχόμενη κλήση, app στο παρασκήνιο -------------------------------
{
  const window = tab(false);
  const w = worker({ windows: [window] });
  await push(w, { ...call, event: "ring" });
  const [ring] = w.open();
  assert.equal(ring.tag, "call:c1");
  assert.equal(ring.body, "Εισερχόμενη κλήση");
  assert.equal(ring.requireInteraction, true, "ring stays on screen");
  assert.deepEqual(plain(ring.actions.map((a) => a.action)), ["decline", "answer"]);
  assert.deepEqual(plain(window.messages), [{ type: "call-push", callId: "c1" }], "open windows re-check the call");

  // Σήκωσε από άλλη συσκευή: φεύγει, αθόρυβα.
  await push(w, { ...call, event: "ended" });
  assert.equal(w.open().length, 0, "end push removes the ring notification");
  assert.equal(w.shown.at(-1).silent, true, "end push is silent");
  assert.equal(w.shown.at(-1).requireInteraction, undefined);
  assert.equal(window.messages.length, 2);
}

// --- 2. Αναπάντητη: παίρνει τη θέση του «σε καλεί» ---------------------------
{
  const w = worker({ language: "en-US", windows: [] });
  await push(w, { ...call, event: "ring", video: true });
  await push(w, { ...call, event: "missed", video: true });
  assert.equal(w.open().length, 1);
  assert.equal(w.open()[0].body, "Missed video call");
  assert.equal(w.open()[0].tag, "call:c1");
  assert.ok(!w.open()[0].requireInteraction, "missed does not demand interaction");
}

// --- 3. Ομαδική: ποιος καλεί, μπροστά -----------------------------------------
{
  const w = worker();
  await push(w, { ...call, event: "ring", isGroup: true, title: "Ομάδα", callerName: "Ann" });
  assert.equal(w.open()[0].title, "Ομάδα");
  assert.equal(w.open()[0].body, "Ann: Εισερχόμενη κλήση");
}

// --- 4. App μπροστά: δείχνει και κλείνει αμέσως, αθόρυβα ----------------------
{
  const window = tab(true);
  const w = worker({ windows: [window, tab(false)] });
  await push(w, { ...call, event: "ring" });
  assert.equal(w.open().length, 0, "focused app: ring notification closed at once");
  assert.equal(w.shown.at(-1).silent, true);
  assert.equal(window.messages.length, 1, "the focused app still re-checks the call");

  await push(w, message);
  assert.equal(w.open().length, 0, "focused app: message notification closed at once");
  assert.equal(w.shown.at(-1).tag, "k1");
  assert.equal(w.shown.at(-1).silent, true);
  assert.equal(window.messages.length, 1, "messages do not ping the call code");
}

// --- 5. Μήνυμα με το app κλειστό ----------------------------------------------
{
  const w = worker();
  await push(w, message);
  await push(w, { ...message, messageId: "m2" });
  assert.equal(w.open().length, 1, "one notification per conversation");
  assert.equal(w.open()[0].body, "Νέο μήνυμα");
  assert.equal(w.open()[0].renotify, true);
  await push(w, { ...message, isGroup: true, title: "Ομάδα", hasAttachment: true });
  assert.equal(w.open()[0].body, "Ann: Συνημμένο");
  // Κατεστραμμένο push: πάλι κάτι φαίνεται.
  let pending = null;
  w.listeners.push({ data: { json: () => { throw new SyntaxError("bad"); } }, waitUntil: (p) => (pending = p) });
  await pending;
  assert.equal(w.shown.at(-1).title, "Mila");
}

// --- 6. Πλοήγηση --------------------------------------------------------------
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const page = (html, extra = {}) => ({
  ok: true,
  status: 200,
  redirected: false,
  type: "basic",
  headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
  text: async () => html,
  clone() {
    return this;
  },
  ...extra,
});

async function navigate(w, path, answer) {
  let responded = null;
  w.scope.fetch = async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  };
  w.listeners.fetch({
    request: { method: "GET", mode: "navigate", url: `${ORIGIN}${path}` },
    respondWith: (p) => (responded = p),
  });
  const response = responded && (await responded);
  await settle();
  return { intercepted: responded !== null, response };
}

{
  const w = worker();
  for (const path of ["/privacy", "/privacy/", "/terms", "/terms/", "/install/", "/qr", "/og.png", "/manifest.webmanifest"]) {
    const { intercepted } = await navigate(w, path, page("<html>static</html>"));
    assert.equal(intercepted, false, `static page ${path} is left alone`);
  }
  assert.equal(await w.scope.caches.match("/"), undefined, "static pages never become the shell");

  // Το ίδιο το app: φυλάγεται, μαζί με τα headers ασφαλείας του.
  const csp = "default-src 'self'";
  let result = await navigate(
    w,
    "/",
    page(APP, {
      headers: new Headers({ "content-type": "text/html; charset=utf-8", "content-security-policy": csp }),
    }),
  );
  assert.equal(result.intercepted, true);
  assert.ok(await w.scope.caches.match("/"), "the app is kept as the offline shell");
  assert.ok((await (await w.scope.caches.match("/")).text()).includes('id="root"'));
  assert.equal(
    (await w.scope.caches.match("/")).headers.get("content-security-policy"),
    csp,
    "the offline shell keeps the CSP",
  );

  // Ό,τι δεν είναι το app δεν παίρνει τη θέση του.
  const bad = [
    page(APP, { ok: false, status: 500 }),
    page(APP, { redirected: true }),
    page(APP, { type: "opaqueredirect" }),
    page("<html>Vercel error</html>"),
    page(APP, { headers: new Headers({ "content-type": "application/json" }) }),
  ];
  const kept = await w.scope.caches.match("/");
  for (const response of bad) {
    result = await navigate(w, "/c/123", response);
    assert.equal(result.response, response, "the network answer is shown as is");
    assert.equal(await w.scope.caches.match("/"), kept, "a bad answer does not replace the shell");
  }

  // Χωρίς δίκτυο: το app από την cache.
  result = await navigate(w, "/reset-password", new TypeError("offline"));
  assert.equal(result.response, kept, "offline: the cached app");
  const offlineStatic = await navigate(w, "/privacy", new TypeError("offline"));
  assert.equal(offlineStatic.intercepted, false, "offline static page is not replaced by the app");
}

// Χωρίς τίποτα στην cache και χωρίς δίκτυο: σφάλμα δικτύου, όχι κάποια άλλη σελίδα.
{
  const w = worker();
  const { response } = await navigate(w, "/", new TypeError("offline"));
  assert.equal(response.type, "error");
}

console.log("sw OK");
