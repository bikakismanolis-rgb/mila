// Data layer πάνω από το Supabase. Ό,τι μιλάει με τη βάση περνάει από εδώ,
// ώστε τα components να μην ξέρουν τίποτα για RPCs, πίνακες ή storage.
//
// Τα σχήματα (User, Msg, Chat) τα φτιάχνει η βάση, στα profile_payload /
// message_payload / list_conversations. Αν αλλάξει κάτι εκεί, αλλάζει κι εδώ.

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { t, translateError } from "./i18n";
import type { TKey } from "./i18n";
import * as e2ee from "./e2ee";
import type { DeviceKeys, E2ee, MessagePlain, Recipient } from "./e2ee";
import { MAX_FILE } from "./limits";

export type Privacy = {
  discover: "everyone" | "contacts" | "nobody";
  showEmail: "chat" | "contacts" | "nobody";
  receipts: boolean;
  online: boolean;
};

export type User = {
  id: string;
  /** null όταν ο άλλος δεν το δείχνει ή δεν είμαστε επαφές. */
  email: string | null;
  name: string;
  /** null όταν ο άλλος δεν έχει ορίσει username και δεν δικαιούμαι να δω το
   *  email του (από το οποίο θα έβγαινε). */
  username: string | null;
  bio: string;
  /** Path στον private bucket «avatars», αν δικαιούμαι να τη δω. */
  avatarPath?: string | null;
  /** Έτοιμο για <img src>: signed URL της φωτογραφίας ή τα αρχικά του ονόματος. */
  avatar: string;
  deleted?: boolean;
  /** Μόνο για τον εαυτό μου· για τους άλλους ο server δεν τις στέλνει. */
  privacy: Privacy | null;
  /** «Σε σύνδεση» / «τελευταία φορά». null όταν δεν δικαιούμαι να το δω. */
  presence?: Presence | null;
  /** Μόνο για τον εαυτό μου: ο λογαριασμός είναι σε αναστολή (0014). */
  suspended?: Suspension | null;
};

export type Presence = { online: boolean; lastSeen: string | null };

/** Πότε και γιατί ανεστάλη ο λογαριασμός. Την αιτία τη γράφουν οι συντονιστές
 *  για να τη διαβάσει ο ίδιος. */
export type Suspension = { at: string; reason: string | null };

export type Member = User & { role?: "member" | "admin" };

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  /** Για εικόνες: blob: URL (κρυπτογραφημένες) ή signed URL (παλιές). */
  url?: string;
  /** Κλειδί και iv του αρχείου, από το κρυπτογραφημένο μήνυμα. */
  key?: string;
  iv?: string;
  /** Διάρκεια σε δευτερόλεπτα (ήχος, βίντεο). */
  duration?: number;
  /** Κυματομορφή φωνητικού: ύψος κάθε στήλης, 0-31. */
  waveform?: number[];
  /** Φωνητικό μήνυμα (όχι απλό αρχείο ήχου). */
  voice?: boolean;
  /** Μικρογραφία (data: URL), για βίντεο. */
  poster?: string;
  width?: number;
  height?: number;
};

export type Reaction = { userId: string; emoji: string };

export type ReplyPreview = {
  id: string;
  senderId: string;
  senderName: string | null;
  body: string;
  deleted: boolean;
  attachmentName: string | null;
  encrypted?: boolean;
  e2ee?: E2ee | null;
  undecryptable?: boolean;
};

export type Msg = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  deleted?: boolean;
  encrypted?: boolean;
  e2ee?: E2ee | null;
  /** Κρυπτογραφημένο, αλλά όχι για αυτή τη συσκευή (π.χ. στάλθηκε πριν υπάρξει). */
  undecryptable?: boolean;
  /** Δεν διαβάζεται ΑΚΟΜΑ: καμία συσκευή μου δεν πήρε κλειδί, και θα το φέρει η
   *  συσκευή του αποστολέα μόλις ανοίξει (0012). */
  pendingKey?: boolean;
  /** Δικό μου μήνυμα που κάποιος δεν έχει ακόμα κλειδί για να το διαβάσει. */
  waiting?: boolean;
  kind?: string;
  createdAt: string;
  /** Πότε το άλλαξε ο αποστολέας, αν το άλλαξε. */
  editedAt?: string | null;
  /** Προωθημένο (το ξέρουν μόνο οι συσκευές). */
  forwarded?: boolean;
  readBy: string[];
  deliveredTo: string[];
  reactions?: Reaction[];
  replyTo?: ReplyPreview | null;
  attachment?: Attachment | null;
};

export type Chat = {
  id: string;
  type: "direct" | "group" | string;
  name?: string | null;
  myRole?: "member" | "admin";
  others: Member[];
  last?: Msg | null;
  unread: number;
  requestFrom?: string | null;
  requestStatus?: "pending" | "accepted" | "rejected";
  blockedByMe?: boolean;
  createdAt: string;
  /** Μόνο για μένα: σίγαση, αρχείο, καρφίτσωμα. */
  mutedUntil?: string | null;
  archived?: boolean;
  pinnedAt?: string | null;
  lastCall?: Call | null;
};

export type CallParticipant = {
  userId: string;
  state: "ringing" | "joined" | "declined" | "missed" | "left";
  deviceId: string | null;
  joinedAt: string | null;
  leftAt: string | null;
};

export type Call = {
  id: string;
  conversationId: string;
  callerId: string;
  video: boolean;
  status: "ringing" | "active" | "ended";
  endReason: "completed" | "missed" | "declined" | "busy" | "failed" | null;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  participants: CallParticipant[];
};

export type NewAttachment = {
  path: string;
  name: string;
  mime: string;
  /** Μέγεθος του αρχικού αρχείου. */
  size: number;
  /** Μέγεθος αυτού που ανέβηκε (κρυπτογραφημένο, λίγο μεγαλύτερο). */
  uploadSize: number;
  key: string;
  iv: string;
} & MediaInfo;

/** Ό,τι ξέρουμε για ένα αρχείο πέρα από όνομα και τύπο. Ταξιδεύει μέσα στο
 *  κρυπτογραφημένο μήνυμα· ο server δεν το βλέπει. */
export type MediaInfo = {
  duration?: number;
  waveform?: number[];
  voice?: boolean;
  poster?: string;
  width?: number;
  height?: number;
};

export type Device = {
  id: string;
  label: string;
  publicKey: string;
  createdAt: string;
  lastSeenAt: string;
  active: boolean;
};

const BUCKET = "message-media";
const AVATARS = "avatars";
/** Πόσα μηνύματα έρχονται ανά σελίδα. Ίδιο με το default του list_messages. */
export const PAGE_SIZE = 50;
/** Ελάχιστο μήκος για ΝΕΟ κωδικό (εγγραφή, αλλαγή, επαναφορά). Η σύνδεση με
 *  παλιό, μικρότερο κωδικό δουλεύει κανονικά. */
export const MIN_PASSWORD = 8;

function db() {
  if (!supabase) throw new Error(t("err.notConfigured"));
  return supabase;
}

/** Πετάει σφάλμα στη γλώσσα του χρήστη. Το μήνυμα της βάσης, αν το ξέρουμε,
 *  μεταφράζεται· αλλιώς μπαίνει το γενικό μήνυμα της ενέργειας. */
function fail(fallback: TKey, error: { message?: string } | null): never {
  checkAccountOn(error);
  throw new Error(translateError(error?.message) || t(fallback));
}

/** Η βάση αρνήθηκε κάτι που ένας λογαριασμός σε αναστολή δεν μπορεί να κάνει
 *  (αποστολή, κλήση, ή οτιδήποτε με «Account suspended»). Το main.tsx
 *  ξανακοιτάζει το προφίλ (μία ανάγνωση) και, αν όντως είναι σε αναστολή,
 *  δείχνει την οθόνη αναστολής αντί για ένα app που απλώς «χαλάει». */
function checkAccountOn(error: { message?: string } | null) {
  if (
    /account suspended|not authenticated|cannot send messages|cannot call this/i.test(
      error?.message || "",
    )
  )
    window.dispatchEvent(new Event("mila:account-check"));
}

/** Σφάλμα αποστολής, με ό,τι χρειάζεται η ουρά αποστολής (outbox.ts):
 *  retry  — αξίζει να ξαναδοκιμαστεί μόνο του (δίκτυο, όρια, κλειδιά που
 *           άλλαξαν). Όχι όταν η απάντηση δεν θα αλλάξει (μπλοκαρισμένη
 *           συνομιλία, πολύ μεγάλο αρχείο).
 *  unsure — δεν ξέρουμε αν έφτασε (χάθηκε η απάντηση, έπεσε ο server). Τότε
 *           δεν σβήνεται τίποτα: μπορεί το μήνυμα να γράφτηκε. */
export type SendError = Error & { retry: boolean; unsure: boolean };

function sendError(message: string, retry: boolean, unsure = false): SendError {
  return Object.assign(new Error(message), { retry, unsure });
}

/** Ό,τι ξέρουμε ότι δεν θα περάσει όσες φορές κι αν ξαναδοκιμάσει. */
const HOPELESS =
  /cannot send messages to this conversation|message is too long|attachment does not belong|must be encrypted|not authenticated|account suspended/i;

async function currentUserId(): Promise<string> {
  const { data } = await db().auth.getUser();
  if (!data.user) throw new Error(t("err.signedOut"));
  return data.user.id;
}

/** Ίδιο, χωρίς κλήση στον server (από τη συνεδρία που κρατάει ο browser). Για
 *  ό,τι τρέχει σε κάθε ανανέωση της λίστας ή σε κάθε μήνυμα. */
async function sessionUserId(): Promise<string> {
  const { data } = await db().auth.getSession();
  if (!data.session?.user) throw new Error(t("err.signedOut"));
  return data.session.user.id;
}

/** «@username», ή τίποτα αν δεν υπάρχει. */
export const handleOf = (user: { username: string | null }) =>
  user.username ? `@${user.username}` : "";

// Τα αρχικά τα ζωγραφίζει το ίδιο το app. Πριν έρχονταν από την dicebear.com,
// που μάθαινε έτσι το όνομα κάθε επαφής και την IP όποιου άνοιγε τη λίστα.
const AVATAR_COLORS = ["#6d5dfc", "#2f80ed", "#1f9d7a", "#d9822b", "#c2417a", "#7a5af8"];

function initialsAvatar(name: string, background?: string): string {
  const letters =
    (name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => [...part][0] || "")
      .join("")
      .toUpperCase() || "?";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const fill = background || AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const safe = letters.replace(/[<>&'"]/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${fill}"/>` +
    `<text x="32" y="32" dy="0.35em" text-anchor="middle" fill="#fff" ` +
    `font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="26" font-weight="600">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Εικονίδιο ομάδας: σκούρο, ώστε να ξεχωρίζει από τους ανθρώπους με μια ματιά. */
export const groupAvatar = (name: string) => initialsAvatar(name || "?", "#272634");

// Signed URLs φωτογραφιών, για να μη ζητάμε καινούργιο σε κάθε ανανέωση της
// λίστας. Ισχύουν μία ώρα· τα ανανεώνουμε λίγο πριν.
const avatarUrls = new Map<string, { url: string; until: number }>();

async function withAvatars<T extends User>(users: T[]): Promise<T[]> {
  const now = Date.now();
  const missing = [
    ...new Set(
      users
        .map((u) => u.avatarPath)
        .filter((p): p is string => Boolean(p))
        .filter((p) => (avatarUrls.get(p)?.until || 0) < now),
    ),
  ];
  if (missing.length) {
    const { data } = await db()
      .storage.from(AVATARS)
      .createSignedUrls(missing, 3600);
    for (const item of data || [])
      if (item.path && item.signedUrl)
        avatarUrls.set(item.path, {
          url: item.signedUrl,
          until: now + 50 * 60 * 1000,
        });
  }
  return users.map((u) => ({
    ...u,
    avatar:
      (u.avatarPath && avatarUrls.get(u.avatarPath)?.url) ||
      initialsAvatar(u.name),
  }));
}

/** Από το profile_payload της βάσης στο User της οθόνης. */
function fromPayload<T extends Partial<User>>(raw: T): T & User {
  return {
    ...raw,
    email: raw.email ?? null,
    name: raw.name || "",
    username: raw.username ?? null,
    bio: raw.bio || "",
    avatarPath: raw.avatarPath ?? null,
    avatar: "",
    privacy: raw.privacy ?? null,
    presence: raw.presence ?? null,
  } as T & User;
}

async function usersFrom(data: unknown): Promise<User[]> {
  return withAvatars(((data || []) as Partial<User>[]).map(fromPayload));
}

type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  bio: string;
  avatar_path: string | null;
  discover_by_email: Privacy["discover"];
  show_email: Privacy["showEmail"];
  read_receipts: boolean;
  show_online: boolean;
  suspended_at?: string | null;
  suspended_reason?: string | null;
};

function toUser(row: ProfileRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.display_name,
    username:
      row.username ||
      row.email.split("@")[0].replace(/[^a-z0-9_.]/g, "") ||
      "user",
    bio: row.bio || "",
    avatarPath: row.avatar_path,
    avatar: initialsAvatar(row.display_name),
    privacy: {
      discover: row.discover_by_email,
      showEmail: row.show_email,
      receipts: row.read_receipts,
      online: row.show_online,
    },
    suspended: row.suspended_at
      ? { at: row.suspended_at, reason: row.suspended_reason || null }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Προφίλ
// ---------------------------------------------------------------------------

/**
 * Δίχτυ ασφαλείας: αν για κάποιο λόγο λείπει το προφίλ, το φτιάχνει η βάση από
 * το ΠΡΑΓΜΑΤΙΚΟ email του λογαριασμού. Αν υπάρχει ήδη, δεν αγγίζει τίποτα.
 *
 * Αντικατέστησε ένα upsert από τον browser που έτρεχε σε κάθε σύνδεση και
 * έγραφε από πάνω το bio και τις ρυθμίσεις privacy με τις προεπιλογές.
 */
export async function ensureProfile(preferredName?: string): Promise<void> {
  const { error } = await db().rpc("ensure_my_profile", {
    preferred_name: preferredName?.trim() || null,
  });
  if (error) console.warn("Profile check skipped:", error.message);
}

export async function getMe(): Promise<User> {
  const uid = await currentUserId();
  const { data, error } = await db()
    .from("profiles")
    .select("*")
    .eq("id", uid)
    .single();
  if (error || !data) fail("err.loadProfile", error);
  const [me] = await withAvatars([toUser(data as ProfileRow)]);
  return me;
}

export async function updateMe(patch: {
  name?: string;
  bio?: string;
  privacy?: Privacy;
}): Promise<User> {
  const uid = await currentUserId();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.display_name = patch.name.trim();
  if (patch.bio !== undefined) row.bio = patch.bio;
  if (patch.privacy) {
    row.discover_by_email = patch.privacy.discover;
    row.show_email = patch.privacy.showEmail;
    row.read_receipts = patch.privacy.receipts;
    row.show_online = patch.privacy.online;
  }
  const { data, error } = await db()
    .from("profiles")
    .update(row)
    .eq("id", uid)
    .select("*")
    .single();
  if (error || !data) fail("err.saveProfile", error);
  const [me] = await withAvatars([toUser(data as ProfileRow)]);
  return me;
}

// ---------------------------------------------------------------------------
// Φωτογραφία προφίλ
// ---------------------------------------------------------------------------

/**
 * Ξαναζωγραφίζει την εικόνα σε 256x256 (κεντραρισμένο τετράγωνο) και τη στέλνει
 * ως JPEG. Έτσι ανεβαίνουν λίγα KB, και φεύγουν τα EXIF της φωτογραφίας
 * (τοποθεσία, ώρα, μοντέλο κινητού): ο καμβάς κρατάει μόνο τα pixels.
 */
async function squareJpeg(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("err.avatar"));
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!blob) throw new Error(t("err.avatar"));
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function setAvatar(file: File): Promise<User> {
  if (!file.type.startsWith("image/")) throw new Error(t("err.avatarType"));
  const uid = await currentUserId();
  let blob: Blob;
  try {
    blob = await squareJpeg(file);
  } catch {
    throw new Error(t("err.avatarType"));
  }
  const path = `${uid}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await db()
    .storage.from(AVATARS)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (uploadError)
    throw new Error(
      /row-level security/i.test(uploadError.message)
        ? t("err.limitGeneric")
        : translateError(uploadError.message) || t("err.avatar"),
    );

  const { data, error } = await db().rpc("set_my_avatar", { path });
  if (error) {
    void db().storage.from(AVATARS).remove([path]);
    fail("err.avatar", error);
  }
  const previous = (data as { previous?: string | null } | null)?.previous;
  if (previous) void db().storage.from(AVATARS).remove([previous]);
  return getMe();
}

export async function removeAvatar(): Promise<User> {
  const { data, error } = await db().rpc("clear_my_avatar");
  if (error) fail("err.avatar", error);
  const previous = (data as { previous?: string | null } | null)?.previous;
  if (previous) await db().storage.from(AVATARS).remove([previous]);
  return getMe();
}

// ---------------------------------------------------------------------------
// Συσκευή και κλειδιά κρυπτογράφησης
// ---------------------------------------------------------------------------

let deviceFor: { userId: string; ready: Promise<DeviceKeys> } | null = null;

/**
 * Τα κλειδιά αυτής της συσκευής, δηλωμένα στον server. Η πρώτη κλήση τα
 * φτιάχνει (αν χρειάζεται) και τα δηλώνει· οι επόμενες παίρνουν το ίδιο.
 */
export function ensureDevice(): Promise<DeviceKeys> {
  const ready = (async () => {
    const uid = await sessionUserId();
    if (deviceFor?.userId === uid) return deviceFor.ready;
    const promise = registerThisDevice(uid);
    deviceFor = { userId: uid, ready: promise };
    // Αν αποτύχει (π.χ. δίκτυο), η επόμενη κλήση ξαναπροσπαθεί.
    promise.catch(() => {
      if (deviceFor?.ready === promise) deviceFor = null;
    });
    return promise;
  })();
  return ready;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const system = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, system].filter(Boolean).join(" · ");
}

async function registerThisDevice(uid: string): Promise<DeviceKeys> {
  if (!e2ee.supported) throw new Error(t("err.noCrypto"));
  for (let attempt = 0; attempt < 2; attempt++) {
    const device = await e2ee.loadOrCreateDevice(uid);
    const { data, error } = await db().rpc("register_device", {
      p_public_key: device.publicKey,
      p_label: deviceLabel(),
    });
    if (error) fail("err.device", error);
    const result = data as { id: string; revoked: boolean };
    if (!result.revoked) {
      return device.deviceId === result.id
        ? device
        : e2ee.rememberDeviceId(device, result.id);
    }
    // Ανακλήθηκε από άλλη συσκευή: τα παλιά κλειδιά δεν ισχύουν, φτιάχνουμε νέα.
    await e2ee.forgetDevice(uid);
  }
  throw new Error(t("err.device"));
}

export async function listMyDevices(): Promise<Device[]> {
  const { data, error } = await db().rpc("list_my_devices");
  if (error) fail("err.device", error);
  return (data || []) as Device[];
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const { error } = await db().rpc("revoke_device", { device: deviceId });
  if (error) fail("err.device", error);
  deviceKeyCache.clear();
}

/** Ο κωδικός ασφαλείας ανάμεσα σε εμένα και κάποιον άλλον (12 πεντάδες). */
export async function safetyCodeWith(userId: string): Promise<string[]> {
  const uid = await currentUserId();
  await ensureDevice();
  const [mine, theirs] = await Promise.all([
    db().rpc("user_device_keys", { target: uid }),
    db().rpc("user_device_keys", { target: userId }),
  ]);
  if (mine.error || theirs.error) fail("err.device", mine.error || theirs.error);
  const theirKeys = (theirs.data || []) as string[];
  if (!theirKeys.length) return [];
  return e2ee.safetyCode(
    { userId: uid, keys: (mine.data || []) as string[] },
    { userId, keys: theirKeys },
  );
}

export const fingerprint = e2ee.fingerprint;

// ---------------------------------------------------------------------------
// Παράδοση κλειδιών αργότερα (0012)
// ---------------------------------------------------------------------------
// Μηνύματα που έστειλε αυτή η συσκευή σε κάποιον που τότε δεν είχε κλειδί.
// Μόλις εκείνος αποκτήσει συσκευή, τους τυλίγουμε το κλειδί από εδώ. Τρέχει
// μόνο του σε κάθε ανανέωση της λίστας, το πολύ μία φορά στα 15 δευτερόλεπτα.

let delivering: Promise<number> | null = null;
let lastDelivery = 0;

type Undelivered = {
  messageId: string;
  conversationId: string;
  clientId: string;
  envelope: string;
  myKey: string;
  deviceId: string;
  publicKey: string;
};

export function deliverPendingKeys(): Promise<number> {
  if (delivering) return delivering;
  if (Date.now() - lastDelivery < 15_000) return Promise.resolve(0);
  delivering = (async () => {
    try {
      const uid = await sessionUserId();
      const device = await ensureDevice();
      const { data, error } = await db().rpc("my_undelivered_keys", {
        p_device: device.deviceId,
      });
      const rows = (error ? [] : (data as Undelivered[] | null)) || [];
      if (!rows.length) return 0;

      const byMessage = new Map<string, { first: Undelivered; to: Recipient[] }>();
      for (const row of rows) {
        const entry = byMessage.get(row.messageId) || { first: row, to: [] };
        entry.to.push({ deviceId: row.deviceId, publicKey: row.publicKey });
        byMessage.set(row.messageId, entry);
      }

      const keys: { message: string; device: string; key: string }[] = [];
      for (const [messageId, { first, to }] of byMessage) {
        try {
          const wrapped = await e2ee.rewrapForDevices(
            device,
            { conversationId: first.conversationId, senderId: uid, clientId: first.clientId },
            first.envelope,
            first.myKey,
            to,
          );
          for (const k of wrapped) keys.push({ message: messageId, ...k });
        } catch {
          // Ένα μήνυμα που δεν ανοίγει (π.χ. χαλασμένο) δεν σταματάει τα άλλα.
        }
      }
      if (!keys.length) return 0;

      const { data: added, error: addError } = await db().rpc("add_message_keys", {
        p_device: device.deviceId,
        keys,
      });
      const count = addError ? 0 : Number(added) || 0;
      if (count > 0) window.dispatchEvent(new Event("mila:keys-delivered"));
      return count;
    } catch {
      return 0;
    } finally {
      lastDelivery = Date.now();
      delivering = null;
    }
  })();
  return delivering;
}

// Ποιες συσκευές παίρνουν κλειδί για μια συνομιλία. Λίγα δευτερόλεπτα στη
// μνήμη· αν άλλαξε κάτι στο μεταξύ (νέο μέλος, νέα συσκευή), ο server το λέει
// στην αποστολή και ξαναζητάμε.
export type MemberDevice = Recipient & { userId: string };

const deviceKeyCache = new Map<string, { at: number; list: MemberDevice[] }>();

/** Οι ενεργές συσκευές όλων των μελών, με το δημόσιο κλειδί τους. Από εδώ οι
 *  κλήσεις ελέγχουν ότι μια συσκευή ανήκει πράγματι σε μέλος της συνομιλίας. */
export async function conversationDevices(
  conversationId: string,
  fresh = false,
): Promise<MemberDevice[]> {
  const cached = deviceKeyCache.get(conversationId);
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.list;
  const { data, error } = await db().rpc("conversation_device_keys", {
    conversation: conversationId,
  });
  if (error) fail("err.send", error);
  const list = (
    (data || []) as { userId: string; deviceId: string; publicKey: string }[]
  ).map((d) => ({ userId: d.userId, deviceId: d.deviceId, publicKey: d.publicKey }));
  deviceKeyCache.set(conversationId, { at: Date.now(), list });
  return list;
}

async function recipientsFor(
  conversationId: string,
  fresh = false,
): Promise<Recipient[]> {
  return (await conversationDevices(conversationId, fresh)).map((d) => ({
    deviceId: d.deviceId,
    publicKey: d.publicKey,
  }));
}

// ---------------------------------------------------------------------------
// Αποκρυπτογράφηση
// ---------------------------------------------------------------------------
// Ό,τι αποκρυπτογραφήθηκε μένει στη μνήμη (όχι στο δίσκο) για όσο είναι
// ανοιχτό το app: η λίστα συνομιλιών ανανεώνεται σε κάθε μήνυμα, και δεν
// αξίζει να ξαναγίνεται η ίδια δουλειά. Από εδώ γίνεται και η αναζήτηση.

const plainCache = new Map<string, MessagePlain | null>();
const knownMessages = new Map<string, Msg>();
/** Το τελευταίο περιεχόμενο κάθε μηνύματος, για την επεξεργασία και την
 *  προώθηση (θέλουν το αρχικό συνημμένο όπως ήταν μέσα στο μήνυμα). */
const latestPlain = new Map<string, MessagePlain>();

async function openPlain(
  device: DeviceKeys,
  id: string,
  conversationId: string,
  senderId: string,
  box: E2ee,
): Promise<MessagePlain | null> {
  // Το κλειδί περιλαμβάνει το τέλος του ciphertext (το tag του GCM, μοναδικό
  // σε κάθε κρυπτογράφηση): ένα μήνυμα που άλλαξε ξαναανοίγει.
  const cacheKey = `${id}|${box.envelope.length}|${box.envelope.slice(-32)}`;
  const cached = plainCache.get(cacheKey);
  if (cached) return cached;
  const plain = await e2ee.decryptMessage(device, conversationId, senderId, box);
  plainCache.set(cacheKey, plain);
  if (plain) latestPlain.set(id, plain);
  return plain;
}

async function decryptOne(device: DeviceKeys, m: Msg): Promise<Msg> {
  let out: Msg = m;
  if (m.e2ee && !m.deleted) {
    const plain = await openPlain(device, m.id, m.conversationId, m.senderId, m.e2ee);
    if (!plain) {
      // Κανένα κλειδί για ΚΑΜΙΑ συσκευή μου = δεν είχα συσκευή όταν στάλθηκε·
      // θα το φέρει ο αποστολέας. Κλειδιά για άλλες συσκευές μου αλλά όχι γι'
      // αυτήν = στάλθηκε πριν υπάρξει αυτή η συσκευή, και δεν θα έρθει ποτέ.
      const recent = Date.now() - Date.parse(m.createdAt) < 30 * 86400_000;
      const pendingKey =
        m.senderId !== device.userId &&
        recent &&
        Object.keys(m.e2ee.keys || {}).length === 0;
      out = { ...out, body: "", undecryptable: true, pendingKey, attachment: null };
    }
    else {
      out = { ...out, body: plain.t, undecryptable: false, forwarded: plain.fw === 1 };
      if (plain.f && m.attachment)
        out.attachment = {
          ...m.attachment,
          name: plain.f.n,
          mime: plain.f.m,
          size: plain.f.s,
          key: plain.f.k,
          iv: plain.f.i,
          duration: typeof plain.f.d === "number" ? plain.f.d : undefined,
          waveform: Array.isArray(plain.f.w) ? plain.f.w.slice(0, 64) : undefined,
          voice: plain.f.v === 1,
          poster:
            typeof plain.f.p === "string" && plain.f.p.startsWith("data:image/")
              ? plain.f.p
              : undefined,
          width: plain.f.wh?.[0],
          height: plain.f.wh?.[1],
        };
    }
  }
  const reply = m.replyTo;
  if (reply?.e2ee && !reply.deleted) {
    const plain = await openPlain(device, reply.id, m.conversationId, reply.senderId, reply.e2ee);
    out = {
      ...out,
      replyTo: plain
        ? { ...reply, body: plain.t.slice(0, 140), attachmentName: plain.f?.n || null }
        : { ...reply, body: "", undecryptable: true },
    };
  }
  if (out.body || out.attachment) knownMessages.set(out.id, out);
  return out;
}

async function decryptAll(messages: Msg[]): Promise<Msg[]> {
  if (!messages.some((m) => m.e2ee || m.replyTo?.e2ee)) return messages;
  const device = await ensureDevice();
  return Promise.all(messages.map((m) => decryptOne(device, m)));
}

// ---------------------------------------------------------------------------
// Λογαριασμός: εξαγωγή και διαγραφή
// ---------------------------------------------------------------------------

/** Όλα τα δεδομένα του χρήστη σε JSON (GDPR άρθρο 20). Δεν αλλάζει τίποτα. */
export async function exportMyData(): Promise<unknown> {
  const { data, error } = await db().rpc("export_my_data");
  if (error) fail("err.export", error);
  // Ο server δεν μπορεί να διαβάσει τα κρυπτογραφημένα μηνύματα· τα ανοίγουμε
  // εδώ, ώστε το αρχείο να έχει το κείμενό τους και όχι ciphertext.
  const payload = data as {
    messages?: Array<Record<string, unknown> & { conversation_id: string; e2ee?: E2ee | null }>;
  };
  if (payload?.messages?.some((m) => m.e2ee)) {
    const uid = await currentUserId();
    // Σε αναστολή η βάση δεν δέχεται πια τη δήλωση της συσκευής, αλλά τα
    // κλειδιά της είναι ακόμα εδώ και ανοίγουν τα δικά μου μηνύματα.
    const device = await ensureDevice().catch(() => e2ee.loadOrCreateDevice(uid));
    payload.messages = await Promise.all(
      payload.messages.map(async ({ e2ee: box, ...rest }) => {
        if (!box) return rest;
        const plain = await e2ee.decryptMessage(device, rest.conversation_id, uid, box);
        return plain
          ? { ...rest, body: plain.t, attachment_name: plain.f?.n ?? null }
          : { ...rest, body: null, note: t("export.otherDevice") };
      }),
    );
  }
  // Το ιστορικό κλήσεων το δίνει πλέον η ίδια η βάση (0014)· από εδώ μόνο αν
  // τρέχει ακόμα παλιότερη βάση.
  if ((payload as { calls?: unknown }).calls) return payload;
  const calls = await listCalls().catch(() => []);
  return { ...payload, calls };
}

export async function countMyUnencryptedMessages(): Promise<number> {
  const { data, error } = await db().rpc("count_my_unencrypted_messages");
  if (error) return 0;
  return Number(data) || 0;
}

/** Σβήνει για όλους τα παλιά μου μηνύματα που είναι σε απλό κείμενο. */
export async function deleteMyUnencryptedMessages(): Promise<number> {
  const { data, error } = await db().rpc("delete_my_unencrypted_messages");
  if (error) fail("err.deleteMessage", error);
  const result = data as { deleted?: number; paths?: string[] } | null;
  await removeFiles((result?.paths || []).filter(Boolean));
  return result?.deleted || 0;
}

/**
 * Διαγράφει οριστικά τον λογαριασμό. Δεν γυρίζει πίσω.
 *
 * Ο λογαριασμός στο auth φεύγει μέσα στο RPC, οπότε το token που κρατάει ο
 * browser αναφέρεται σε χρήστη που δεν υπάρχει πια. Το signOut από κάτω
 * καθαρίζει το localStorage· αν αποτύχει (λογικό, αφού ο χρήστης χάθηκε) δεν
 * μας νοιάζει — γι' αυτό το catch είναι σκόπιμα σιωπηλό.
 */
export async function deleteMyAccount(): Promise<void> {
  const uid = await currentUserId();
  // Η φωτογραφία σβήνεται από εδώ, όσο υπάρχει ακόμα λογαριασμός για να το
  // ζητήσει (η βάση δεν επιτρέπεται να σβήνει αρχεία η ίδια).
  const { data: me } = await db()
    .from("profiles")
    .select("avatar_path")
    .eq("id", uid)
    .maybeSingle();
  if (me?.avatar_path)
    await db().storage.from(AVATARS).remove([me.avatar_path]).catch(() => undefined);

  const { error } = await db().rpc("delete_my_account");
  if (error) fail("err.deleteAccount", error);
  // Τα κλειδιά αυτής της συσκευής δεν χρησιμεύουν πια σε τίποτα.
  await e2ee.forgetDevice(uid);
  await db()
    .auth.signOut()
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Αναζήτηση ανθρώπων
// ---------------------------------------------------------------------------

/** Ολόκληρη διεύθυνση email; Μόνο τότε βγαίνουν άνθρωποι που δεν ξέρω ήδη. */
export const looksLikeEmail = (term: string) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(term.trim());

export async function searchUsers(term: string): Promise<User[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await db().rpc("search_profiles", {
    search_term: trimmed,
  });
  if (error) fail("err.search", error);
  return usersFrom(data);
}

export async function matchContacts(hashes: string[]): Promise<User[]> {
  if (!hashes.length) return [];
  const { data, error } = await db().rpc("match_contacts", {
    email_hashes: hashes.slice(0, 500),
  });
  if (error) fail("err.matchContacts", error);
  return usersFrom(data);
}

// ---------------------------------------------------------------------------
// Συνημμένα
// ---------------------------------------------------------------------------

// Ο bucket message-media είναι private. Τα ΠΑΛΙΑ συνημμένα (πριν την
// κρυπτογράφηση) θέλουν βραχύβιο signed URL. Τα κρυπτογραφημένα κατεβαίνουν,
// αποκρυπτογραφούνται εδώ και γίνονται blob: URL, που ζει μόνο σε αυτή τη
// σελίδα. Τις εικόνες τις ανοίγουμε αμέσως (φαίνονται μέσα στη συνομιλία)· τα
// υπόλοιπα αρχεία μόνο όταν τα πατήσει ο χρήστης (openAttachment).
const decryptedFiles = new Map<string, string>();

async function decryptedUrl(attachment: Attachment): Promise<string> {
  const known = decryptedFiles.get(attachment.path);
  if (known) return known;
  const { data, error } = await db().storage.from(BUCKET).download(attachment.path);
  if (error || !data) throw new Error(t("err.download"));
  const plain = await e2ee.decryptFile(
    await data.arrayBuffer(),
    attachment.key!,
    attachment.iv!,
  );
  const url = URL.createObjectURL(new Blob([plain], { type: attachment.mime }));
  decryptedFiles.set(attachment.path, url);
  // Όριο στη μνήμη: οι παλαιότερες εικόνες απελευθερώνονται.
  if (decryptedFiles.size > 150) {
    const [oldest, oldUrl] = decryptedFiles.entries().next().value!;
    decryptedFiles.delete(oldest);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

async function withMedia(messages: Msg[]): Promise<Msg[]> {
  const legacy = messages
    .map((m) => m.attachment)
    .filter((a): a is Attachment => Boolean(a?.path && !a.key))
    .map((a) => a.path);

  const urls = new Map<string, string>();
  if (legacy.length) {
    const { data } = await db()
      .storage.from(BUCKET)
      .createSignedUrls([...new Set(legacy)], 3600);
    for (const item of data || [])
      if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  return Promise.all(
    messages.map(async (m) => {
      const a = m.attachment;
      if (!a?.path) return m;
      if (!a.key) return { ...m, attachment: { ...a, url: urls.get(a.path) || "" } };
      if (!a.mime.startsWith("image/")) return m;
      try {
        return { ...m, attachment: { ...a, url: await decryptedUrl(a) } };
      } catch {
        return m;
      }
    }),
  );
}

/** Διεύθυνση για <audio>/<video>/<img>: αποκρυπτογραφημένο blob: URL, ή το
 *  signed URL των παλιών, μη κρυπτογραφημένων συνημμένων. */
export async function mediaUrl(attachment: Attachment): Promise<string> {
  if (attachment.key) return decryptedUrl(attachment);
  if (attachment.url) return attachment.url;
  throw new Error(t("err.download"));
}

/** Ανοίγει / κατεβάζει ένα συνημμένο που δεν φαίνεται ήδη στην οθόνη. */
export async function openAttachment(attachment: Attachment): Promise<void> {
  const url = attachment.key ? await decryptedUrl(attachment) : attachment.url;
  if (!url) throw new Error(t("err.download"));
  const link = document.createElement("a");
  link.href = url;
  if (attachment.key) link.download = attachment.name;
  else {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Κρυπτογραφεί το αρχείο εδώ και ανεβάζει μόνο το αποτέλεσμα. Όνομα, τύπος και
 * κλειδί του δεν πάνε στο storage· πάνε μέσα στο κρυπτογραφημένο μήνυμα.
 */
export async function uploadAttachment(
  file: File,
  conversationId: string,
  info: MediaInfo = {},
): Promise<NewAttachment> {
  if (file.size > MAX_FILE) throw sendError(t("err.fileTooLarge"), false);

  const uid = await currentUserId();
  const sealed = await e2ee.encryptFile(await file.arrayBuffer());
  // Ο πρώτος φάκελος ΠΡΕΠΕΙ να είναι το uid: το απαιτούν το policy του storage
  // και το send_message. Χωρίς κατάληξη: δεν λέμε στον server τι αρχείο είναι.
  const path = `${uid}/${conversationId}/${crypto.randomUUID()}`;

  const { error } = await db()
    .storage.from(BUCKET)
    .upload(path, sealed.blob, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (error)
    throw sendError(
      /row-level security/i.test(error.message)
        ? t("err.limitUploads")
        : /maximum allowed size|too large/i.test(error.message)
          ? t("err.fileTooLarge")
          : translateError(error.message) || t("err.upload"),
      !/maximum allowed size|too large/i.test(error.message),
    );

  return {
    ...info,
    path,
    name: file.name.slice(0, 180),
    mime: file.type || "application/octet-stream",
    size: file.size,
    uploadSize: sealed.blob.size,
    key: sealed.key,
    iv: sealed.iv,
  };
}

/** Το περιεχόμενο του συνημμένου όπως μπαίνει μέσα στο κρυπτογραφημένο μήνυμα. */
function plainFile(file: NewAttachment): NonNullable<MessagePlain["f"]> {
  const f: NonNullable<MessagePlain["f"]> = {
    n: file.name,
    m: file.mime,
    s: file.size,
    k: file.key,
    i: file.iv,
  };
  if (typeof file.duration === "number" && Number.isFinite(file.duration))
    f.d = Math.round(file.duration * 10) / 10;
  if (file.waveform?.length) f.w = file.waveform.slice(0, 64).map((x) => Math.max(0, Math.min(31, Math.round(x))));
  if (file.voice) f.v = 1;
  if (file.poster) f.p = file.poster;
  if (file.width && file.height) f.wh = [Math.round(file.width), Math.round(file.height)];
  return f;
}

/** Σβήνει αρχεία από το storage. Best-effort: αν αποτύχει, μένει ορφανό αρχείο
 *  που δεν το δείχνει πια κανένα μήνυμα — δεν αξίζει να ενοχλήσει τον χρήστη. */
async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await db().storage.from(BUCKET).remove(paths);
  if (error) console.warn("Could not remove files:", error.message);
}

/** Ένα αρχείο που ανέβηκε για μήνυμα που τελικά δεν θα σταλεί. */
export function discardUpload(file: NewAttachment): Promise<void> {
  return removeFiles([file.path]);
}

// ---------------------------------------------------------------------------
// Συνομιλίες
// ---------------------------------------------------------------------------

export async function listChats(): Promise<Chat[]> {
  const { data, error } = await db().rpc("list_conversations");
  if (error) fail("err.loadChats", error);
  const raw = (data || []) as Chat[];

  // Όλες οι φωτογραφίες με μία κλήση, όχι μία ανά συνομιλία.
  const people = await withAvatars(
    raw.flatMap((c) => c.others.map((u) => fromPayload(u) as Member)),
  );
  const byId = new Map(people.map((u) => [u.id, u]));

  const lasts = await decryptAll(
    raw.map((c) => c.last).filter((m): m is Msg => Boolean(m)),
  ).catch(() => null);
  const lastById = new Map((lasts || []).map((m) => [m.id, m]));

  // Ό,τι μου ήρθε έφτασε: δύο γκρι τικ για τον αποστολέα.
  markDelivered();

  return raw.map((c) => ({
    ...c,
    others: c.others.map((u) => ({ ...(byId.get(u.id) || fromPayload(u)), role: u.role })),
    last: c.last ? lastById.get(c.last.id) || { ...c.last, undecryptable: Boolean(c.last.e2ee) } : c.last,
  }));
}

let delivering0: Promise<void> | null = null;
let lastDelivered = 0;
let deliverLater: number | undefined;

/** «Παραδόθηκε». Το πολύ μία κλήση στα 3 δευτερόλεπτα: η λίστα ανανεώνεται σε
 *  κάθε γεγονός, και μία κλήση καλύπτει όλα τα μηνύματα. Ό,τι ζητηθεί στο
 *  μεταξύ δεν χάνεται: γίνεται μία φορά ακόμα, μόλις περάσει το διάστημα. */
function markDelivered(): void {
  const wait = 3000 - (Date.now() - lastDelivered);
  if (delivering0 || wait > 0) {
    if (deliverLater === undefined)
      deliverLater = window.setTimeout(() => {
        deliverLater = undefined;
        markDelivered();
      }, Math.max(wait, 400));
    return;
  }
  delivering0 = (async () => {
    try {
      await db().rpc("mark_delivered");
    } catch {
      // Το «παραδόθηκε» είναι πληροφορία, όχι λειτουργία· δεν αξίζει σφάλμα.
    } finally {
      lastDelivered = Date.now();
      delivering0 = null;
    }
  })();
}

/**
 * Μία σελίδα μηνυμάτων, από τα παλαιότερα προς τα νεότερα.
 * Χωρίς beforeId: τα πιο πρόσφατα. Με beforeId: τα αμέσως παλαιότερα από αυτό.
 */
export async function listMessages(
  conversationId: string,
  beforeId?: string,
): Promise<{ messages: Msg[]; hasMore: boolean }> {
  const { data, error } = await db().rpc("list_messages", {
    conversation: conversationId,
    before_message: beforeId ?? null,
    page_size: PAGE_SIZE,
  });
  if (error) fail("err.loadMessages", error);
  const page = (data || []) as Msg[];
  return {
    messages: await withMedia(await decryptAll(page)),
    hasMore: page.length === PAGE_SIZE,
  };
}

/** Ένα μήνυμα, φρέσκο. null αν δεν υπάρχει πια για μένα. */
export async function getMessage(messageId: string): Promise<Msg | null> {
  const { data, error } = await db().rpc("get_message", { message: messageId });
  if (error || !data) return null;
  const [ready] = await withMedia(await decryptAll([data as Msg]));
  return ready;
}

export async function startChat(userId: string): Promise<string> {
  const { data, error } = await db().rpc("start_direct_conversation", {
    target_user: userId,
  });
  if (error || !data) fail("err.startChat", error);
  return data as string;
}

export async function sendMessage(
  conversationId: string,
  body: string,
  options: {
    replyTo?: string;
    attachment?: NewAttachment;
    forwarded?: boolean;
    /** Σε επανάληψη: το ίδιο με την πρώτη φορά, ώστε η βάση να μη γράψει το
     *  μήνυμα δεύτερη φορά αν η πρώτη είχε τελικά περάσει. */
    clientId?: string;
    /** Το αρχείο μένει στο storage ακόμα κι αν αποτύχει: το κρατάει ο καλών
     *  για να ξαναδοκιμάσει (outbox.ts). */
    keepFile?: boolean;
  } = {},
): Promise<void> {
  const uid = await sessionUserId();
  const device = await ensureDevice();
  const clientId = options.clientId || crypto.randomUUID();
  const file = options.attachment;
  const plain: MessagePlain = { t: body };
  if (file) plain.f = plainFile(file);
  if (options.forwarded) plain.fw = 1;

  // Δύο προσπάθειες: αν στο μεταξύ μπήκε νέο μέλος ή νέα συσκευή, ο server
  // απαντάει «out of date» και ξανακρυπτογραφούμε με φρέσκια λίστα κλειδιών.
  let lastError: { message?: string } | null = null;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const recipients = await recipientsFor(conversationId, attempt > 0);
    const sealed = await e2ee.encryptMessage(
      device,
      { conversationId, senderId: uid, clientId },
      plain,
      recipients,
    );
    const { error, status } = await db().rpc("send_message", {
      conversation: conversationId,
      body: sealed.envelope,
      client_id: clientId,
      sender_device: device.deviceId,
      keys: sealed.keys,
      reply_to_message: options.replyTo ?? null,
      attachment: file ? { path: file.path, size: file.uploadSize } : null,
    });
    if (!error) {
      return;
    }
    lastError = error;
    lastStatus = status;
    if (!/out of date/i.test(error.message)) break;
  }
  // Χωρίς απάντηση (status 0: δίκτυο) ή με σφάλμα του server (5xx), δεν
  // ξέρουμε αν το μήνυμα γράφτηκε.
  const unsure = lastStatus === 0 || lastStatus >= 500;
  // Το μήνυμα δεν γράφτηκε, άρα το αρχείο που ανέβηκε δεν θα το δείξει ποτέ
  // κανείς. Το μαζεύουμε — εκτός αν μπορεί να γράφτηκε, ή αν το κρατάει ο καλών.
  if (file && !unsure && !options.keepFile) void removeFiles([file.path]);
  if (/unknown sending device/i.test(lastError?.message || "")) deviceFor = null;
  checkAccountOn(lastError);
  throw sendError(
    translateError(lastError?.message) || t("err.send"),
    !HOPELESS.test(lastError?.message || ""),
    unsure,
  );
}

/**
 * forEveryone = false: κρύβεται μόνο από εμένα.
 * forEveryone = true : σβήνεται για όλους (μόνο δικό μου μήνυμα). Η βάση
 * επιστρέφει τα αρχεία του, και τα σβήνουμε από το storage από εδώ — η βάση
 * δεν επιτρέπεται να το κάνει η ίδια.
 */
export async function deleteMessage(
  messageId: string,
  forEveryone: boolean,
): Promise<void> {
  const { data, error } = await db().rpc("delete_message", {
    message: messageId,
    for_everyone: forEveryone,
  });
  if (error) fail("err.deleteMessage", error);
  const paths = ((data as { paths?: string[] } | null)?.paths || []).filter(
    Boolean,
  );
  await removeFiles(paths);
}

/** Αλλάζει το κείμενο ενός δικού μου μηνύματος (μέσα σε 15 λεπτά). Το νέο
 *  κείμενο κρυπτογραφείται ξανά για όλες τις συσκευές· το συνημμένο μένει. */
export async function editMessage(message: Msg, text: string): Promise<void> {
  const uid = await sessionUserId();
  const device = await ensureDevice();
  const clientId = message.e2ee?.clientId;
  const before = latestPlain.get(message.id);
  if (!clientId || !before || message.senderId !== uid) fail("err.edit", null);
  const plain: MessagePlain = { ...before, t: text };

  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const recipients = await recipientsFor(message.conversationId, attempt > 0);
    const sealed = await e2ee.encryptMessage(
      device,
      { conversationId: message.conversationId, senderId: uid, clientId },
      plain,
      recipients,
    );
    const { error } = await db().rpc("edit_message", {
      message: message.id,
      body: sealed.envelope,
      sender_device: device.deviceId,
      keys: sealed.keys,
    });
    if (!error) return;
    lastError = error;
    if (!/out of date/i.test(error.message)) break;
  }
  if (/unknown sending device/i.test(lastError?.message || "")) deviceFor = null;
  fail("err.edit", lastError);
}

/**
 * Προώθηση σε άλλες συνομιλίες. Το αρχείο δεν ξανακρυπτογραφείται: το ίδιο
 * κρυπτογραφημένο περιεχόμενο ανεβαίνει σε νέα θέση, και το κλειδί του πάει
 * μέσα στο νέο κρυπτογραφημένο μήνυμα, όπως και στο αρχικό.
 */
export async function forwardMessage(
  message: Msg,
  conversationIds: string[],
): Promise<void> {
  const uid = await sessionUserId();
  const source = message.attachment;
  let sealedBlob: Blob | null = null;
  if (source?.key) {
    const { data, error } = await db().storage.from(BUCKET).download(source.path);
    if (error || !data) throw new Error(t("err.download"));
    sealedBlob = data;
  }
  for (const target of conversationIds) {
    let attachment: NewAttachment | undefined;
    if (source && sealedBlob) {
      const path = `${uid}/${target}/${crypto.randomUUID()}`;
      const { error } = await db()
        .storage.from(BUCKET)
        .upload(path, sealedBlob, { contentType: "application/octet-stream", upsert: false });
      if (error)
        throw new Error(
          /row-level security/i.test(error.message)
            ? t("err.limitUploads")
            : translateError(error.message) || t("err.upload"),
        );
      attachment = {
        path,
        name: source.name,
        mime: source.mime,
        size: source.size,
        uploadSize: sealedBlob.size,
        key: source.key!,
        iv: source.iv!,
        duration: source.duration,
        waveform: source.waveform,
        voice: source.voice,
        poster: source.poster,
        width: source.width,
        height: source.height,
      };
    } else if (source?.url) {
      // Παλιό, μη κρυπτογραφημένο συνημμένο: το κατεβάζουμε και το στέλνουμε
      // κανονικά, κρυπτογραφημένο αυτή τη φορά.
      const blob = await fetch(source.url).then((r) => r.blob());
      attachment = await uploadAttachment(
        new File([blob], source.name, { type: source.mime }),
        target,
      );
    }
    await sendMessage(target, message.body, { attachment, forwarded: true });
  }
}

/** Σίγαση (μέχρι πότε, ή null), αρχείο, καρφίτσωμα. Μόνο για μένα. */
export async function setChatPrefs(
  conversationId: string,
  prefs: { mutedUntil?: string | null; archived?: boolean; pinned?: boolean },
): Promise<void> {
  const { error } = await db().rpc("set_conversation_prefs", {
    conversation: conversationId,
    prefs,
  });
  if (error) fail("err.generic", error);
}

/** Ίδιο emoji δεύτερη φορά = αφαίρεση. Το χειρίζεται η βάση. */
export async function react(messageId: string, emoji: string): Promise<void> {
  const { error } = await db().rpc("react_to_message", {
    message: messageId,
    reaction: emoji,
  });
  if (error) fail("err.react", error);
}

/**
 * Ο server βλέπει μόνο ciphertext, άρα δεν μπορεί να ψάξει μέσα στα
 * κρυπτογραφημένα. Ψάχνουμε εδώ, σε ό,τι έχει ήδη ανοίξει αυτή η συσκευή
 * (λίστα συνομιλιών και ό,τι φορτώθηκε), και ζητάμε από τον server μόνο τα
 * παλιά, μη κρυπτογραφημένα.
 */
export async function searchMessages(
  term: string,
  conversationId?: string,
): Promise<Msg[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const needle = trimmed.toLocaleLowerCase();
  const local = [...knownMessages.values()].filter(
    (m) =>
      !m.deleted &&
      (!conversationId || m.conversationId === conversationId) &&
      (m.body.toLocaleLowerCase().includes(needle) ||
        (m.attachment?.name || "").toLocaleLowerCase().includes(needle)),
  );
  const { data, error } = await db().rpc("search_messages", {
    search_term: trimmed,
    conversation: conversationId ?? null,
  });
  const legacy = error ? [] : ((data || []) as Msg[]);
  const merged = new Map<string, Msg>();
  for (const m of [...local, ...legacy]) merged.set(m.id, m);
  return [...merged.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50);
}

export async function markRead(conversationId: string): Promise<void> {
  const { error } = await db().rpc("mark_conversation_read", {
    conversation: conversationId,
  });
  if (error) console.warn("Could not mark as read:", error.message);
}

export async function respondToRequest(
  conversationId: string,
  accept: boolean,
): Promise<void> {
  const { error } = await db().rpc("respond_to_request", {
    conversation: conversationId,
    accept,
  });
  if (error) fail("err.respond", error);
}

// ---------------------------------------------------------------------------
// Ομάδες
// ---------------------------------------------------------------------------

export async function createGroup(
  name: string,
  memberIds: string[],
): Promise<string> {
  const { data, error } = await db().rpc("create_group", {
    group_name: name,
    member_ids: memberIds,
  });
  if (error || !data) fail("err.createGroup", error);
  return data as string;
}

export async function addGroupMembers(
  conversationId: string,
  memberIds: string[],
): Promise<void> {
  const { error } = await db().rpc("add_group_members", {
    conversation: conversationId,
    member_ids: memberIds,
  });
  if (error) fail("err.addMembers", error);
}

/** userId = εγώ: αποχωρώ. Άλλος: τον βγάζω (μόνο admin). */
export async function removeGroupMember(
  conversationId: string,
  userId: string,
): Promise<void> {
  const { error } = await db().rpc("remove_group_member", {
    conversation: conversationId,
    target: userId,
  });
  if (error) fail("err.removeMember", error);
}

export async function renameGroup(
  conversationId: string,
  name: string,
): Promise<void> {
  const { error } = await db().rpc("rename_group", {
    conversation: conversationId,
    new_name: name,
  });
  if (error) fail("err.renameGroup", error);
}

// ---------------------------------------------------------------------------
// Αποκλεισμός και αναφορές
// ---------------------------------------------------------------------------

export async function blockUser(userId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await db()
    .from("blocks")
    .insert({ blocker_id: uid, blocked_id: userId });
  // 23505 = τον έχω ήδη μπλοκάρει. Δεν είναι σφάλμα.
  if (error && error.code !== "23505") fail("err.block", error);
}

export async function unblockUser(userId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await db()
    .from("blocks")
    .delete()
    .eq("blocker_id", uid)
    .eq("blocked_id", userId);
  if (error) fail("err.unblock", error);
}

export async function listBlocked(): Promise<User[]> {
  const { data, error } = await db().rpc("list_blocked");
  if (error) fail("err.loadBlocked", error);
  return usersFrom(data);
}

/**
 * Αναφορά για μήνυμα (messageId), ομάδα (μόνο conversationId) ή άνθρωπο
 * (userId). Το excerpt είναι κείμενο που ΗΔΗ βλέπει ο χρήστης και επέλεξε
 * ρητά να σταλεί στους συντονιστές: χωρίς αυτό, δεν διαβάζουν τίποτα, αφού τα
 * μηνύματα είναι κρυπτογραφημένα.
 */
export async function sendReport(report: {
  reason: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  excerpt?: string;
}): Promise<void> {
  const { error } = await db().rpc("submit_report", {
    p_reason: report.reason.slice(0, 500),
    p_user: report.userId ?? null,
    p_conversation: report.conversationId ?? null,
    p_message: report.messageId ?? null,
    p_excerpt: report.excerpt?.slice(0, 4000) || null,
  });
  if (error) fail("err.report", error);
}

// ---------------------------------------------------------------------------
// Ειδοποιήσεις (push)
// ---------------------------------------------------------------------------

export async function savePushSubscription(subscription: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  const { error } = await db().rpc("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.p256dh,
    p_auth: subscription.auth,
    p_user_agent: navigator.userAgent.slice(0, 200),
  });
  if (error) fail("err.pushSave", error);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const { error } = await db().rpc("remove_push_subscription", {
    p_endpoint: endpoint,
  });
  if (error) console.warn("Could not remove push subscription:", error.message);
}

/** Το δημόσιο κλειδί με το οποίο ο browser «δένει» τη συνδρομή του στο Mila. */
export async function pushPublicKey(): Promise<string> {
  const { data, error } = await db().functions.invoke("push", {
    body: { action: "public-key" },
  });
  const key = (data as { publicKey?: string } | null)?.publicKey;
  if (error || !key) fail("err.pushUnavailable", null);
  return key as string;
}

// ---------------------------------------------------------------------------
// Κλήσεις
// ---------------------------------------------------------------------------
// Η βάση κρατάει μόνο ποιος κάλεσε ποιον και πότε (0013). Η ίδια η σύνδεση
// είναι στο calls.ts.

async function callRpc(fn: string, args: Record<string, unknown>): Promise<Call> {
  const { data, error } = await db().rpc(fn, args);
  if (error || !data) fail("err.call", error);
  return data as Call;
}

export async function startCall(conversationId: string, video: boolean): Promise<Call> {
  const device = await ensureDevice();
  return callRpc("start_call", {
    p_conversation: conversationId,
    p_video: video,
    p_device: device.deviceId,
  });
}

export async function joinCall(callId: string): Promise<Call> {
  const device = await ensureDevice();
  return callRpc("join_call", { p_call: callId, p_device: device.deviceId });
}

export const declineCall = (callId: string) => callRpc("decline_call", { p_call: callId });
export const leaveCall = (callId: string) => callRpc("leave_call", { p_call: callId });
/** Σαν το leaveCall, όταν η σύνδεση δεν στήθηκε ποτέ: στο ιστορικό «δεν συνδέθηκε». */
export const failCall = (callId: string) => callRpc("fail_call", { p_call: callId });
export const callHeartbeat = (callId: string) => callRpc("call_heartbeat", { p_call: callId });

export async function getCall(callId: string): Promise<Call | null> {
  const { data, error } = await db().rpc("get_call", { p_call: callId });
  if (error) return null;
  return (data as Call | null) || null;
}

/** Ιστορικό κλήσεων: όλο, ή μιας συνομιλίας από κάποια στιγμή και μετά. */
export async function listCalls(conversationId?: string, since?: string): Promise<Call[]> {
  const { data, error } = await db().rpc("list_calls", {
    p_conversation: conversationId ?? null,
    p_since: since ?? null,
    p_limit: conversationId ? 300 : 150,
  });
  if (error) fail("err.loadCalls", error);
  return (data || []) as Call[];
}

let iceCache: { until: number; servers: RTCIceServer[]; relay: boolean } | null = null;

/** Οι servers που βοηθούν δύο συσκευές να βρεθούν (STUN και, αν έχει
 *  ρυθμιστεί, TURN). Αν η function δεν απαντά, φτάνουν οι δημόσιοι STUN. */
export async function iceServers(): Promise<{ servers: RTCIceServer[]; relay: boolean }> {
  if (iceCache && iceCache.until > Date.now()) return iceCache;
  try {
    const { data, error } = await db().functions.invoke("push", {
      body: { action: "ice" },
    });
    const result = data as { iceServers?: RTCIceServer[]; ttl?: number; relay?: boolean } | null;
    if (error || !result?.iceServers?.length) throw error || new Error("no ice servers");
    iceCache = {
      servers: result.iceServers,
      relay: Boolean(result.relay),
      until: Date.now() + Math.max(60, (result.ttl || 3600) - 300) * 1000,
    };
    return iceCache;
  } catch {
    return {
      servers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }],
      relay: false,
    };
  }
}

/** Νέα κλήση ή αλλαγή σε κλήση (απάντησε κάποιος, έκλεισε) σε συνομιλία μου.
 *  Το RLS φέρνει μόνο ό,τι αφορά τις δικές μου συνομιλίες. Το onReady τρέχει
 *  κάθε φορά που το κανάλι (ξανα)συνδέεται: ό,τι έγινε πριν δεν ξανάρχεται. */
export function subscribeToCalls(
  onChange: (callId: string) => void,
  onReady?: () => void,
): RealtimeChannel {
  const pick = (key: string) => (payload: { new?: unknown }) => {
    const row = payload.new as Record<string, unknown> | undefined;
    if (typeof row?.[key] === "string") onChange(row[key] as string);
  };
  const channel = db()
    .channel("mila-calls")
    .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, pick("id"))
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_participants" },
      pick("call_id"),
    );
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onReady?.();
  });
  return channel;
}

// ---------------------------------------------------------------------------
// «Σε σύνδεση»
// ---------------------------------------------------------------------------

export async function touchPresence(online: boolean): Promise<void> {
  try {
    const { error } = await db().rpc("touch_presence", { online });
    // Δεν είναι λόγος να ενοχληθεί ο χρήστης. Είναι όμως ο πρώτος που μαθαίνει
    // (μέσα σε 30'') ότι ο λογαριασμός μπήκε σε αναστολή.
    if (error) checkAccountOn(error);
  } catch {
    // Ούτε το δίκτυο.
  }
}

export async function getPresence(userId: string): Promise<Presence | null> {
  const { data, error } = await db().rpc("get_presence", { target: userId });
  if (error) return null;
  return (data as Presence | null) || null;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

// Για τη ΛΙΣΤΑ συνομιλιών: οτιδήποτε αλλάξει, ξαναφορτώνει. Το RLS ισχύει στα
// postgres_changes, οπότε ο κάθε χρήστης ακούει μόνο τις δικές του συνομιλίες.
export function subscribeToChanges(onChange: () => void): RealtimeChannel {
  const channel = db()
    .channel("mila-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_receipts" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversation_members" },
      onChange,
    )
    // Ήρθε κλειδί για μήνυμα που περίμενα (0012). Το RLS στέλνει μόνο τα δικά μου.
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_keys" },
      onChange,
    )
    // Κλήσεις: η λίστα δείχνει την τελευταία («Αναπάντητη κλήση»).
    .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, onChange);
  channel.subscribe();
  return channel;
}

// Για την ΑΝΟΙΧΤΗ συνομιλία: τι μπήκε και τι άλλαξε, με φίλτρο στη συνομιλία
// ώστε να μη φτάνει εδώ η κίνηση των υπολοίπων.
export function subscribeToConversation(
  conversationId: string,
  handlers: {
    /** Μπήκε μήνυμα ή άλλαξε το «διαβάστηκε»: ξαναφέρε την τελευταία σελίδα. */
    onRefresh: () => void;
    onMessageChanged: (messageId: string) => void;
  },
): RealtimeChannel {
  const filter = `conversation_id=eq.${conversationId}`;
  const idOf = (payload: { new?: unknown; old?: unknown }, key: string) => {
    const row = (payload.new && Object.keys(payload.new).length
      ? payload.new
      : payload.old) as Record<string, unknown> | undefined;
    return typeof row?.[key] === "string" ? (row[key] as string) : "";
  };
  const channel = db()
    .channel(`conversation:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter },
      handlers.onRefresh,
    )
    // Κλειδί που ήρθε αργότερα για μήνυμα που ήδη βλέπω κλειδωμένο. Το
    // message_keys δεν έχει conversation_id για φίλτρο· το RLS όμως στέλνει
    // μόνο τα δικά μου, οπότε είναι λίγα.
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_keys" },
      handlers.onRefresh,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter },
      (payload) => {
        const id = idOf(payload, "id");
        if (id) handlers.onMessageChanged(id);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_reactions", filter },
      (payload) => {
        const id = idOf(payload, "message_id");
        if (id) handlers.onMessageChanged(id);
      },
    )
    // «Διαβάστηκε»: τα receipts των άλλων δεν φτάνουν εδώ (το RLS δείχνει στον
    // καθένα μόνο τα δικά του). Το σήμα είναι το last_read_at του μέλους, που
    // η βάση το ενημερώνει μόνο αν εκείνος έχει ανοιχτά τα read receipts.
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversation_members",
        filter,
      },
      handlers.onRefresh,
    );
  channel.subscribe();
  return channel;
}

export type Activity = "typing" | "recording";

// Το "γράφει..." (και το «ηχογραφεί...») είναι εφήμερο και δεν αποθηκεύεται
// πουθενά, οπότε πάει από Broadcast αντί για τη βάση.
export function subscribeToTyping(
  conversationId: string,
  onTyping: (active: boolean, userId: string, activity: Activity) => void,
): RealtimeChannel {
  const channel = db()
    .channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      onTyping(
        Boolean(payload?.active),
        String(payload?.userId || ""),
        payload?.activity === "recording" ? "recording" : "typing",
      );
    });
  channel.subscribe();
  return channel;
}

/** Το userId το δίνει ο καλών (το ξέρει ήδη): έτσι η αποστολή γίνεται ΑΜΕΣΩΣ και
 *  όχι μετά από ένα await — αλλιώς το «σταμάτησα να γράφω» που στέλνεται όταν
 *  κλείνει η συνομιλία έφευγε αφού το κανάλι είχε ήδη κλείσει. */
export function sendTyping(
  channel: RealtimeChannel | null,
  active: boolean,
  userId: string,
  activity: Activity = "typing",
): void {
  if (!channel) return;
  try {
    void Promise.resolve(
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: { active, userId, activity },
      }),
    ).catch(() => undefined);
  } catch {
    // Κλειστό κανάλι: το «γράφει…» είναι διακοσμητικό, δεν αξίζει σφάλμα.
  }
}

export function unsubscribe(channel: RealtimeChannel | null): void {
  if (channel) void supabase?.removeChannel(channel);
}
