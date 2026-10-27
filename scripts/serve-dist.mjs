// Σερβίρει το apps/web/dist όπως το Vercel: με τα headers, τα cleanUrls και τα
// rewrites του vercel.json. Για να δοκιμάζεται τοπικά το Content-Security-Policy
// (και τα άλλα headers ασφαλείας) πριν φτάσει στους χρήστες.
//
//   npm run build
//   node scripts/serve-dist.mjs --port 5184 --supabase http://127.0.0.1:54321
//
// --supabase <url>: βάζει μέσα στο CSP την τοπική Supabase στη θέση της
//     παραγωγής (http:// και ws://), ώστε ένα build για την τοπική βάση να μην
//     μπλοκάρεται. Χωρίς αυτό, το CSP μένει ακριβώς όπως στο vercel.json.
// --check: δεν σερβίρει τίποτα. Ελέγχει ότι τα δύο vercel.json συμφωνούν, ότι
//     τα headers ασφαλείας είναι στη θέση τους, ότι κάθε αρχείο του public/
//     ξεφεύγει από το rewrite του SPA, και ότι οι στατικές σελίδες δεν έχουν
//     inline scripts ή στυλ που θα μπλόκαρε το CSP.
//
// Τα rewrites εφαρμόζονται ΠΡΙΝ ψάξουμε αρχείο. Το Vercel κοιτάει πρώτα τα
// αρχεία, οπότε εδώ είμαστε πιο αυστηροί: αν κάτι λείπει από τις εξαιρέσεις
// του rewrite, θα φανεί εδώ και όχι στην παραγωγή.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const dist = path.resolve(root, option("--dir", config.outputDirectory));
const port = Number(option("--port", "4173"));
const localSupabase = option("--supabase", "");

// ---------------------------------------------------------------------------
// Τα patterns του vercel.json (path-to-regexp): οι παρενθέσεις είναι regex
// όπως είναι, το «:όνομα» είναι ένα κομμάτι του path, όλα τα άλλα κυριολεκτικά.
// ---------------------------------------------------------------------------
function sourceRegex(source) {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "(") {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === "\\") j++;
        else if (source[j] === "(") depth++;
        else if (source[j] === ")" && --depth === 0) break;
      }
      out += source.slice(i, j + 1);
      i = j;
    } else if (c === ":" && /[A-Za-z_]/.test(source[i + 1] || "")) {
      while (/\w/.test(source[i + 1] || "")) i++;
      out += "([^/]+)";
    } else {
      out += c.replace(/[.*+?^${}|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

const rewrites = (config.rewrites || []).map((r) => ({ ...r, regex: sourceRegex(r.source) }));
const headerRules = (config.headers || []).map((r) => ({ ...r, regex: sourceRegex(r.source) }));

function rewrite(pathname) {
  for (const r of rewrites) if (r.regex.test(pathname)) return r.destination;
  return pathname;
}

function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules)
    if (rule.regex.test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  return out;
}

/** Η παραγωγή → η τοπική Supabase, μέσα στο CSP. */
function withLocalSupabase(csp) {
  const prod = csp.match(/https:\/\/[a-z0-9-]+\.supabase\.co/)?.[0];
  if (!localSupabase || !prod) return csp;
  const local = localSupabase.replace(/\/$/, "");
  return csp
    .split(prod.replace("https://", "wss://"))
    .join(local.replace(/^http/, "ws"))
    .split(prod)
    .join(local);
}

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------
function check() {
  const problems = [];
  const fail = (text) => problems.push(text);

  const other = JSON.parse(fs.readFileSync(path.join(root, "apps/web/vercel.json"), "utf8"));
  const strip = ({ outputDirectory, ...rest }) => JSON.stringify(rest);
  if (strip(config) !== strip(other))
    fail("vercel.json και apps/web/vercel.json διαφέρουν (πέρα από το outputDirectory)");

  const all = headersFor("/");
  const csp = all["Content-Security-Policy"] || "";
  const directive = (name) =>
    csp.split(";").map((d) => d.trim()).find((d) => d.split(/\s+/)[0] === name) || "";
  if (!csp) fail("λείπει το Content-Security-Policy");
  if (csp.includes("'unsafe-eval'")) fail("το CSP επιτρέπει 'unsafe-eval'");
  // Inline scripts ποτέ. Το style-src έχει 'unsafe-inline' επίτηδες: το Google
  // Sign-In βάζει μόνο του ένα <style> και style="…" στο κουμπί του, και χωρίς
  // αυτά το κουμπί χαλάει. Οι δικές μας σελίδες δεν έχουν κανένα (παρακάτω).
  if (/'unsafe-inline'/.test(directive("script-src"))) fail("το script-src επιτρέπει 'unsafe-inline'");
  if (!directive("frame-ancestors").includes("'none'")) fail("λείπει το frame-ancestors 'none'");
  if (!directive("object-src").includes("'none'")) fail("λείπει το object-src 'none'");
  const expect = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  };
  for (const [key, value] of Object.entries(expect))
    if (all[key] !== value) fail(`${key}: «${all[key]}» αντί για «${value}»`);
  // Οι κλήσεις θέλουν κάμερα, μικρόφωνο και κοινή χρήση οθόνης.
  const permissions = all["Permissions-Policy"] || "";
  for (const feature of ["camera=(self)", "microphone=(self)", "display-capture=(self)"])
    if (!permissions.includes(feature)) fail(`το Permissions-Policy δεν έχει ${feature}`);
  if (!permissions.includes("geolocation=()")) fail("το Permissions-Policy δεν κλείνει το geolocation");

  // Ό,τι είναι στο public/ πρέπει να σερβίρεται ως έχει, όχι ως index.html.
  const spa = rewrites.find((r) => r.destination === "/index.html" && r.source.includes("(?!"));
  const pub = path.join(root, "apps/web/public");
  for (const name of [...fs.readdirSync(pub), "assets"])
    if (spa?.regex.test(`/${name}`)) fail(`το /${name} πέφτει στο rewrite του SPA`);

  // Οι στατικές σελίδες: τίποτα inline που θα μπλόκαρε το CSP.
  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) pages.push(full);
    }
  };
  walk(pub);
  pages.push(path.join(root, "apps/web/index.html"));
  for (const page of pages) {
    const html = fs.readFileSync(page, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const name = path.relative(root, page);
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`${name}: inline <script>`);
    if (/<style[\s>]/i.test(html)) fail(`${name}: inline <style>`);
    if (/\sstyle\s*=/i.test(html)) fail(`${name}: style="…"`);
    if (/\son[a-z]+\s*=/i.test(html)) fail(`${name}: on…="…" handler`);
  }

  if (problems.length) {
    for (const p of problems) console.log("  FAIL", p);
    process.exit(1);
  }
  console.log(`ok: headers, rewrites και ${pages.length} σελίδες χωρίς inline κώδικα`);
}

// ---------------------------------------------------------------------------
// Ο server
// ---------------------------------------------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Το αρχείο για ένα path, με τους κανόνες του cleanUrls, ή null. */
function fileFor(pathname) {
  const candidates = [pathname];
  if (config.cleanUrls) {
    if (pathname.endsWith("/")) candidates.push(`${pathname}index.html`);
    else candidates.push(`${pathname}.html`, `${pathname}/index.html`);
  }
  for (const candidate of candidates) {
    const full = path.join(dist, candidate);
    if (!full.startsWith(dist + path.sep) && full !== dist) continue;
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // δεν υπάρχει, δοκίμασε το επόμενο
    }
  }
  return null;
}

function serve() {
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error(`Δεν βρίσκω ${dist}/index.html. Τρέξε πρώτα: npm run build`);
    process.exit(1);
  }
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    // cleanUrls: το /privacy/index.html και το /x.html γίνονται /privacy και /x.
    if (config.cleanUrls && pathname.endsWith(".html")) {
      const clean = pathname.replace(/\/index\.html$/, "").replace(/\.html$/, "") || "/";
      response.writeHead(308, { Location: clean + url.search }).end();
      return;
    }
    const file = fileFor(rewrite(pathname));
    const headers = headersFor(pathname);
    if (headers["Content-Security-Policy"])
      headers["Content-Security-Policy"] = withLocalSupabase(headers["Content-Security-Policy"]);
    if (!file) {
      response.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
      response.end("404\n");
      return;
    }
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, ...headers });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Το ${path.relative(root, dist)} στο http://localhost:${port}`);
    if (localSupabase) console.log(`CSP με την τοπική Supabase: ${localSupabase}`);
  });
}

if (process.argv.includes("--check")) check();
else serve();
