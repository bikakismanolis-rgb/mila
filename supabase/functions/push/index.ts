// Edge Function «push»: στέλνει ειδοποιήσεις (Web Push) όταν έρχεται μήνυμα.
//
// ΠΩΣ ΔΕΝΕΙ ΜΕ ΤΑ ΥΠΟΛΟΙΠΑ
//   1. Ο browser ζητάει από εδώ το ΔΗΜΟΣΙΟ κλειδί ({action:"public-key"}), φτιάχνει
//      συνδρομή για τη συσκευή και τη σώζει στη βάση (save_push_subscription).
//   2. Όταν μπαίνει μήνυμα, ένα trigger της βάσης (0009) καλεί εδώ
//      {action:"message", message_id} με μυστικό στο header x-mila-secret.
//   3. Εδώ ρωτάμε τη βάση «ποιοι πρέπει να ειδοποιηθούν και τι να γράφει»
//      (push_targets) και στέλνουμε σε κάθε συσκευή. Συνδρομές που έχουν
//      πεθάνει (404/410) σβήνονται.
//
// ΧΩΡΙΣ ΧΕΙΡΟΚΙΝΗΤΑ ΜΥΣΤΙΚΑ: τα κλειδιά VAPID φτιάχνονται εδώ την πρώτη φορά και
// φυλάσσονται στον πίνακα push_config, που τον διαβάζει μόνο το service role.
// Το SUPABASE_URL και το SUPABASE_SERVICE_ROLE_KEY τα δίνει η Supabase μόνη της
// σε κάθε Edge Function.
//
// ΧΩΡΙΣ ΒΙΒΛΙΟΘΗΚΕΣ: το πρωτόκολλο (RFC 8291 κρυπτογράφηση, RFC 8292 VAPID)
// είναι γραμμένο με το WebCrypto του runtime. Η κρυπτογράφηση ελέγχεται με το
// επίσημο παράδειγμα του RFC 8291 (δες scripts/test-webpush.mjs).

// deno-lint-ignore-file no-explicit-any

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// base64url και bytes
// ---------------------------------------------------------------------------

export function b64urlDecode(text: string): Uint8Array {
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

/** Δημόσιο κλειδί P-256 σε «raw» μορφή (65 bytes: 0x04 || x || y) -> JWK. */
function rawPublicToJwk(raw: Uint8Array): JsonWebKey {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("Bad P-256 public key");
  return {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(raw.slice(1, 33)),
    y: b64urlEncode(raw.slice(33, 65)),
    ext: true,
  };
}

// ---------------------------------------------------------------------------
// RFC 8291: κρυπτογράφηση του περιεχομένου για ΜΙΑ συγκεκριμένη συσκευή
// ---------------------------------------------------------------------------

export type EncryptOverrides = {
  /** Μόνο για το test με το παράδειγμα του RFC. Σε κανονική χρήση μένουν κενά
   *  και παράγονται τυχαία για κάθε μήνυμα. */
  salt?: Uint8Array;
  serverKeys?: { publicRaw: Uint8Array; privateJwk: JsonWebKey };
};

export async function encryptPayload(
  plaintext: Uint8Array,
  clientPublicRaw: Uint8Array, // p256dh της συνδρομής
  authSecret: Uint8Array, // auth της συνδρομής
  overrides: EncryptOverrides = {},
): Promise<Uint8Array> {
  const salt = overrides.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let serverPublicRaw: Uint8Array;
  let serverPrivate: CryptoKey;
  if (overrides.serverKeys) {
    serverPublicRaw = overrides.serverKeys.publicRaw;
    serverPrivate = await crypto.subtle.importKey(
      "jwk",
      overrides.serverKeys.privateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
  } else {
    const pair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    serverPublicRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    );
    serverPrivate = pair.privateKey;
  }

  const clientPublic = await crypto.subtle.importKey(
    "jwk",
    rawPublicToJwk(clientPublicRaw),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPublic } as any,
      serverPrivate,
      256,
    ),
  );

  // Κάθε HKDF εδώ βγάζει ≤ 32 bytes, άρα είναι ένα μόνο HMAC με «|| 0x01».
  const one = new Uint8Array([1]);
  const prkKey = await hmac(authSecret, shared);
  const keyInfo = concat(
    encoder.encode("WebPush: info\0"),
    clientPublicRaw,
    serverPublicRaw,
  );
  const ikm = await hmac(prkKey, concat(keyInfo, one));

  const prk = await hmac(salt, ikm);
  const cek = (
    await hmac(prk, concat(encoder.encode("Content-Encoding: aes128gcm\0"), one))
  ).slice(0, 16);
  const nonce = (
    await hmac(prk, concat(encoder.encode("Content-Encoding: nonce\0"), one))
  ).slice(0, 12);

  const aes = await crypto.subtle.importKey(
    "raw",
    cek as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  // 0x02 = «τελευταίο κομμάτι». Όλο το μήνυμα χωράει σε ένα record.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aes,
      concat(plaintext, new Uint8Array([2])) as BufferSource,
    ),
  );

  // Κεφαλίδα: salt(16) || record size(4) || μήκος κλειδιού(1) || δημόσιο κλειδί server(65)
  const recordSize = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(
    salt,
    recordSize,
    new Uint8Array([serverPublicRaw.length]),
    serverPublicRaw,
    ciphertext,
  );
}

// ---------------------------------------------------------------------------
// RFC 8292 (VAPID): «ποιος στέλνει», υπογεγραμμένο
// ---------------------------------------------------------------------------

export type Vapid = { publicKey: string; privateJwk: JsonWebKey };

export async function generateVapid(): Promise<Vapid> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return {
    publicKey: b64urlEncode(publicRaw),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

export async function vapidAuthorization(
  endpoint: string,
  vapid: Vapid,
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64urlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: nowSeconds + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    vapid.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Το WebCrypto επιστρέφει r||s (64 bytes) — ακριβώς η μορφή που θέλει το JWT.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(`${header}.${claims}`) as BufferSource,
    ),
  );
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

// ---------------------------------------------------------------------------
// Αποστολή σε μία συσκευή
// ---------------------------------------------------------------------------

type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

// Μόνο οι γνωστές υπηρεσίες push. Η βάση ελέγχει το ίδιο όταν σώζεται η
// συνδρομή· εδώ είναι η δεύτερη κλειδαριά, ώστε η function να μη γίνει ποτέ
// εργαλείο για αιτήματα προς αυθαίρετες διευθύνσεις.
const ALLOWED_HOSTS =
  /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/i;

export function endpointAllowed(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && ALLOWED_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

async function sendOne(
  subscription: Subscription,
  payload: unknown,
  vapid: Vapid,
  subject: string,
): Promise<{ id: string; status: number }> {
  if (!endpointAllowed(subscription.endpoint))
    return { id: subscription.id, status: 410 };
  try {
    const body = await encryptPayload(
      encoder.encode(JSON.stringify(payload)),
      b64urlDecode(subscription.p256dh),
      b64urlDecode(subscription.auth),
    );
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(subscription.endpoint, vapid, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "high",
      },
      body: body as BodyInit,
    });
    return { id: subscription.id, status: response.status };
  } catch (error) {
    console.error("push send failed:", error);
    return { id: subscription.id, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// Βάση (με το service role, μέσω του REST API της Supabase)
// ---------------------------------------------------------------------------

function env(name: string): string {
  const value = (globalThis as any).Deno?.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok)
    throw new Error(`${fn} failed (${response.status}): ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

type Config = {
  vapid_public: string | null;
  vapid_private: JsonWebKey | null;
  webhook_secret: string;
  subject: string;
};

async function configWithKeys(): Promise<Config & Vapid> {
  let config = await rpc<Config>("push_config_get");
  if (!config.vapid_public || !config.vapid_private) {
    const fresh = await generateVapid();
    // Αν δύο κλήσεις φτάσουν μαζί, η βάση κρατάει την πρώτη· ξαναδιαβάζουμε
    // ώστε όλοι να δουλεύουν με το ίδιο κλειδί.
    await rpc("push_store_vapid", {
      public_key: fresh.publicKey,
      private_key: fresh.privateJwk,
    });
    config = await rpc<Config>("push_config_get");
  }
  return {
    ...config,
    publicKey: config.vapid_public as string,
    privateJwk: config.vapid_private as JsonWebKey,
  };
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

export async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await request.json().catch(() => ({}));

    if (body?.action === "public-key") {
      const config = await configWithKeys();
      return json({ publicKey: config.publicKey });
    }

    if (body?.action === "message" && typeof body.message_id === "string") {
      const config = await configWithKeys();
      const given = request.headers.get("x-mila-secret") || "";
      if (!sameSecret(given, config.webhook_secret))
        return json({ error: "forbidden" }, 403);

      const targets = await rpc<{
        payload: unknown;
        subscriptions: Subscription[];
      } | null>("push_targets", { message: body.message_id });
      if (!targets?.subscriptions?.length) return json({ sent: 0 });

      const results = await Promise.all(
        targets.subscriptions.map((s) =>
          sendOne(s, targets.payload, config, config.subject),
        ),
      );
      const dead = results
        .filter((r) => r.status === 404 || r.status === 410)
        .map((r) => r.id);
      if (dead.length) await rpc("push_prune", { ids: dead });

      return json({
        sent: results.filter((r) => r.status >= 200 && r.status < 300).length,
        failed: results.filter((r) => r.status === 0 || r.status >= 400).length,
        pruned: dead.length,
      });
    }

    return json({ error: "unknown action" }, 400);
  } catch (error) {
    console.error("push function error:", error);
    return json({ error: "internal error" }, 500);
  }
}

// Στο Supabase (Deno) ξεκινάει ο server. Στα τοπικά tests (Node) το αρχείο
// απλώς εισάγεται για τις συναρτήσεις του.
if ((globalThis as any).Deno?.serve) (globalThis as any).Deno.serve(handler);
