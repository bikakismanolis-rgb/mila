// Photos with caption, viewer, video thumbnail, forward, mute/pin/archive, delivered ticks,
// the notification card, video compression, and sending while offline (outbox).
import { chromium } from "playwright-core";
import zlib from "node:zlib";
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

function png(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = 160;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
const C = await token("cat@test.local");
for (const [x, y] of [[A, B], [A, C]]) {
  const id = await rpc(x, "start_direct_conversation", { target_user: y.id });
  await rpc(y, "respond_to_request", { conversation: id, accept: true }).catch(() => null);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    // Η συμπίεση βίντεο παίζει το βίντεο με ήχο· στην εφαρμογή ξεκινάει από πάτημα.
    "--autoplay-policy=no-user-gesture-required",
  ],
});
async function user(email, name) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    permissions: ["microphone", "camera", "clipboard-read", "clipboard-write"],
    locale: "el-GR",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/empty string|404/.test(m.text()))
      console.log(`[${name} error]`, m.text().slice(0, 200));
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

// --- Photo with caption ---------------------------------------------------
await ann.click('.chatlist > button:has-text("Ben Baker")');
await ann.waitForSelector(".conversation-inner textarea");
await ann.click('.attach-menu button[aria-label="Στείλε φωτογραφία ή αρχείο"]');
const [chooser] = await Promise.all([
  ann.waitForEvent("filechooser"),
  ann.click('.menu-popover.up button:has-text("Φωτογραφίες")'),
]);
await chooser.setFiles({ name: "beach.png", mimeType: "image/png", buffer: png(1600, 1200) });
await ann.waitForSelector(".send-preview-media img", { timeout: 10000 });
await ann.fill(".send-caption input", "Δες θάλασσα!");
await ann.screenshot({ path: `${SHOTS}/media-preview.png` });
await ann.click(".send-caption .send");
await ben.click('.chatlist > button:has-text("Ann Archer")');
await ben.waitForSelector(".bubble.media img.message-image", { timeout: 20000 });
const caption = await ben.locator(".bubble.media p").first().textContent();
check("photo arrives with its caption", caption?.includes("θάλασσα"), caption);
await ben.waitForTimeout(800);
await ben.screenshot({ path: `${SHOTS}/media-bubble.png` });

// Viewer
await ben.click(".bubble.media .media-open");
await ben.waitForSelector(".viewer img", { timeout: 10000 });
check("photo opens full screen", true);
await ben.screenshot({ path: `${SHOTS}/media-viewer.png` });
await ben.keyboard.press("Escape");

// --- Video with thumbnail (made in the browser) ------------------------------
const videoB64 = await ann.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(15);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start(100);
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = `hsl(${i * 18},80%,50%)`;
    ctx.fillRect(0, 0, 320, 240);
    await new Promise((r) => setTimeout(r, 60));
  }
  rec.stop();
  await new Promise((r) => (rec.onstop = r));
  const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
});
await ann.click('.attach-menu button[aria-label="Στείλε φωτογραφία ή αρχείο"]');
const [chooser2] = await Promise.all([
  ann.waitForEvent("filechooser"),
  ann.click('.menu-popover.up button:has-text("Φωτογραφίες")'),
]);
await chooser2.setFiles({ name: "clip.webm", mimeType: "video/webm", buffer: Buffer.from(videoB64, "base64") });
await ann.waitForSelector(".send-caption .send:not([disabled])", { timeout: 15000 });
await ann.click(".send-caption .send");
await ben.waitForSelector(".media-open.video", { timeout: 20000 });
check("video arrives", true);
check("video has a thumbnail", (await ben.locator(".media-open.video img").count()) === 1);
await ben.click(".media-open.video");
await ben.waitForSelector(".viewer video", { timeout: 10000 });
const playable = await ben.waitForFunction(
  () => {
    const v = document.querySelector(".viewer video");
    return v && v.readyState >= 2;
  },
  null,
  { timeout: 10000 },
).then(() => true).catch(() => false);
check("video plays in the viewer", playable);
await ben.keyboard.press("Escape");

// --- Video compression (canvas + MediaRecorder), straight from the module -----
const squeezed = await ann.evaluate(async (b64) => {
  const media = await import("/src/media.ts");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "clip.webm", { type: "video/webm" });
  const batch = media.prepareSqueeze([file, file]);
  if (!batch) return { error: "unsupported" };
  let progress = 0;
  const out = await batch.run(0, (f) => (progress = f), new AbortController().signal);
  // Ακύρωση στη μέση: τίποτα δεν βγαίνει.
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 300);
  const cancelled = await batch.run(1, () => undefined, stop.signal);
  batch.dispose();
  if (!out) return { error: "no result", progress };
  const url = URL.createObjectURL(out.file);
  const video = document.createElement("video");
  video.muted = true;
  video.src = url;
  const playable = await new Promise((resolve) => {
    video.onloadeddata = () => resolve(true);
    video.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 5000);
  });
  return { size: out.file.size, type: out.file.type, width: out.width, height: out.height, progress, playable, cancelled: cancelled === null };
}, videoB64);
check(
  "a video can be re-encoded in the browser and still plays",
  squeezed.playable && squeezed.progress === 1 && squeezed.width === 320 && squeezed.size > 0,
  JSON.stringify(squeezed),
);
check("cancelling the compression gives nothing back", squeezed.cancelled === true, JSON.stringify(squeezed));

// --- Forward the photo to Cat -------------------------------------------------
await ben.waitForTimeout(500);
// Ben forwards only to chats he has; give him a chat with Cat first.
const BC = await rpc(B, "start_direct_conversation", { target_user: C.id });
await rpc(C, "respond_to_request", { conversation: BC, accept: true }).catch(() => null);
await ben.reload();
await ben.waitForSelector(".chatlist > button", { timeout: 20000 });
await ben.click('.chatlist > button:has-text("Ann Archer")');
await ben.waitForSelector(".bubble.media .media-open", { timeout: 15000 });
await ben.locator(".bubble.media").first().click({ position: { x: 5, y: 5 } });
await ben.click('.msg-menu button:has-text("Προώθηση")');
await ben.waitForSelector(".forward-list label");
await ben.click('.forward-list label:has-text("Cat Cooper")');
await ben.click('.modal-actions .primary');
await cat.click('.chatlist > button:has-text("Ben Baker")');
await cat.waitForSelector(".bubble .forwarded", { timeout: 20000 });
check("forwarded photo arrives with 'forwarded' label", true);
await cat.waitForSelector(".bubble.media img.message-image", { timeout: 15000 }).catch(() => null);
check("forwarded photo decrypts for the new person", (await cat.locator(".bubble.media img.message-image").count()) === 1);

// --- Delivered (not read) ---------------------------------------------------
await cat.click('nav button[aria-label="Ρυθμίσεις"]');
await ann.click('.chatlist > button:has-text("Cat Cooper")');
await ann.fill(".conversation-inner textarea", "Είσαι εκεί;");
await ann.keyboard.press("Enter");
await ann.waitForTimeout(6500);
const ticks = await ann.evaluate(() => {
  const last = [...document.querySelectorAll(".bubble.own small svg")].pop();
  return last?.getAttribute("aria-label") || last?.className?.baseVal;
});
check("message shows delivered when the app is open but chat is not", ticks === "Παραδόθηκε", ticks);

// --- Mute, pin, archive -----------------------------------------------------
await ann.click('.conversation-menu .icon');
await ann.click('.menu-popover button:has-text("Σίγαση")');
await ann.click('.modal-actions .primary');
await ann.waitForSelector(".chatlist .list-flags svg", { timeout: 10000 });
check("muted chat shows the bell-off icon", true);
await ann.click('.conversation-menu .icon');
await ann.click('.menu-popover button:has-text("Καρφίτσωμα")');
await ann.waitForTimeout(1500);
const first = await ann.locator(".chatlist > button .title").first().textContent();
check("pinned chat goes to the top", first === "Cat Cooper", first);
await ann.click('.chatlist > button:has-text("Ben Baker")');
await ann.click('.conversation-menu .icon');
await ann.click('.menu-popover button:has-text("Αρχειοθέτηση")');
await ann.waitForSelector(".archived-row", { timeout: 10000 });
check("archived row appears", true);
await ann.screenshot({ path: `${SHOTS}/list-archived.png` });
await ann.click(".archived-row");
await ann.waitForSelector('.chatlist > button:has-text("Ben Baker")');
check("archived chat is inside the archive", true);

// --- Emoji picker -----------------------------------------------------------
await ann.click('.chatlist > button:has-text("Ben Baker")');
await ann.click(".emoji-toggle");
await ann.waitForSelector(".emoji-grid button");
await ann.click(".emoji-grid button >> nth=0");
const value = await ann.inputValue(".conversation-inner textarea");
check("emoji picker inserts emoji", value.length > 0, value);
await ann.screenshot({ path: `${SHOTS}/emoji.png` });

// --- A large, heavy video is made smaller before it is sent --------------------
// ~8'' θορύβου σε 1280x720, γραμμένα με ~40 Mbps: πάνω από 25 MB και «βαρύ».
await ann.fill(".conversation-inner textarea", "");
const videosBefore = await ben.locator(".media-open.video").count();
const bigSize = await ann.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const rec = new MediaRecorder(canvas.captureStream(30), {
    mimeType: "video/webm;codecs=vp8",
    videoBitsPerSecond: 60_000_000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start(500);
  const img = ctx.createImageData(1280, 720);
  const buf = new Uint8Array(img.data.buffer);
  const end = performance.now() + 8000;
  while (performance.now() < end) {
    for (let o = 0; o < buf.length; o += 65536) crypto.getRandomValues(buf.subarray(o, Math.min(buf.length, o + 65536)));
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    ctx.putImageData(img, 0, 0);
    await new Promise((r) => setTimeout(r, 33));
  }
  rec.stop();
  await new Promise((r) => (rec.onstop = r));
  const file = new File(chunks, "noise.webm", { type: "video/webm" });
  // Σαν να το διάλεξε από τη συλλογή.
  const input = document.querySelector('.composer-row input[type="file"][multiple][accept^="image"]');
  const picked = new DataTransfer();
  picked.items.add(file);
  input.files = picked.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return file.size;
});
const marked = await ann
  .waitForSelector('.send-preview .hint:has-text("μικρύνει")', { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check(`a heavy ${(bigSize / 1048576).toFixed(0)} MB video is marked to be made smaller`, marked && bigSize > 25 * 1048576);
await ann.click(".send-caption .send");
await ann.waitForSelector(".squeeze-progress", { timeout: 10000 });
check("compression shows its progress", (await ann.locator(".squeeze-progress progress").count()) === 1);
await ann.screenshot({ path: `${SHOTS}/video-squeeze.png` });
await ann.click('.squeeze-progress button:has-text("Άκυρο")');
await ann.waitForSelector(".send-caption .send:not([disabled])", { timeout: 10000 });
check("cancel goes back to the dialog without sending", (await ann.locator(".modal .send-caption").count()) === 1);
await ann.click(".send-caption .send");
await ann.waitForSelector(".squeeze-progress", { timeout: 10000 });
await ann.waitForSelector(".squeeze-progress", { state: "detached", timeout: 90000 });
const bigArrived = await ben
  .waitForFunction((n) => document.querySelectorAll(".media-open.video").length > n, videosBefore, { timeout: 60000 })
  .then(() => true)
  .catch(() => false);
check("the smaller video arrives", bigArrived);
const annBen = (await rpc(A, "list_conversations", {})).find((c) => c.others.some((u) => u.id === B.id));
const latest = await rpc(A, "list_messages", { conversation: annBen.id, before_message: null, page_size: 5 });
const sentSize = latest.filter((m) => m.attachment).pop()?.attachment?.size || 0;
check(
  `and it is much smaller than the original (${(sentSize / 1048576).toFixed(1)} MB)`,
  sentSize > 0 && sentSize < bigSize / 4,
  String(sentSize),
);

// --- Offline: what fails stays in the chat, and goes when the connection is back
await ann.fill(".conversation-inner textarea", "");
await ann.context().setOffline(true);
await ann.fill(".conversation-inner textarea", "Γράφω χωρίς σήμα");
await ann.keyboard.press("Enter");
await ann.waitForSelector(".msg.pending.failed", { timeout: 10000 }).catch(() => null);
check(
  "offline message stays as 'not sent', with try again and delete",
  (await ann.locator(".msg.pending.failed .pending-actions button").count()) === 2,
);
check("its text is not put back in the box", (await ann.inputValue(".conversation-inner textarea")) === "");
await ann.click('.attach-menu button[aria-label="Στείλε φωτογραφία ή αρχείο"]');
const [chooser3] = await Promise.all([
  ann.waitForEvent("filechooser"),
  ann.click('.menu-popover.up button:has-text("Φωτογραφίες")'),
]);
await chooser3.setFiles({ name: "tunnel.png", mimeType: "image/png", buffer: png(400, 300) });
await ann.waitForSelector(".send-caption .send:not([disabled])", { timeout: 15000 });
await ann.click(".send-caption .send");
await ann
  .waitForFunction(() => document.querySelectorAll(".msg.pending.failed").length === 2, null, { timeout: 10000 })
  .catch(() => null);
check("an offline photo waits as well", (await ann.locator(".msg.pending.failed").count()) === 2);
check("the waiting photo is shown", (await ann.locator(".msg.pending.failed img.message-image").count()) === 1);
await ann.screenshot({ path: `${SHOTS}/outbox-offline.png` });
const photosBefore = await ben.locator(".bubble.media img.message-image").count();

await ann.context().setOffline(false);
const arrived = await ben
  .waitForFunction(
    () => [...document.querySelectorAll(".bubble p")].some((p) => p.textContent?.includes("Γράφω χωρίς σήμα")),
    null,
    { timeout: 25000 },
  )
  .then(() => true)
  .catch(() => false);
check("the message is delivered once the connection is back", arrived);
const photoArrived = await ben
  .waitForFunction((n) => document.querySelectorAll(".bubble.media img.message-image").length > n, photosBefore, {
    timeout: 25000,
  })
  .then(() => true)
  .catch(() => false);
check("so is the photo", photoArrived);
await ann.waitForFunction(() => !document.querySelector(".msg.pending"), null, { timeout: 20000 }).catch(() => null);
check("nothing is left waiting on the sender's side", (await ann.locator(".msg.pending").count()) === 0);

// --- The answer is lost, the message is not: trying again does not send it twice
let cut = 0;
await ann.route("**/rest/v1/rpc/send_message", async (route) => {
  if (cut++ > 0) return route.continue();
  await route.fetch(); // φτάνει στη βάση…
  await route.abort("internetdisconnected"); // …αλλά η απάντηση χάνεται
});
await ann.fill(".conversation-inner textarea", "Μόνο μία φορά");
await ann.keyboard.press("Enter");
// Ή φαίνεται «δεν στάλθηκε» (και το πατάμε), ή φτάνει πρώτα το κανονικό μήνυμα
// από το realtime και παίρνει τη θέση του.
const retried = await ann.waitForSelector(".msg.pending.failed", { timeout: 6000 }).then(() => true).catch(() => false);
if (retried) await ann.click(".msg.pending.failed .bubble");
await ann.waitForFunction(() => !document.querySelector(".msg.pending"), null, { timeout: 15000 }).catch(() => null);
await ann.unroute("**/rest/v1/rpc/send_message");
await ben.reload();
await ben.waitForSelector(".chatlist > button", { timeout: 20000 });
await ben.click('.chatlist > button:has-text("Ann Archer")');
await ben.waitForFunction(
  () => [...document.querySelectorAll(".bubble p")].some((p) => p.textContent === "Μόνο μία φορά"),
  null,
  { timeout: 15000 },
).catch(() => null);
const copies = await ben.evaluate(
  () => [...document.querySelectorAll(".bubble p")].filter((p) => p.textContent === "Μόνο μία φορά").length,
);
check(`a lost answer is sent exactly once (${retried ? "tapped try again" : "replaced by the real message"})`, copies === 1, String(copies));
const mine = await ann.evaluate(
  () => [...document.querySelectorAll(".bubble.own p")].filter((p) => p.textContent === "Μόνο μία φορά").length,
);
check("the sender sees it once too", mine === 1, String(mine));

// --- Notification card (the browser has not asked yet) -----------------------
// Χωρίς λίστα permissions: με λίστα, το Chromium απαντάει «όχι» σε ό,τι λείπει
// από αυτήν (άρα και στις ειδοποιήσεις), και η κάρτα σωστά δεν φαίνεται.
{
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: "el-GR" });
  const page = await context.newPage();
  await page.goto(`${BASE}/?login`);
  await page.fill('input[type="email"]', "cat@test.local");
  await page.fill('input[type="password"]', "secret123");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".chatlist > button", { timeout: 20000 });
  check("the chat list offers to turn on notifications", (await page.locator(".chatlist .push-card").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/push-card.png` });
  await page.click(".push-card-close");
  check("the card can be dismissed", (await page.locator(".push-card").count()) === 0);
  await page.reload();
  await page.waitForSelector(".chatlist > button", { timeout: 20000 });
  check("and stays dismissed after a reload", (await page.locator(".push-card").count()) === 0);
  check("no card once the browser has said no", (await cat.locator(".push-card").count()) === 0);
  await context.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL MEDIA CHECKS PASSED");
await browser.close();
process.exit(failures ? 1 : 0);
