// End-to-end: αναφορά μηνύματος (με και χωρίς κείμενο), η παλιά αναφορά μέσω
// REST, αναστολή λογαριασμού με την οθόνη της, δεσμευμένο όνομα, αποσύνδεση
// μόνο από μία συσκευή, κωδικός 8 χαρακτήρων. Θέλει το 0014 στην τοπική βάση.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const API = process.env.E2E_API || "http://127.0.0.1:54321";
const DB = process.env.E2E_DB || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Το δημόσιο «demo» anon key κάθε τοπικής Supabase (supabase start). Όχι της παραγωγής.
const ANON =
  process.env.E2E_ANON ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const CHROME = process.env.CHROME || undefined;

if (!/127\.0\.0\.1|localhost/.test(DB)) {
  console.log(`Αρνούμαι: το E2E_DB δεν είναι τοπικό (${DB})`);
  process.exit(1);
}
// Όπως ο SQL editor της Supabase: ο ιδιοκτήτης της βάσης, χωρίς auth.uid().
const sql = (query) =>
  execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

async function open(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "el-GR" });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`[${name} pageerror]`, e.message));
  await page.goto(`${BASE}/?login`);
  return { context, page, name };
}

async function user(email, name) {
  const who = await open(name);
  await who.page.fill('input[type="email"]', email);
  await who.page.fill('input[type="password"]', "secret123");
  await who.page.click('button[type="submit"]');
  await who.page.waitForSelector(".shell", { timeout: 20000 });
  log(name, "signed in");
  return who;
}

// Από προηγούμενο τρέξιμο που κόπηκε στη μέση.
sql(`update profiles set suspended_at = null, suspended_reason = null where email like '%@test.local'`);
const annId = sql("select id from auth.users where email = 'ann@test.local'");
const benId = sql("select id from auth.users where email = 'ben@test.local'");
const started = sql("select now()");

const ann = await user("ann@test.local", "ann");
const ben = await user("ben@test.local", "ben");

try {
  // --- Μια συνομιλία ----------------------------------------------------------
  await ann.page.click('nav button[aria-label="Βρες άτομα"]');
  await ann.page.fill(".search input", "ben@test.local");
  await ann.page.waitForSelector(".people > button", { timeout: 10000 });
  await ann.page.click(".people > button");
  await ann.page.waitForSelector(".conversation-inner textarea", { timeout: 10000 });
  await ann.page.fill(".conversation-inner textarea", "Γεια σου Ben");
  await ann.page.keyboard.press("Enter");
  await ann.page.waitForSelector(".bubble.own p", { timeout: 10000 });

  await ben.page.waitForSelector(".chatlist > button", { timeout: 15000 });
  await ben.page.click(".chatlist > button");
  await ben.page.waitForSelector(".request button:not(.secondary)", { timeout: 10000 });
  await ben.page.click(".request button:not(.secondary)");
  await ben.page.waitForSelector(".conversation-inner textarea", { timeout: 10000 });
  await ben.page.fill(".conversation-inner textarea", "Θα το μετανιώσεις αυτό");
  await ben.page.keyboard.press("Enter");

  const threat = ann.page.locator(".bubble:not(.own)", { hasText: "μετανιώσεις" });
  await threat.waitFor({ timeout: 15000 });
  check("ann receives the message", true);

  // --- Αναφορά μηνύματος, με το κείμενο ---------------------------------------
  await threat.click();
  await ann.page.click('.msg-menu button:has-text("Αναφορά")');
  await ann.page.waitForSelector(".modal textarea", { timeout: 5000 });
  check("the text is not shared unless ticked", !(await ann.page.locator('.modal input[type="checkbox"]').isChecked()));
  await ann.page.fill(".modal textarea", "Απειλή");
  await ann.page.check('.modal input[type="checkbox"]');
  const preview = await ann.page.locator(".report-preview").textContent();
  check("the reporter sees exactly what is sent", preview?.includes("Ben Baker: Θα το μετανιώσεις αυτό"), preview);
  await ann.page.click('.modal button:has-text("Αποστολή αναφοράς")');
  await ann.page.waitForSelector('.toast:has-text("Ευχαριστούμε")', { timeout: 10000 });
  const row = sql(`select reported_id = '${benId}' and message_id is not null and status = 'open'
                     and excerpt like '%Θα το μετανιώσεις αυτό%'
                   from reports where reporter_id = '${annId}' and created_at > '${started}'
                   order by created_at desc limit 1`);
  check("message report reaches the database with the excerpt", row === "t", row);

  // --- Αναφορά ανθρώπου από τα στοιχεία επαφής, χωρίς κείμενο -----------------
  await ann.page.click('.conversation-menu button[aria-label="Επιλογές συνομιλίας"]');
  await ann.page.click('.menu-popover button:has-text("Στοιχεία επαφής")');
  await ann.page.click('.contact-actions button.report');
  await ann.page.fill(".modal textarea", "Ψεύτικο προφίλ");
  await ann.page.click('.modal button:has-text("Αποστολή αναφοράς")');
  await ann.page.waitForSelector('.toast:has-text("Ευχαριστούμε")', { timeout: 10000 });
  const person = sql(`select reported_id = '${benId}' and message_id is null and conversation_id is not null
                        and excerpt is null
                      from reports where reporter_id = '${annId}' and reason = 'Ψεύτικο προφίλ'
                        and created_at > '${started}'`);
  check("person report without text", person === "t", person);

  // --- Η παλιά αναφορά (προηγούμενο site): σκέτο INSERT μέσω REST -------------
  const login = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ann@test.local", password: "secret123" }),
  }).then((r) => r.json());
  const rest = (method, path, body) =>
    fetch(`${API}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${login.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: body && JSON.stringify(body),
    });
  const legacy = await rest("POST", "reports", { reporter_id: annId, reported_id: benId, reason: "legacy e2e" });
  check("old site's direct report still works", legacy.status === 201, `${legacy.status} ${await legacy.text()}`);
  const forged = await rest("POST", "reports", { reporter_id: annId, reported_id: benId, reason: "x", excerpt: "forged" });
  check("direct insert cannot attach an excerpt", forged.status === 401 || forged.status === 403, String(forged.status));
  const read = await rest("GET", "reports?select=excerpt");
  check("reports are not readable through the API", read.status === 401 || read.status === 403, String(read.status));
  const moderation = await rest("POST", "rpc/moderation_reports", {});
  check("moderation functions are not reachable through the API", moderation.status >= 400, String(moderation.status));
  await fetch(`${API}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${login.access_token}` },
  });

  // --- Αναστολή ------------------------------------------------------------------
  sql(`select moderation_suspend('${benId}', 'Απειλές προς άλλον χρήστη.')`);
  // Ο Ben έχει ανοιχτό το app: η πρώτη άρνηση της βάσης φέρνει την οθόνη.
  await ben.page.fill(".conversation-inner textarea", "κι άλλο");
  await ben.page.keyboard.press("Enter");
  await ben.page.waitForSelector(".login.suspended", { timeout: 40000 }).catch(() => null);
  const screen = await ben.page.locator(".login.suspended").textContent().catch(() => "");
  check("running app switches to the suspended screen", screen?.includes("Ο λογαριασμός σου έχει ανασταλεί"), screen);
  check("the reason is shown", screen?.includes("Απειλές προς άλλον χρήστη."), screen);
  await ben.page.reload();
  await ben.page.waitForSelector(".login.suspended", { timeout: 15000 }).catch(() => null);
  check("after a reload too", (await ben.page.locator(".login.suspended").count()) === 1);
  check("no app behind it", (await ben.page.locator(".shell").count()) === 0);
  // Τα δεδομένα του τα κατεβάζει κανονικά, και τα μηνύματά του ανοίγουν με τα
  // κλειδιά της συσκευής, ακόμα κι αν η βάση δεν τη δέχεται πια ως ενεργή.
  const [download] = await Promise.all([
    ben.page.waitForEvent("download", { timeout: 15000 }),
    ben.page.click('.login.suspended button:has-text("Λήψη των δεδομένων μου")'),
  ]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  check("suspended can download their data", exported.profile?.suspension?.reason === "Απειλές προς άλλον χρήστη.",
    JSON.stringify(exported.profile?.suspension));
  check("with their own messages readable",
    exported.messages?.some((m) => m.body === "Θα το μετανιώσεις αυτό"),
    JSON.stringify(exported.messages?.map((m) => m.body)));

  await ann.page.fill(".conversation-inner textarea", "Είσαι εκεί;");
  await ann.page.keyboard.press("Enter");
  await ann.page
    .waitForFunction(() => [...document.querySelectorAll(".bubble.own p")].some((p) => p.textContent?.includes("Είσαι εκεί;")), null, { timeout: 10000 })
    .catch(() => null);
  check("others keep chatting normally", (await ann.page.locator(".bubble.own p", { hasText: "Είσαι εκεί;" }).count()) === 1);

  sql(`select moderation_unsuspend('${benId}')`);
  await ben.page.reload();
  await ben.page.waitForSelector(".shell", { timeout: 15000 }).catch(() => null);
  check("unsuspended account is back in the app", (await ben.page.locator(".shell").count()) === 1);

  // --- Δεσμευμένο όνομα ---------------------------------------------------------
  await ann.page.click('nav button[aria-label="Ρυθμίσεις"]');
  const nameField = ann.page.locator(".settings > label").first().locator("input");
  await nameField.fill("Μίλα");
  await ann.page.click('.settings > button:has-text("Αποθήκευση")');
  await ann.page.waitForSelector(".settings > .error", { timeout: 10000 }).catch(() => null);
  const nameError = await ann.page.locator(".settings > .error").textContent().catch(() => "");
  check("reserved name is refused with a clear message", nameError?.includes("δεσμευμένο"), nameError);
  check("the name did not change", sql(`select display_name from profiles where id = '${annId}'`) === "Ann Archer");

  // --- Αποσύνδεση μόνο από αυτή τη συσκευή --------------------------------------
  const sessions = () => Number(sql(`select count(*) from auth.sessions where user_id = '${annId}'`));
  const second = await user("ann@test.local", "ann-2");
  const before = sessions();
  await second.page.click('nav button[aria-label="Αποσύνδεση"]');
  await second.page.waitForSelector('input[type="email"]', { timeout: 15000 });
  check("signing out ends only that device's session", sessions() === before - 1, `${before} -> ${sessions()}`);
  await ann.page.reload();
  await ann.page.waitForSelector(".shell", { timeout: 15000 }).catch(() => null);
  check("the other device stays signed in", (await ann.page.locator(".shell").count()) === 1);
  await second.context.close();

  // --- Κωδικός 8 χαρακτήρων στην εγγραφή ------------------------------------------
  const fresh = await open("fresh");
  await fresh.page.click('.auth-choice button:has-text("Δημιουργία λογαριασμού")');
  await fresh.page.fill('input[type="email"]', "short-password@test.local");
  await fresh.page.fill('input[type="password"]', "1234567");
  await fresh.page.click('button[type="submit"]');
  await fresh.page.waitForSelector(".login-card .error", { timeout: 5000 }).catch(() => null);
  const pwError = await fresh.page.locator(".login-card .error").textContent().catch(() => "");
  check("sign-up needs 8 characters", pwError?.includes("8 χαρακτήρες"), pwError);
  await fresh.context.close();
} catch (error) {
  console.log("  FAIL unexpected:", error.message);
  failures++;
} finally {
  // Η τοπική βάση είναι κοινή: κανείς δεν μένει σε αναστολή για τα επόμενα tests.
  sql(`update profiles set suspended_at = null, suspended_reason = null where email like '%@test.local'`);
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
