// Group video call with three people (mesh), plus busy and glare checks.
import { chromium } from "playwright-core";
const BASE = process.env.E2E_BASE || "http://localhost:5173";
const API = process.env.E2E_API || "http://127.0.0.1:54321";
// Το δημόσιο «demo» anon key κάθε τοπικής Supabase (supabase start). Όχι της παραγωγής.
const ANON =
  process.env.E2E_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const CHROME = process.env.CHROME || undefined;
const SHOTS = process.env.SHOTS || "e2e-shots";
import { mkdirSync } from "node:fs";
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

// Contacts and a group, set up through the API (the chat UI is covered by run.mjs).
const A = await token("ann@test.local");
const B = await token("ben@test.local");
const C = await token("cat@test.local");
const ab = await rpc(A, "start_direct_conversation", { target_user: B.id });
await rpc(B, "respond_to_request", { conversation: ab, accept: true }).catch(() => null);
const ac = await rpc(A, "start_direct_conversation", { target_user: C.id });
await rpc(C, "respond_to_request", { conversation: ac, accept: true }).catch(() => null);
const group = await rpc(A, "create_group", { group_name: "Παρέα", member_ids: [B.id, C.id] });
console.log("group", group);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function user(email, name) {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    permissions: ["microphone", "camera"],
    locale: "el-GR",
  });
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
  return page;
}

const ann = await user("ann@test.local", "ann");
const ben = await user("ben@test.local", "ben");
const cat = await user("cat@test.local", "cat");

await ann.click('.chatlist > button:has-text("Παρέα")');
await ann.waitForSelector(".conversation-inner > header .header-call", { timeout: 10000 });
await ann.click('.header-call[aria-label="Βιντεοκλήση"]');
await ben.waitForSelector(".call-screen.incoming", { timeout: 15000 });
await cat.waitForSelector(".call-screen.incoming", { timeout: 15000 });
check("both members ring", true);
const incomingText = await ben.locator(".call-hero p").textContent();
check("incoming shows who calls in the group", incomingText?.includes("Ann Archer"), incomingText);

await ben.click(".call-btn.accept", { force: true });
await ann.waitForTimeout(1500);
await ann.screenshot({ path: `${SHOTS}/group-two.png` });
await cat.click(".call-btn.accept", { force: true });

async function peers(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".call-tile video")].map((v) => v.videoWidth),
  );
}
let ok = false;
for (let i = 0; i < 30 && !ok; i++) {
  await ann.waitForTimeout(1000);
  const [a, b, c] = await Promise.all([peers(ann), peers(ben), peers(cat)]);
  ok = [a, b, c].every((list) => list.length === 2 && list.every((w) => w > 0));
  if (ok || i === 29) {
    check("everyone sees two videos (mesh)", ok, JSON.stringify({ a, b, c }));
  }
}
await ann.screenshot({ path: `${SHOTS}/group-three.png` });

// Cat leaves: the call continues for Ann and Ben.
await cat.click(".call-btn.hangup");
await ann.waitForTimeout(3000);
const afterLeave = await peers(ann);
check("after one leaves, the other two stay connected", afterLeave.length === 1, JSON.stringify(afterLeave));

// Ben leaves: Ann is alone → call ends for her.
await ben.click(".call-btn.hangup");
await ann.waitForFunction(() => !document.querySelector(".call-controls .call-btn"), null, { timeout: 15000 }).catch(() => null);
check("the call ends when one is left", (await ann.locator(".call-controls .call-btn").count()) === 0);
await ann.waitForTimeout(3000);

// Busy: Ben and Cat talk; Ann calls Ben → busy.
await rpc(B, "start_direct_conversation", { target_user: C.id }).then((bc) =>
  rpc(C, "respond_to_request", { conversation: bc, accept: true }).catch(() => null),
);
await ben.reload();
await cat.reload();
await ben.waitForSelector(".chatlist > button", { timeout: 20000 });
await cat.waitForSelector(".chatlist > button", { timeout: 20000 });
await ben.click('.chatlist > button:has-text("Cat Cooper")');
await ben.click('.header-call[aria-label="Κλήση"]');
await cat.waitForSelector(".call-screen.incoming", { timeout: 15000 });
await cat.click(".call-btn.accept", { force: true });
await ben.waitForFunction(() => /\d:\d\d/.test(document.querySelector(".call-hero p")?.textContent || ""), null, { timeout: 20000 }).catch(() => null);
const voiceStatus = await ben.locator(".call-hero p").first().textContent();
check("voice call connects (timer runs)", /\d:\d\d/.test(voiceStatus || ""), voiceStatus);

await ann.click('.chatlist > button:has-text("Ben Baker")');
await ann.click('.header-call[aria-label="Κλήση"]');
await ann.waitForFunction(() => (document.querySelector(".call-hero p")?.textContent || "").includes("άλλη κλήση"), null, { timeout: 15000 }).catch(() => null);
const busyText = await ann.locator(".call-hero p").first().textContent().catch(() => "");
check("calling someone on a call says busy", busyText?.includes("άλλη κλήση"), busyText);
await ben.click(".call-btn.hangup");
await ann.waitForTimeout(3500);

// Glare: Ann and Ben call each other at the same moment → one call, connected.
await ben.click('.chatlist > button:has-text("Ann Archer")');
await Promise.all([
  ann.click('.header-call[aria-label="Κλήση"]'),
  ben.click('.header-call[aria-label="Κλήση"]'),
]);
let glare = false;
for (let i = 0; i < 20 && !glare; i++) {
  await ann.waitForTimeout(1000);
  const [x, y] = await Promise.all([
    ann.locator(".call-hero p").first().textContent().catch(() => ""),
    ben.locator(".call-hero p").first().textContent().catch(() => ""),
  ]);
  glare = /\d:\d\d/.test(x || "") && /\d:\d\d/.test(y || "");
  if (!glare && i === 19) check("simultaneous calls merge into one", false, `${x} / ${y}`);
}
if (glare) check("simultaneous calls merge into one", true);
await ann.click(".call-btn.hangup").catch(() => null);
await ann.waitForTimeout(1500);

console.log(failures ? `\n${failures} FAILED` : "\nALL GROUP CHECKS PASSED");
await browser.close();
process.exit(failures ? 1 : 0);
