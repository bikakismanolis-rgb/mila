// End-to-end: two users, chat, voice message, video call, call log.
import { chromium } from "playwright-core";

import fs from "node:fs";
const BASE = process.env.E2E_BASE || "http://localhost:5173";
const API = process.env.E2E_API || "http://127.0.0.1:54321";
// Το δημόσιο «demo» anon key κάθε τοπικής Supabase (supabase start). Όχι της παραγωγής.
const ANON =
  process.env.E2E_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const CHROME = process.env.CHROME || undefined;
const SHOTS = process.env.SHOTS || "e2e-shots";

fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

async function user(email, name, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({
    viewport,
    permissions: ["microphone", "camera", "notifications"],
    locale: "el-GR",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      console.log(`[${name} ${m.type()}]`, m.text().slice(0, 300));
  });
  await page.goto(`${BASE}/?login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "secret123");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".shell", { timeout: 20000 });
  log(name, "signed in");
  return { context, page, name };
}

const ann = await user("ann@test.local", "ann");
const ben = await user("ben@test.local", "ben");

// --- Ann finds Ben and writes ----------------------------------------------
await ann.page.click('nav button[aria-label="Βρες άτομα"]');
await ann.page.fill(".search input", "ben@test.local");
await ann.page.waitForSelector(".people > button", { timeout: 10000 });
await ann.page.click(".people > button");
await ann.page.waitForSelector(".conversation-inner textarea", { timeout: 10000 });
await ann.page.fill(".conversation-inner textarea", "Γεια σου Ben! Τι κάνεις;");
await ann.page.keyboard.press("Enter");
await ann.page.waitForSelector(".bubble.own p", { timeout: 10000 });
check("ann sent first message", true);

// Calls are not offered before the request is accepted.
check(
  "no call buttons before request is accepted",
  (await ann.page.locator(".header-call").count()) === 0,
);

// --- Ben accepts ------------------------------------------------------------
await ben.page.waitForSelector(".chatlist > button", { timeout: 15000 });
await ben.page.click(".chatlist > button");
await ben.page.waitForSelector(".request button:not(.secondary)", { timeout: 10000 });
await ben.page.click(".request button:not(.secondary)");
await ben.page.waitForSelector(".bubble p", { timeout: 10000 });
const firstText = await ben.page.locator(".bubble p").first().textContent();
check("ben decrypts ann's message", firstText?.includes("Γεια σου Ben"), firstText);
await ben.page.fill(".conversation-inner textarea", "Καλά! Εσύ; https://example.com");
await ben.page.keyboard.press("Enter");
await ann.page.waitForFunction(
  () => [...document.querySelectorAll(".bubble:not(.own) p")].some((p) => p.textContent?.includes("Καλά")),
  null,
  { timeout: 15000 },
);
check("ann receives ben's reply live", true);
check(
  "links become clickable",
  (await ann.page.locator('.bubble:not(.own) p a[href="https://example.com"]').count()) === 1,
);

// Delivered / read ticks on Ann's message (ben has the chat open → read).
await ann.page.waitForSelector(".bubble.own small svg.read", { timeout: 15000 }).catch(() => null);
check("ann sees blue ticks (read)", (await ann.page.locator(".bubble.own small svg.read").count()) > 0);

// --- Presence -----------------------------------------------------------------
await ann.page.waitForTimeout(500);
await ann.page.reload();
await ann.page.waitForSelector(".chatlist > button", { timeout: 15000 });
await ann.page.click(".chatlist > button");
await ann.page.waitForSelector(".conversation-inner > header small", { timeout: 10000 });
const sub = await ann.page.locator(".conversation-inner > header small").textContent();
check("ann sees ben online", sub?.includes("σε σύνδεση"), sub);

// --- Edit -----------------------------------------------------------------
await ann.page.locator(".bubble.own").first().click();
await ann.page.click('.msg-menu button:has-text("Επεξεργασία")');
await ann.page.fill(".conversation-inner textarea", "Γεια σου Ben! Τι κάνεις; (διόρθωση)");
await ann.page.keyboard.press("Enter");
await ben.page.waitForFunction(
  () => [...document.querySelectorAll(".bubble p")].some((p) => p.textContent?.includes("(διόρθωση)")),
  null,
  { timeout: 15000 },
);
check("ben sees the edited text", true);
check("edited label shows", (await ben.page.locator(".bubble .edited").count()) > 0);

// --- Voice message (fake mic) ------------------------------------------------
const mic = ann.page.locator(".send.mic");
await mic.waitFor({ timeout: 5000 });
const box = await mic.boundingBox();
await ann.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await ann.page.mouse.down();
await ann.page.waitForTimeout(2600);
await ann.page.mouse.up();
await ben.page.waitForSelector(".voice-player", { timeout: 20000 });
check("ben receives a voice message", true);
await ben.page.screenshot({ path: `${SHOTS}/ben-voice.png` });
await ben.page.click(".voice-player .voice-play");
await ben.page.waitForSelector(".voice-speed", { timeout: 10000 }).catch(() => null);
const playing = await ben.page.evaluate(
  () => [...document.querySelectorAll("audio")].length >= 0,
);
check("voice message starts playing", (await ben.page.locator(".voice-speed").count()) === 1, String(playing));

// --- Video call: Ann calls Ben --------------------------------------------
await ann.page.click('.header-call[aria-label="Βιντεοκλήση"]');
await ann.page.waitForSelector(".call-screen", { timeout: 10000 });
await ben.page.waitForSelector(".call-screen.incoming", { timeout: 15000 });
check("ben sees the incoming video call", true);
await ben.page.screenshot({ path: `${SHOTS}/ben-incoming.png` });
await ann.page.screenshot({ path: `${SHOTS}/ann-ringing.png` });
await ben.page.click(".call-btn.accept", { force: true });
await ann.page.waitForFunction(
  () => /\d+:\d\d/.test(document.querySelector(".call-overlay-title p, .call-hero p")?.textContent || ""),
  null,
  { timeout: 30000 },
).catch(() => null);
await ann.page.waitForTimeout(2500);
const annVideo = await ann.page.evaluate(() => {
  const v = document.querySelector(".call-remote video");
  return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null;
});
const benVideo = await ben.page.evaluate(() => {
  const v = document.querySelector(".call-remote video");
  return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null;
});
check("ann receives ben's video", Boolean(annVideo && annVideo.w > 0), JSON.stringify(annVideo));
check("ben receives ann's video", Boolean(benVideo && benVideo.w > 0), JSON.stringify(benVideo));
const audioFlow = await ann.page.evaluate(
  () =>
    [...document.querySelectorAll("audio")].some(
      (a) => a.srcObject && a.srcObject.getAudioTracks().length > 0 && !a.paused,
    ),
);
check("ann plays ben's audio", audioFlow);
await ann.page.screenshot({ path: `${SHOTS}/ann-in-call.png` });
await ben.page.screenshot({ path: `${SHOTS}/ben-in-call.png` });

// Ben turns his camera off → Ann sees the avatar instead.
await ben.page.click('.call-controls button[aria-label="Κλείσιμο κάμερας"]');
await ann.page.waitForFunction(() => !document.querySelector(".call-remote video"), null, {
  timeout: 15000,
}).catch(() => null);
check("camera off shows avatar on the other side", (await ann.page.locator(".call-remote video").count()) === 0);
await ann.page.screenshot({ path: `${SHOTS}/ann-camera-off.png` });

// Minimise and return.
await ann.page.click('.call-top button[aria-label="Πίσω στις συνομιλίες"]');
await ann.page.waitForSelector(".call-mini", { timeout: 5000 });
check("call minimises to a bar", true);
await ann.page.screenshot({ path: `${SHOTS}/ann-minimised.png` });
await ann.page.click(".call-mini-open");

// Hang up.
await ann.page.click(".call-btn.hangup");
await ben.page.waitForFunction(() => !document.querySelector(".call-screen") || document.querySelector(".call-close"), null, { timeout: 15000 });
await ben.page.waitForTimeout(3500);
check("call ends on ben's side", (await ben.page.locator(".call-screen").count()) === 0);
await ann.page.waitForSelector(".call-entry", { timeout: 15000 }).catch(() => null);
const entry = await ann.page.locator(".call-entry").first().textContent().catch(() => "");
check("call appears in the chat", Boolean(entry), entry);
await ann.page.screenshot({ path: `${SHOTS}/ann-after-call.png` });

// --- Missed call: Ben calls, Ann declines ------------------------------------
await ben.page.click('.header-call[aria-label="Κλήση"]');
await ann.page.waitForSelector(".call-screen.incoming", { timeout: 15000 });
await ann.page.click(".call-answer .call-btn.hangup");
await ben.page.waitForFunction(
  () => (document.querySelector(".call-hero p")?.textContent || "").includes("Απορρίφθηκε"),
  null,
  { timeout: 15000 },
).catch(() => null);
const declinedText = await ben.page.locator(".call-hero p").first().textContent().catch(() => "");
check("ben sees 'declined'", declinedText?.includes("Απορρίφθηκε"), declinedText);
await ben.page.waitForTimeout(3000);

// Calls tab
await ann.page.click('nav button[aria-label="Κλήσεις"]');
await ann.page.waitForSelector(".call-row", { timeout: 10000 });
check("calls tab lists calls", (await ann.page.locator(".call-row").count()) >= 2);
await ann.page.screenshot({ path: `${SHOTS}/ann-calls-tab.png` });

// Mobile layout screenshot of a chat
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "el-GR", permissions: ["microphone", "camera"] });
const mp = await mobile.newPage();
await mp.goto(`${BASE}/?login`);
await mp.fill('input[type="email"]', "ben@test.local");
await mp.fill('input[type="password"]', "secret123");
await mp.click('button[type="submit"]');
await mp.waitForSelector(".chatlist > button", { timeout: 20000 });
await mp.screenshot({ path: `${SHOTS}/mobile-list.png` });
await mp.click(".chatlist > button");
await mp.waitForSelector(".bubble", { timeout: 10000 });
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${SHOTS}/mobile-chat.png` });

console.log(failures ? `\n${failures} FAILED` : "\nALL E2E CHECKS PASSED");
await browser.close();
process.exit(failures ? 1 : 0);
