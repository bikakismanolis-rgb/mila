// End-to-end: τα headers ασφαλείας και οι νομικές σελίδες, όπως θα τα σερβίρει
// το Vercel. Τρέχει πάνω στο build, όχι στο dev server (ο Vite δεν στέλνει τα
// headers του vercel.json):
//
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=… npm run build
//   node scripts/serve-dist.mjs --port 5184 --supabase http://127.0.0.1:54321 &
//   bash scripts/e2e/setup.sh && E2E_BASE=http://localhost:5184 node scripts/e2e/csp.mjs
//
// Κάθε «Refused to …» ή παραβίαση του Content-Security-Policy είναι αποτυχία.
// Τα άλλα suites (chat-call, group-call, media) τρέχουν κι αυτά πάνω στον ίδιο
// server, για να φανεί ότι το CSP δεν χαλάει κλήσεις, φωνητικά και αρχεία.
import { chromium } from "playwright-core";

import fs from "node:fs";
const BASE = process.env.E2E_BASE || "http://localhost:4173";
const CHROME = process.env.CHROME || undefined;
const SHOTS = process.env.SHOTS || "e2e-shots";

fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

/** Μια σελίδα που μαζεύει κάθε μήνυμα για CSP / Permissions-Policy. */
async function open(locale = "el-GR", viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({
    locale,
    viewport,
    permissions: ["microphone", "camera"],
  });
  const page = await context.newPage();
  const blocked = [];
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|Refused to|Permissions[- ]Policy|Feature Policy/i.test(text))
      blocked.push(text.slice(0, 300));
    else if (m.type() === "error") console.log("  [console error]", text.slice(0, 200));
  });
  page.on("pageerror", (e) => blocked.push(`pageerror: ${e.message}`));
  // Ο browser το στέλνει και όταν η παραβίαση δεν φτάνει στην κονσόλα.
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy: ${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  return { context, page, blocked };
}

function noBlocks(label, blocked) {
  check(`${label}: nothing blocked by CSP`, blocked.length === 0, blocked.join(" | "));
  blocked.length = 0;
}

const visible = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return Boolean(el && getComputedStyle(el).display !== "none");
  }, selector);

// --- Headers ----------------------------------------------------------------
{
  const { context, page, blocked } = await open();
  const response = await page.goto(`${BASE}/`);
  const h = response.headers();
  const csp = h["content-security-policy"] || "";
  check("CSP is sent", csp.includes("default-src 'self'"), csp);
  check("CSP forbids framing", csp.includes("frame-ancestors 'none'"));
  check("CSP has no unsafe-eval or inline scripts", !/unsafe-eval|script-src[^;]*unsafe-inline/.test(csp));
  check("nosniff", h["x-content-type-options"] === "nosniff");
  check("X-Frame-Options DENY", h["x-frame-options"] === "DENY");
  check("Referrer-Policy", h["referrer-policy"] === "strict-origin-when-cross-origin");
  check("COOP allows the Google popup", h["cross-origin-opener-policy"] === "same-origin-allow-popups");
  const allowed = await page.evaluate(() => {
    const policy = document.permissionsPolicy || document.featurePolicy;
    return policy
      ? Object.fromEntries(
          ["camera", "microphone", "display-capture", "geolocation", "payment", "usb"].map((f) => [
            f,
            policy.allowsFeature(f),
          ]),
        )
      : null;
  });
  check(
    "Permissions-Policy: camera, microphone and screen sharing allowed",
    allowed && allowed.camera && allowed.microphone && allowed["display-capture"],
    JSON.stringify(allowed),
  );
  check(
    "Permissions-Policy: location, payment and USB off",
    allowed && !allowed.geolocation && !allowed.payment && !allowed.usb,
    JSON.stringify(allowed),
  );

  // Landing: fonts, εικόνες, service worker, manifest.
  await page.waitForSelector(".landing-footer");
  const sw = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => "ready"),
      new Promise((r) => setTimeout(() => r("timeout"), 8000)),
    ]),
  );
  check("service worker registers under the CSP", sw === "ready", sw);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === "loaded").length;
  });
  check("bundled fonts load", fonts > 0, String(fonts));
  const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).status);
  check("manifest loads", manifest === 200);
  const footer = await page.$$eval(".landing-footer a", (as) => as.map((a) => a.getAttribute("href")));
  check("landing footer links privacy and terms", footer.includes("/privacy") && footer.includes("/terms"), footer.join(" "));
  noBlocks("landing", blocked);

  // Πάτημα στους «Όρους» του footer: φορτώνει η σελίδα, στα Ελληνικά.
  await page.click('.landing-footer a[href="/terms"]');
  await page.waitForSelector("#el h1");
  check("terms open from the landing page in Greek", await visible(page, "#el"));
  check("English is hidden by default", !(await visible(page, "#en")));
  await page.click('header nav a[href="#en"]');
  check("the English switch shows English", await visible(page, "#en"));
  check("…and hides Greek", !(await visible(page, "#el")));
  await page.click('header nav a[href="#el"]');
  check("the Greek switch brings Greek back", (await visible(page, "#el")) && !(await visible(page, "#en")));
  noBlocks("terms", blocked);
  await context.close();
}

// --- Οι στατικές σελίδες ------------------------------------------------------
{
  const { context, page, blocked } = await open();
  for (const path of ["/privacy/", "/privacy", "/terms/", "/install/", "/qr/"]) {
    const response = await page.goto(`${BASE}${path}`);
    check(`${path} is served (${response.status()})`, response.status() === 200);
    check(`${path} has its own CSP`, Boolean(response.headers()["content-security-policy"]));
    // Το στυλ ήρθε από αρχείο: αλλιώς το σώμα θα είχε τα περιθώρια του browser.
    const padded = await page.evaluate(() => getComputedStyle(document.body).margin === "0px");
    check(`${path} is styled from its stylesheet`, padded);
    noBlocks(path, blocked);
  }
  await page.goto(`${BASE}/privacy#en`);
  check("/privacy#en shows English", (await visible(page, "#en")) && !(await visible(page, "#el")));
  const updated = await page.$$eval(".updated", (els) => els.map((e) => e.textContent));
  check(
    "privacy policy dated 27 October 2026 in both languages",
    updated.some((u) => u.includes("27 Οκτωβρίου 2026")) && updated.some((u) => u.includes("27 October 2026")),
    updated.join(" / "),
  );
  check("privacy policy links the terms", (await page.locator('a[href="/terms#en"]').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/privacy-en.png`, fullPage: false });

  // Το /install: η γλώσσα και οι καρτέλες έρχονται από το install.js.
  await page.goto(`${BASE}/install/`);
  await page.click('[data-set-lang="en"]');
  check("install page script runs (language switch)", await visible(page, 'section[data-lang="en"]'));
  await page.click('section[data-lang="en"] [data-tab="android"]');
  const panel = await page.evaluate(() =>
    [...document.querySelectorAll("[data-panel]")].filter((p) => !p.hidden).map((p) => p.dataset.panel),
  );
  check("install page tabs switch", panel.includes("android"), panel.join(","));
  noBlocks("install script", blocked);

  // Το /qr: το κουμπί εκτύπωσης έρχεται από το qr.js.
  await page.goto(`${BASE}/qr/`);
  await page.evaluate(() => {
    window.__printed = false;
    window.print = () => {
      window.__printed = true;
    };
  });
  await page.click(".print");
  check("qr print button works without inline onclick", await page.evaluate(() => window.__printed));
  noBlocks("qr script", blocked);
  await context.close();
}

// --- Είσοδος και εγγραφή -----------------------------------------------------
{
  const { context, page, blocked } = await open("el-GR", { width: 390, height: 844 });
  await page.goto(`${BASE}/?login`);
  await page.waitForSelector('input[type="email"]');
  await page.click('.auth-choice button:has-text("Δημιουργία λογαριασμού")');
  await page.waitForSelector(".consent a");
  const consent = await page.$$eval(".consent a", (as) => as.map((a) => a.getAttribute("href")));
  check("sign-up links the terms", consent.some((h) => /\/terms$/.test(h)), consent.join(" "));
  check("sign-up links the privacy policy", consent.some((h) => /\/privacy$/.test(h)), consent.join(" "));
  const text = await page.textContent(".consent");
  check("sign-up says you accept the terms", /αποδέχεσαι τους όρους χρήσης και την πολιτική απορρήτου/.test(text), text);
  await page.screenshot({ path: `${SHOTS}/signup-consent.png` });
  noBlocks("sign-up", blocked);

  // Σύνδεση και Ρυθμίσεις: ο σύνδεσμος για τους όρους δίπλα στην πολιτική.
  await page.click('.auth-choice button:has-text("Σύνδεση")');
  await page.fill('input[type="email"]', "ann@test.local");
  await page.fill('input[type="password"]', "secret123");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".shell", { timeout: 20000 });
  await page.click('nav button[aria-label="Ρυθμίσεις"]');
  await page.waitForSelector(".account-section");
  const settings = await page.$$eval(".account-section .hint a", (as) => as.map((a) => a.getAttribute("href")));
  check("Settings links the terms", settings.some((h) => /\/terms$/.test(h)), settings.join(" "));
  check("Settings links the privacy policy", settings.some((h) => /\/privacy$/.test(h)), settings.join(" "));
  // Η βάση (http://127.0.0.1:54321 και ws://) περνάει από το CSP.
  await page.waitForTimeout(1500);
  noBlocks("signed-in app", blocked);
  await context.close();
}

// --- Στα Αγγλικά ----------------------------------------------------------------
{
  const { context, page, blocked } = await open("en-US");
  await page.goto(`${BASE}/`);
  await page.waitForSelector(".landing-footer");
  const footer = await page.$$eval(".landing-footer a", (as) => as.map((a) => a.getAttribute("href")));
  check("English landing links /terms#en", footer.includes("/terms#en"), footer.join(" "));
  await page.click('.landing-footer a[href="/terms#en"]');
  await page.waitForSelector("#en h1");
  check("terms open in English from the English app", (await visible(page, "#en")) && !(await visible(page, "#el")));
  await page.goto(`${BASE}/?login`);
  await page.click('.auth-choice button:has-text("Create account")');
  const consent = await page.$$eval(".consent a", (as) => as.map((a) => a.getAttribute("href")));
  check("English sign-up links the English terms", consent.some((h) => /\/terms#en$/.test(h)), consent.join(" "));
  noBlocks("English", blocked);
  await context.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL E2E CHECKS PASSED");
await browser.close();
process.exit(failures ? 1 : 0);
