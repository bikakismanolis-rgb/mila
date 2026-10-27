// End-to-end: κλήσεις που ΔΕΝ πάνε καλά.
//   1. Ο καλούμενος πατάει «Απάντηση» αλλά το μικρόφωνο δεν ανοίγει (δεν
//      έδωσε άδεια): ο καλών το βλέπει αμέσως, όχι μετά από 45'' «Δεν απάντησε».
//   2. Το Realtime του καλούμενου έχασε την κλήση: μόλις το app ξαναβρεί δίκτυο
//      ή έρθει μπροστά, ξανακοιτάζει και χτυπάει.
//   3. Σήκωσαν, αλλά η σύνδεση δεν στήθηκε ποτέ: στο ιστορικό «Δεν συνδέθηκε»,
//      όχι κλήση 40 δευτερολέπτων.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const API = process.env.E2E_API || "http://127.0.0.1:54321";
// Το δημόσιο «demo» anon key κάθε τοπικής Supabase (supabase start). Όχι της παραγωγής.
const ANON =
  process.env.E2E_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const CHROME = process.env.CHROME || undefined;
const SHOTS = process.env.SHOTS || "e2e-shots";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && extra ? " — " + extra : ""}`);
  if (!ok) failures++;
};

async function token(email) {
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "secret123" }),
  });
  const j = await r.json();
  return { token: j.access_token, id: j.user.id };
}
async function rpc(who, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${who.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const A = await token("ann@test.local");
const B = await token("ben@test.local");
const ab = await rpc(A, "start_direct_conversation", { target_user: B.id });
await rpc(B, "respond_to_request", { conversation: ab, accept: true }).catch(() => null);
const lastCall = async () => (await rpc(A, "list_calls", { p_conversation: ab, p_limit: 1 }))[0];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function user(email, name, setup) {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    permissions: ["microphone", "camera"],
    locale: "el-GR",
  });
  if (setup) await setup(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/empty string/.test(m.text()))
      console.log(`[${name} ${m.type()}]`, m.text().slice(0, 200));
  });
  await page.goto(`${BASE}/?login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "secret123");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".chatlist > button", { timeout: 20000 });
  return { context, page };
}

// Ο Ben: με διακόπτες για «δεν δίνω άδεια για το μικρόφωνο», «το Realtime δεν
// φέρνει κλήσεις» και «δεν υπάρχει δίκτυο για τη σύνδεση της κλήσης».
let dropCallEvents = false;
const ben = await user("ben@test.local", "ben", async (context) => {
  await context.addInitScript(() => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = (constraints) =>
      window.__denyMedia
        ? Promise.reject(new DOMException("Permission denied", "NotAllowedError"))
        : original(constraints);
    // Μόνο μέσω TURN, και TURN δεν υπάρχει: η σύνδεση δεν στήνεται ποτέ.
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = function (config = {}) {
      return new Peer(window.__noRoute ? { ...config, iceTransportPolicy: "relay" } : config);
    };
    window.RTCPeerConnection.prototype = Peer.prototype;
  });
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (
        dropCallEvents &&
        typeof message === "string" &&
        message.includes("postgres_changes") &&
        /"table":"(calls|call_participants)"/.test(message)
      )
        return;
      ws.send(message);
    });
  });
});
const ann = await user("ann@test.local", "ann");
const annStatus = () => ann.page.locator(".call-hero p").first().textContent().catch(() => "");

async function openChat(page) {
  await page.click(".chatlist > button");
  await page.waitForSelector('.header-call[aria-label="Κλήση"]', { timeout: 10000 });
}
await openChat(ann.page);

// --- 1. Δεν δόθηκε άδεια για το μικρόφωνο -------------------------------------
await ben.page.evaluate(() => (window.__denyMedia = true));
await ann.page.click('.header-call[aria-label="Κλήση"]');
await ben.page.waitForSelector(".call-screen.incoming", { timeout: 15000 });
const answeredAt = Date.now();
await ben.page.click(".call-btn.accept", { force: true });
await ann.page
  .waitForFunction(
    () => (document.querySelector(".call-hero p")?.textContent || "").includes("Απορρίφθηκε"),
    null,
    { timeout: 15000 },
  )
  .catch(() => null);
const seconds = (Date.now() - answeredAt) / 1000;
const text1 = await annStatus();
check("caller sees the call end at once, not after 45s", text1?.includes("Απορρίφθηκε") && seconds < 10, `${text1} after ${seconds}s`);
await ben.page.waitForSelector(".call-notice", { timeout: 5000 }).catch(() => null);
const notice = await ben.page.locator(".call-notice").textContent().catch(() => "");
check("callee is told why, and what to do", /απαντήσεις/.test(notice || "") && /άδεια/.test(notice || ""), notice);
await ben.page.screenshot({ path: `${SHOTS}/ben-mic-denied.png` });
const c1 = await lastCall();
const benState = c1?.participants.find((p) => p.userId === B.id)?.state;
check("the call is recorded as declined", c1?.status === "ended" && c1?.endReason === "declined" && benState === "declined", JSON.stringify(c1));
await ann.page.waitForFunction(() => !document.querySelector(".call-screen"), null, { timeout: 10000 }).catch(() => null);
await ben.page.click(".call-close").catch(() => null);
await ben.page.evaluate(() => (window.__denyMedia = false));

// --- 2. Το Realtime έχασε την κλήση -------------------------------------------
dropCallEvents = true;
await ann.page.click('.header-call[aria-label="Κλήση"]');
await ann.page.waitForFunction(() => (document.querySelector(".call-hero p")?.textContent || "").includes("Χτυπάει"), null, { timeout: 15000 }).catch(() => null);
await ben.page.waitForTimeout(3000);
check("(setup) with the event lost, nothing rings", (await ben.page.locator(".call-screen.incoming").count()) === 0);
// Ξαναβρήκε δίκτυο (ή ήρθε μπροστά): ξανακοιτάζει.
await ben.page.evaluate(() => window.dispatchEvent(new Event("online")));
const rang = await ben.page.waitForSelector(".call-screen.incoming", { timeout: 8000 }).then(() => true, () => false);
check("back online, the missed call rings", rang);
await ben.page.click(".call-answer .call-btn.hangup").catch(() => null);
await ann.page.waitForFunction(() => (document.querySelector(".call-hero p")?.textContent || "").includes("Απορρίφθηκε"), null, { timeout: 15000 }).catch(() => null);
check("and can be declined as usual", (await annStatus())?.includes("Απορρίφθηκε"));
dropCallEvents = false;
await ann.page.waitForFunction(() => !document.querySelector(".call-screen"), null, { timeout: 10000 }).catch(() => null);

// Το ίδιο, όταν το app έρχεται μπροστά (focus).
dropCallEvents = true;
await ann.page.click('.header-call[aria-label="Κλήση"]');
await ben.page.waitForTimeout(3000);
check("(setup) lost again, nothing rings", (await ben.page.locator(".call-screen.incoming").count()) === 0);
await ben.page.evaluate(() => window.dispatchEvent(new Event("focus")));
check("back in front, the missed call rings", await ben.page.waitForSelector(".call-screen.incoming", { timeout: 8000 }).then(() => true, () => false));
await ann.page.click(".call-btn.hangup");
const stopped = await ben.page.waitForFunction(() => !document.querySelector(".call-screen.incoming"), null, { timeout: 15000 }).then(() => true, () => false);
dropCallEvents = false;
// Το «έκλεισε» χάθηκε κι αυτό· το βρίσκει ο επόμενος έλεγχος.
if (!stopped) await ben.page.evaluate(() => window.dispatchEvent(new Event("online")));
check("stops ringing when the caller hangs up", stopped || await ben.page.waitForFunction(() => !document.querySelector(".call-screen.incoming"), null, { timeout: 8000 }).then(() => true, () => false));
await ann.page.waitForFunction(() => !document.querySelector(".call-screen"), null, { timeout: 10000 }).catch(() => null);

// --- 3. Σήκωσαν, αλλά η σύνδεση δεν στήθηκε ------------------------------------
await ben.page.evaluate(() => (window.__noRoute = true));
await ann.page.click('.header-call[aria-label="Κλήση"]');
await ben.page.waitForSelector(".call-screen.incoming", { timeout: 15000 });
await ben.page.click(".call-btn.accept", { force: true });
await ann.page
  .waitForFunction(() => (document.querySelector(".call-hero p")?.textContent || "").includes("Δεν συνδέθηκε"), null, { timeout: 60000 })
  .catch(() => null);
check("caller sees 'couldn't connect'", (await annStatus())?.includes("Δεν συνδέθηκε"), await annStatus());
await ben.page.waitForTimeout(3000);
const c3 = await lastCall();
check("the call is recorded as failed", c3?.status === "ended" && c3?.endReason === "failed", JSON.stringify(c3));
await ann.page.waitForFunction(() => !document.querySelector(".call-screen"), null, { timeout: 15000 }).catch(() => null);
await ann.page.waitForSelector(".call-entry", { timeout: 10000 }).catch(() => null);
const entries = await ann.page.locator(".call-entry").allTextContents();
// Μόνο η ώρα της κλήσης (π.χ. 14:02), καμία διάρκεια (π.χ. 0:40).
const last = entries.at(-1) || "";
check("the chat shows it as not connected, with no duration", last.includes("Δεν συνδέθηκε") && (last.match(/\d+:\d\d/g) || []).length === 1, JSON.stringify(entries));
await ann.page.screenshot({ path: `${SHOTS}/ann-call-failed.png` });

console.log(failures ? `\n${failures} FAILED` : "\nALL CALL-FAILURE CHECKS PASSED");
await browser.close();
process.exit(failures ? 1 : 0);
