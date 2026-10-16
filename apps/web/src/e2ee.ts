// Κρυπτογράφηση από άκρη σε άκρη. Ό,τι αφορά κλειδιά και κρυπτογραφία είναι
// εδώ· το data.ts απλώς το καλεί. Μόνο WebCrypto του browser, καμία βιβλιοθήκη.
//
// ΤΟ ΣΧΗΜΑ («mila/v1»)
//
//   Κάθε συσκευή φτιάχνει ένα ζεύγος κλειδιών ECDH P-256. Το ιδιωτικό είναι
//   non-extractable: ο browser το χρησιμοποιεί αλλά δεν το δίνει ποτέ, ούτε σε
//   δικό μας κώδικα. Φυλάγεται στο IndexedDB. Το δημόσιο πάει στον server.
//
//   Για κάθε μήνυμα:
//     1. Τυχαίο κλειδί 256 bit μόνο γι' αυτό το μήνυμα (content key).
//     2. Το κείμενο (και τα στοιχεία του συνημμένου) κρυπτογραφείται με
//        AES-256-GCM και αυτό το κλειδί -> «envelope».
//     3. Για κάθε συσκευή παραλήπτη (και τις δικές μου): ECDH(δικό μου
//        ιδιωτικό, δικό της δημόσιο) -> HKDF -> κλειδί ζεύγους. Με αυτό
//        «τυλίγεται» το content key (AES-GCM).
//   Ο server βλέπει envelope και τυλιγμένα κλειδιά. Δεν έχει κανένα ιδιωτικό
//   κλειδί, άρα δεν ξετυλίγει τίποτα.
//
//   Ακεραιότητα: το envelope «δένεται» (AAD) με συνομιλία, αποστολέα, κλειδί
//   συσκευής αποστολέα και client id. Κάθε τυλιγμένο κλειδί δένεται επιπλέον με
//   το hash του συγκεκριμένου ciphertext και με το κλειδί του παραλήπτη. Άρα ο
//   server δεν μπορεί να μετακινήσει ένα μήνυμα σε άλλη συνομιλία, να το δείξει
//   σαν να το έστειλε άλλος, ή να κολλήσει ένα κλειδί σε άλλο μήνυμα.
//
// ΤΙ ΔΕΝ ΚΑΝΕΙ (και το λέμε στον χρήστη)
//
//   * Forward secrecy: αν κάποιος κλέψει το ιδιωτικό κλειδί μιας συσκευής, και
//     έχει κρατήσει τα ciphertexts, διαβάζει και τα παλιά μηνύματα αυτής της
//     συσκευής. (Το Signal το λύνει με ratchet· είναι το επόμενο βήμα.)
//   * Νέα συσκευή δεν διαβάζει μηνύματα από πριν υπάρξει.
//   * Τα κλειδιά τα μοιράζει ο server. Ένας κακόβουλος server θα μπορούσε να
//     «προσθέσει» δική του συσκευή σε κάποιον. Η άμυνα είναι ο κωδικός
//     ασφαλείας που συγκρίνετε από κοντά (safetyCode).

export type DeviceKeys = {
  userId: string;
  privateKey: CryptoKey;
  /** Δημόσιο κλειδί, raw (65 bytes) σε base64url. */
  publicKey: string;
  /** Το id που έδωσε ο server. null μέχρι να δηλωθεί η συσκευή. */
  deviceId: string | null;
  /** true όταν το IndexedDB δεν δουλεύει: το κλειδί ζει μόνο όσο είναι ανοιχτή η καρτέλα. */
  ephemeral: boolean;
};

export type Recipient = { deviceId: string; publicKey: string };

/** Ό,τι βρίσκεται μέσα στο κρυπτογραφημένο μήνυμα. */
export type MessagePlain = {
  /** Κείμενο. */
  t: string;
  /** Συνημμένο: όνομα, τύπος, μέγεθος, κλειδί και iv του αρχείου. */
  f?: { n: string; m: string; s: number; k: string; i: string };
};

export type E2ee = {
  v: number;
  envelope: string;
  clientId: string;
  senderKey: string | null;
  /** deviceId -> τυλιγμένο κλειδί, μόνο για τις ΔΙΚΕΣ μου συσκευές. */
  keys: Record<string, string>;
};

type Bytes = Uint8Array<ArrayBuffer>;

const subtle = globalThis.crypto?.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Το crypto.subtle υπάρχει μόνο σε https (και localhost). Σε http://192.168…
 *  από το κινητό, στο dev, δεν υπάρχει και η κρυπτογράφηση δεν μπορεί να γίνει. */
export const supported = Boolean(subtle);

// ---------------------------------------------------------------------------
// bytes <-> base64url
// ---------------------------------------------------------------------------

export function toB64(bytes: Uint8Array): string {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64(text: string): Bytes {
  const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function random(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await subtle.digest("SHA-256", data));
}

// ---------------------------------------------------------------------------
// Αποθήκευση κλειδιών (IndexedDB)
// ---------------------------------------------------------------------------
// Το CryptoKey αποθηκεύεται αυτούσιο (structured clone). Επειδή είναι
// non-extractable, ούτε ο ίδιος ο κώδικας της σελίδας δεν μπορεί να το
// διαβάσει ως bytes· μπορεί μόνο να το χρησιμοποιήσει.

const DB_NAME = "mila-keys";
const STORE = "devices";

type StoredDevice = {
  userId: string;
  privateKey: CryptoKey;
  publicKey: string;
  deviceId: string | null;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const memoryOnly = new Map<string, StoredDevice>();

async function loadStored(userId: string): Promise<StoredDevice | null> {
  try {
    return (
      ((await withStore("readonly", (s) => s.get(userId))) as
        | StoredDevice
        | undefined) ?? null
    );
  } catch {
    return memoryOnly.get(userId) ?? null;
  }
}

/** true αν σώθηκε μόνιμα, false αν έμεινε μόνο στη μνήμη. */
async function saveStored(device: StoredDevice): Promise<boolean> {
  try {
    await withStore("readwrite", (s) => s.put(device));
    return true;
  } catch {
    memoryOnly.set(device.userId, device);
    return false;
  }
}

/** Σώζει ΜΟΝΟ αν δεν υπάρχει ήδη κλειδί. Δύο καρτέλες που ανοίγουν μαζί την
 *  πρώτη φορά φτιάχνουν η καθεμία δικό της ζεύγος· κρατιέται μόνο του πρώτου,
 *  και η δεύτερη παίρνει αυτό, αντί να το σβήσει από κάτω της. */
async function saveIfAbsent(
  device: StoredDevice,
): Promise<{ device: StoredDevice; persisted: boolean }> {
  try {
    await withStore("readwrite", (s) => s.add(device));
    return { device, persisted: true };
  } catch (error) {
    if ((error as DOMException | null)?.name === "ConstraintError") {
      const existing = await loadStored(device.userId);
      if (existing) return { device: existing, persisted: true };
    }
    memoryOnly.set(device.userId, device);
    return { device, persisted: false };
  }
}

/** Σβήνει τα κλειδιά αυτής της συσκευής για αυτόν τον χρήστη. Μετά από αυτό,
 *  ό,τι μήνυμα είχε κρυπτογραφηθεί μόνο γι' αυτήν δεν διαβάζεται πια. */
export async function forgetDevice(userId: string): Promise<void> {
  memoryOnly.delete(userId);
  pairKeys.clear();
  try {
    await withStore("readwrite", (s) => s.delete(userId));
  } catch {
    // Τίποτα αποθηκευμένο, τίποτα να σβηστεί.
  }
}

/**
 * Τα κλειδιά αυτής της συσκευής για τον χρήστη. Αν δεν υπάρχουν (πρώτη φορά,
 * ή σβήστηκαν τα δεδομένα του browser), φτιάχνει καινούργια.
 */
export async function loadOrCreateDevice(userId: string): Promise<DeviceKeys> {
  if (!supported) throw new Error("Encryption is not supported in this browser");

  const stored = await loadStored(userId);
  if (stored) return { ...stored, ephemeral: memoryOnly.has(userId) };

  const pair = (await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const publicKey = toB64(
    new Uint8Array(await subtle.exportKey("raw", pair.publicKey)),
  );
  const { device, persisted } = await saveIfAbsent({
    userId,
    privateKey: pair.privateKey,
    publicKey,
    deviceId: null,
  });
  // Ζητάμε από τον browser να μη σβήσει μόνος του τα δεδομένα μας όταν
  // χρειαστεί χώρο. Δεν είναι εγγύηση (το Safari π.χ. αποφασίζει μόνο του).
  void navigator.storage?.persist?.().catch(() => undefined);
  return { ...device, ephemeral: !persisted };
}

export async function rememberDeviceId(
  device: DeviceKeys,
  deviceId: string,
): Promise<DeviceKeys> {
  const next = { ...device, deviceId };
  await saveStored({
    userId: next.userId,
    privateKey: next.privateKey,
    publicKey: next.publicKey,
    deviceId,
  });
  return next;
}

// ---------------------------------------------------------------------------
// Κλειδί ζεύγους συσκευών
// ---------------------------------------------------------------------------
// ECDH(δικό μου ιδιωτικό, δικό του δημόσιο) δίνει το ίδιο μυστικό και από
// τις δύο πλευρές. Το περνάμε από HKDF (με τα δύο δημόσια κλειδιά ως info)
// και κρατάμε στη μνήμη το αποτέλεσμα: ένα ECDH ανά ζεύγος, όχι ανά μήνυμα.

const pairKeys = new Map<string, Promise<CryptoKey>>();

async function importPublic(publicKey: string): Promise<CryptoKey> {
  return subtle.importKey(
    "raw",
    fromB64(publicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

function pairKey(me: DeviceKeys, theirPublicKey: string): Promise<CryptoKey> {
  const id = `${me.publicKey}|${theirPublicKey}`;
  let pending = pairKeys.get(id);
  if (!pending) {
    pending = (async () => {
      const theirs = await importPublic(theirPublicKey);
      const shared = await subtle.deriveBits(
        { name: "ECDH", public: theirs },
        me.privateKey,
        256,
      );
      const base = await subtle.importKey("raw", shared, "HKDF", false, [
        "deriveKey",
      ]);
      const [a, b] = [me.publicKey, theirPublicKey].sort();
      return subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: encoder.encode("mila/v1/pair"),
          info: encoder.encode(`${a}|${b}`),
        },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    // Ένα κλειδί που απέτυχε (π.χ. χαλασμένο δημόσιο) δεν μένει στη μνήμη.
    pending.catch(() => pairKeys.delete(id));
    pairKeys.set(id, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Μηνύματα
// ---------------------------------------------------------------------------

type Context = {
  conversationId: string;
  senderId: string;
  /** Δημόσιο κλειδί της συσκευής που στέλνει. */
  senderKey: string;
  clientId: string;
};

const contentAad = (c: Context) =>
  encoder.encode(
    `mila/v1/content|${c.conversationId}|${c.senderId}|${c.senderKey}|${c.clientId}`,
  );

const wrapAad = (c: Context, recipientKey: string, digest: string) =>
  encoder.encode(
    `mila/v1/key|${c.conversationId}|${c.clientId}|${c.senderKey}|${recipientKey}|${digest}`,
  );

/** Το μήκος του κειμένου στρογγυλεύεται προς τα πάνω σε πολλαπλάσιο του 64,
 *  ώστε ο server να μη βλέπει ακριβώς πόσους χαρακτήρες έγραψες. */
function padded(plain: MessagePlain): Bytes {
  const json = encoder.encode(JSON.stringify(plain));
  const size = Math.ceil((json.length + 1) / 64) * 64;
  const out = new Uint8Array(size).fill(0x20); // κενά: το JSON.parse τα αγνοεί
  out.set(json);
  return out;
}

export async function encryptMessage(
  me: DeviceKeys,
  context: Omit<Context, "senderKey">,
  plain: MessagePlain,
  recipients: Recipient[],
): Promise<{ envelope: string; keys: { device: string; key: string }[] }> {
  const full: Context = { ...context, senderKey: me.publicKey };
  const raw = random(32);
  const contentKey = await subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = random(12);
  const ct = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: contentAad(full) },
      contentKey,
      padded(plain),
    ),
  );
  const digest = toB64(await sha256(concat(iv, ct)));

  const keys: { device: string; key: string }[] = [];
  for (const r of recipients) {
    let pk: CryptoKey;
    try {
      pk = await pairKey(me, r.publicKey);
    } catch {
      // Χαλασμένο δημόσιο κλειδί κάποιας συσκευής: εκείνη η συσκευή απλώς δεν
      // θα το διαβάσει. Δεν ρίχνουμε όλο το μήνυμα για μία.
      continue;
    }
    const wrapIv = random(12);
    const wrapped = new Uint8Array(
      await subtle.encrypt(
        {
          name: "AES-GCM",
          iv: wrapIv,
          additionalData: wrapAad(full, r.publicKey, digest),
        },
        pk,
        raw,
      ),
    );
    keys.push({ device: r.deviceId, key: toB64(concat(wrapIv, wrapped)) });
  }
  raw.fill(0);

  return { envelope: JSON.stringify({ iv: toB64(iv), ct: toB64(ct) }), keys };
}

/** null = δεν υπάρχει κλειδί γι' αυτή τη συσκευή, ή το μήνυμα δεν περνάει τον
 *  έλεγχο ακεραιότητας. Ο καλών δείχνει «δεν διαβάζεται σε αυτή τη συσκευή». */
export async function decryptMessage(
  me: DeviceKeys,
  conversationId: string,
  senderId: string,
  e2ee: E2ee,
): Promise<MessagePlain | null> {
  if (!me.deviceId || !e2ee.senderKey) return null;
  const wrapped = e2ee.keys?.[me.deviceId];
  if (!wrapped) return null;
  try {
    const { iv: ivText, ct: ctText } = JSON.parse(e2ee.envelope) as {
      iv: string;
      ct: string;
    };
    const iv = fromB64(ivText);
    const ct = fromB64(ctText);
    const context: Context = {
      conversationId,
      senderId,
      senderKey: e2ee.senderKey,
      clientId: e2ee.clientId,
    };
    const digest = toB64(await sha256(concat(iv, ct)));
    const w = fromB64(wrapped);
    const pk = await pairKey(me, e2ee.senderKey);
    const raw = new Uint8Array(
      await subtle.decrypt(
        {
          name: "AES-GCM",
          iv: w.slice(0, 12),
          additionalData: wrapAad(context, me.publicKey, digest),
        },
        pk,
        w.slice(12),
      ),
    );
    const contentKey = await subtle.importKey("raw", raw, "AES-GCM", false, [
      "decrypt",
    ]);
    raw.fill(0);
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: contentAad(context) },
      contentKey,
      ct,
    );
    const parsed = JSON.parse(decoder.decode(plain)) as MessagePlain;
    if (typeof parsed?.t !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Η συσκευή που έστειλε ένα μήνυμα τυλίγει ξανά το κλειδί του για συσκευές
 * που δεν υπήρχαν τότε (ο παραλήπτης δεν είχε ανοίξει ακόμα το Mila). Ξετυλίγει
 * το δικό της αντίγραφο και το τυλίγει για καθεμία, με τον ίδιο τρόπο που θα
 * το είχε κάνει στην αποστολή. Ο server δεν βλέπει τίποτα από αυτά.
 */
export async function rewrapForDevices(
  me: DeviceKeys,
  context: { conversationId: string; senderId: string; clientId: string },
  envelope: string,
  myWrapped: string,
  recipients: Recipient[],
): Promise<{ device: string; key: string }[]> {
  const full: Context = { ...context, senderKey: me.publicKey };
  const { iv: ivText, ct: ctText } = JSON.parse(envelope) as { iv: string; ct: string };
  const digest = toB64(await sha256(concat(fromB64(ivText), fromB64(ctText))));
  const w = fromB64(myWrapped);
  const raw = new Uint8Array(
    await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: w.slice(0, 12),
        additionalData: wrapAad(full, me.publicKey, digest),
      },
      await pairKey(me, me.publicKey),
      w.slice(12),
    ),
  );
  const keys: { device: string; key: string }[] = [];
  for (const r of recipients) {
    let pk: CryptoKey;
    try {
      pk = await pairKey(me, r.publicKey);
    } catch {
      continue;
    }
    const wrapIv = random(12);
    const wrapped = new Uint8Array(
      await subtle.encrypt(
        { name: "AES-GCM", iv: wrapIv, additionalData: wrapAad(full, r.publicKey, digest) },
        pk,
        raw,
      ),
    );
    keys.push({ device: r.deviceId, key: toB64(concat(wrapIv, wrapped)) });
  }
  raw.fill(0);
  return keys;
}

// ---------------------------------------------------------------------------
// Αρχεία
// ---------------------------------------------------------------------------
// Κάθε αρχείο με δικό του τυχαίο κλειδί. Κλειδί, iv, όνομα και τύπος ταξιδεύουν
// μέσα στο κρυπτογραφημένο μήνυμα· στο storage ανεβαίνει μόνο ciphertext.

export async function encryptFile(
  data: ArrayBuffer,
): Promise<{ blob: Blob; key: string; iv: string }> {
  const raw = random(32);
  const key = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = random(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  const result = {
    blob: new Blob([ct], { type: "application/octet-stream" }),
    key: toB64(raw),
    iv: toB64(iv),
  };
  raw.fill(0);
  return result;
}

export async function decryptFile(
  data: ArrayBuffer,
  key: string,
  iv: string,
): Promise<ArrayBuffer> {
  const k = await subtle.importKey("raw", fromB64(key), "AES-GCM", false, [
    "decrypt",
  ]);
  return subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, k, data);
}

// ---------------------------------------------------------------------------
// Κωδικός ασφαλείας
// ---------------------------------------------------------------------------
// 60 ψηφία σε 12 πεντάδες, ίδια και στις δύο οθόνες. Αν συμπίπτουν όταν τα
// συγκρίνετε από κοντά (ή σε τηλέφωνο), κανείς δεν έχει παρεμβληθεί στα
// κλειδιά. Αλλάζει όταν κάποιος από τους δύο προσθέσει ή αφαιρέσει συσκευή.

async function halfCode(userId: string, keys: string[]): Promise<string> {
  const digest = await sha256(
    encoder.encode(`mila/v1/safety|${userId}|${[...keys].sort().join(",")}`),
  );
  let out = "";
  for (let i = 0; i < 6; i++) {
    const chunk = digest.slice(i * 5, i * 5 + 5);
    const n = chunk.reduce((acc, b) => acc * 256 + b, 0);
    out += String(n % 100000).padStart(5, "0");
  }
  return out;
}

export async function safetyCode(
  a: { userId: string; keys: string[] },
  b: { userId: string; keys: string[] },
): Promise<string[]> {
  const [first, second] = [a, b].sort((x, y) => (x.userId < y.userId ? -1 : 1));
  const digits =
    (await halfCode(first.userId, first.keys)) +
    (await halfCode(second.userId, second.keys));
  return digits.match(/.{5}/g) || [];
}

/** Σύντομο αποτύπωμα ενός κλειδιού, για να αναγνωρίζεις τις συσκευές σου. */
export async function fingerprint(publicKey: string): Promise<string> {
  const digest = await sha256(fromB64(publicKey));
  return [...digest.slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .match(/.{4}/g)!
    .join(" ");
}
