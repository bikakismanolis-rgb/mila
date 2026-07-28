// Read-only Supabase diagnostics + προαιρετικό signup test.
// Τρέξε από τη ρίζα του project:
//   node scripts/check-supabase.mjs
//   node scripts/check-supabase.mjs --signup you+test1@example.com MyPassw0rd
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const env = loadEnv(resolve("apps/web/.env.local"));
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.error("Δεν βρέθηκαν VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY στο apps/web/.env.local");
  process.exit(1);
}

const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };

async function get(path, label) {
  try {
    const r = await fetch(URL_ + path, { headers: H });
    const text = await r.text();
    console.log(`\n=== ${label} [${r.status}] ===`);
    console.log(text.slice(0, 800) || "(κενό)");
    return { status: r.status, text };
  } catch (e) {
    console.log(`\n=== ${label} [ΣΦΑΛΜΑ ΔΙΚΤΥΟΥ] ===\n${e.message}`);
    return { status: 0, text: "" };
  }
}

await get("/auth/v1/health", "Auth health");
const settings = await get("/auth/v1/settings", "Auth settings");
await get("/rest/v1/profiles?select=id,email,display_name&limit=5", "profiles (REST)");

try {
  const r = await fetch(URL_ + "/rest/v1/rpc/search_profiles", {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ search_term: "test" }),
  });
  console.log(`\n=== search_profiles RPC [${r.status}] ===`);
  console.log((await r.text()).slice(0, 400));
} catch (e) {
  console.log(`\n=== search_profiles RPC [ΣΦΑΛΜΑ] ===\n${e.message}`);
}

const idx = process.argv.indexOf("--signup");
if (idx !== -1) {
  const email = process.argv[idx + 1];
  const password = process.argv[idx + 2];
  if (!email || !password) {
    console.error("\nΧρήση: node scripts/check-supabase.mjs --signup email password");
    process.exit(1);
  }
  console.log(`\n=== SIGNUP TEST: ${email} ===`);
  const r = await fetch(URL_ + "/auth/v1/signup", {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({}));
  console.log(`Status: ${r.status}`);
  if (body.id || body.user?.id) {
    const u = body.user ?? body;
    console.log(`User id: ${u.id}`);
    console.log(`confirmation_sent_at: ${u.confirmation_sent_at ?? "(τίποτα)"}`);
    console.log(
      u.confirmation_sent_at
        ? "-> Στάλθηκε confirmation email. Έλεγξε το inbox (και spam)."
        : "-> Δημιουργήθηκε user αλλά ΔΕΝ φαίνεται να στάλθηκε email.",
    );
  } else {
    console.log("Απάντηση:", JSON.stringify(body, null, 2).slice(0, 800));
  }
}
console.log("\nΤέλος διαγνωστικών.");
