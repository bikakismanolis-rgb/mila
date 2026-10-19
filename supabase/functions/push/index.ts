// Edge Function «push»: στέλνει ειδοποιήσεις (Web Push) όταν έρχεται μήνυμα ή
// κλήση, και δίνει στον browser τους servers για τις κλήσεις (STUN/TURN).
//
// ΠΩΣ ΔΕΝΕΙ ΜΕ ΤΑ ΥΠΟΛΟΙΠΑ
//   1. Ο browser ζητάει από εδώ το ΔΗΜΟΣΙΟ κλειδί ({action:"public-key"}), φτιάχνει
//      συνδρομή για τη συσκευή και τη σώζει στη βάση (save_push_subscription).
//   2. Όταν μπαίνει μήνυμα, ένα trigger της βάσης (0009) καλεί εδώ
//      {action:"message", message_id} με μυστικό στο header x-mila-secret.
//   3. Εδώ ρωτάμε τη βάση «ποιοι πρέπει να ειδοποιηθούν και τι να γράφει»
//      (push_targets) και στέλνουμε σε κάθε συσκευή. Συνδρομές που έχουν
//      πεθάνει (404/410) σβήνονται.
//   4. Για κλήσεις το ίδιο, με {action:"call", call_id, event} από το trigger
//      του 0013 και push_call_targets.
//   5. {action:"ice"} από συνδεδεμένο χρήστη: οι servers που βοηθούν δύο
//      συσκευές να βρεθούν (δες iceServers πιο κάτω).
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

type SendOptions = {
  /** Πόσα δευτερόλεπτα κρατάει η υπηρεσία push την ειδοποίηση αν η συσκευή
   *  είναι κλειστή. Ένα «σε καλεί» μετά από ένα λεπτό δεν έχει νόημα. */
  ttl?: number;
  /** Ίδιο topic = η νεότερη αντικαθιστά την παλιότερη που δεν παραδόθηκε ακόμα
   *  (π.χ. το «αναπάντητη» παίρνει τη θέση του «σε καλεί»). */
  topic?: string;
};

async function sendOne(
  subscription: Subscription,
  payload: unknown,
  vapid: Vapid,
  subject: string,
  options: SendOptions = {},
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
        TTL: String(options.ttl ?? 86400),
        Urgency: "high",
        ...(options.topic ? { Topic: options.topic } : {}),
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

/** Στέλνει σε όλες τις συσκευές και σβήνει όσες συνδρομές έχουν πεθάνει. */
async function sendAll(
  targets: { payload: unknown; subscriptions: Subscription[] } | null,
  config: Config & Vapid,
  options: SendOptions = {},
) {
  if (!targets?.subscriptions?.length) return { sent: 0 };
  const results = await Promise.all(
    targets.subscriptions.map((s) =>
      sendOne(s, targets.payload, config, config.subject, options),
    ),
  );
  const dead = results
    .filter((r) => r.status === 404 || r.status === 410)
    .map((r) => r.id);
  if (dead.length) await rpc("push_prune", { ids: dead });
  return {
    sent: results.filter((r) => r.status >= 200 && r.status < 300).length,
    failed: results.filter((r) => r.status === 0 || r.status >= 400).length,
    pruned: dead.length,
  };
}

// ---------------------------------------------------------------------------
// Servers για τις κλήσεις (ICE)
// ---------------------------------------------------------------------------
// Δύο συσκευές πίσω από router πρέπει πρώτα να μάθουν «πώς φαίνονται απ' έξω»
// (STUN, δωρεάν). Όταν κάποιο δίκτυο δεν αφήνει απευθείας σύνδεση (συχνό στα
// δίκτυα κινητής), ο ήχος περνάει από αναμεταδότη (TURN). Ο αναμεταδότης δεν
// ακούει τίποτα: ό,τι περνάει είναι ήδη κρυπτογραφημένο από άκρη σε άκρη.
//
// TURN, ό,τι από τα παρακάτω έχει οριστεί στα secrets της function:
//   CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN   (Cloudflare Calls)
//   TURN_URLS + TURN_SECRET      (δικός σου coturn με use-auth-secret)
//   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL   (σταθερά στοιχεία, π.χ. metered.ca)
// Χωρίς κανένα: μόνο STUN. Οι περισσότερες κλήσεις συνδέονται και έτσι.

type IceServer = { urls: string | string[]; username?: string; credential?: string };

const ICE_TTL = 12 * 60 * 60;

function optionalEnv(name: string): string {
  return ((globalThis as any).Deno?.env.get(name) as string | undefined)?.trim() || "";
}

/** Οι browsers δεν συνδέονται στη θύρα 53, και η απόπειρα καθυστερεί την κλήση. */
function withoutPort53(server: IceServer): IceServer {
  const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
    (u) => !/:53(\?|$)/.test(u),
  );
  return { ...server, urls };
}

async function cloudflareTurn(): Promise<IceServer[]> {
  const keyId = optionalEnv("CLOUDFLARE_TURN_KEY_ID");
  const token = optionalEnv("CLOUDFLARE_TURN_API_TOKEN");
  if (!keyId || !token) return [];
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials`;
  for (const path of ["generate-ice-servers", "generate"]) {
    const response = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: ICE_TTL }),
    }).catch(() => null);
    if (!response) return [];
    if (response.status === 404) continue;
    if (!response.ok) {
      console.error("cloudflare turn failed:", response.status, await response.text());
      return [];
    }
    const data = (await response.json()) as { iceServers?: IceServer | IceServer[] };
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return list.map(withoutPort53).filter((s) => (s.urls as string[]).length);
  }
  return [];
}

async function coturn(userId: string): Promise<IceServer[]> {
  const urls = optionalEnv("TURN_URLS").split(",").map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return [];
  const secret = optionalEnv("TURN_SECRET");
  if (secret) {
    // «TURN REST API»: όνομα = λήξη:χρήστης, κωδικός = HMAC-SHA1(μυστικό, όνομα).
    const username = `${Math.floor(Date.now() / 1000) + ICE_TTL}:${userId}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret) as BufferSource,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(username) as BufferSource),
    );
    let raw = "";
    for (const b of mac) raw += String.fromCharCode(b);
    return [{ urls, username, credential: btoa(raw) }];
  }
  const username = optionalEnv("TURN_USERNAME");
  const credential = optionalEnv("TURN_CREDENTIAL");
  return username && credential ? [{ urls, username, credential }] : [];
}

export async function iceServers(userId: string): Promise<{ iceServers: IceServer[]; ttl: number; relay: boolean }> {
  const turn = [...(await cloudflareTurn()), ...(await coturn(userId))];
  return {
    iceServers: [
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
      ...turn,
    ],
    ttl: ICE_TTL,
    relay: turn.length > 0,
  };
}

/** Ο χρήστης πίσω από το token του αιτήματος, ή null. Ρωτάμε το ίδιο το Auth,
 *  ώστε να μη μετράει ένα token που ανακλήθηκε ή ένα anon key. */
async function signedInUser(request: Request): Promise<string | null> {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(authorization)) return null;
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: authorization },
  }).catch(() => null);
  if (!response?.ok) return null;
  const user = (await response.json().catch(() => null)) as { id?: string } | null;
  return typeof user?.id === "string" ? user.id : null;
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
      return json(await sendAll(targets, config));
    }

    if (body?.action === "call" && typeof body.call_id === "string") {
      const config = await configWithKeys();
      const given = request.headers.get("x-mila-secret") || "";
      if (!sameSecret(given, config.webhook_secret))
        return json({ error: "forbidden" }, 403);

      const event = body.event === "missed" ? "missed" : "ring";
      const targets = await rpc<{
        payload: unknown;
        subscriptions: Subscription[];
      } | null>("push_call_targets", { p_call: body.call_id, p_event: event });
      return json(
        await sendAll(targets, config, {
          ttl: event === "ring" ? 45 : 86400,
          topic: body.call_id.replace(/[^A-Za-z0-9]/g, "").slice(0, 32),
        }),
      );
    }

    if (body?.action === "ice") {
      const userId = await signedInUser(request);
      if (!userId) return json({ error: "sign in first" }, 401);
      return json(await iceServers(userId));
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
