// Data layer πάνω από το Supabase. Ό,τι μιλάει με τη βάση περνάει από εδώ,
// ώστε τα components να μην ξέρουν τίποτα για RPCs, πίνακες ή storage.
//
// Τα σχήματα (User, Msg, Chat) τα φτιάχνει η βάση, στα profile_payload /
// message_payload / list_conversations. Αν αλλάξει κάτι εκεί, αλλάζει κι εδώ.

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { t, translateError } from "./i18n";
import type { TKey } from "./i18n";

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
  avatar: string;
  deleted?: boolean;
  privacy: Privacy;
};

export type Member = User & { role?: "member" | "admin" };

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  url?: string;
};

export type Reaction = { userId: string; emoji: string };

export type ReplyPreview = {
  id: string;
  senderId: string;
  senderName: string | null;
  body: string;
  deleted: boolean;
  attachmentName: string | null;
};

export type Msg = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  deleted?: boolean;
  encrypted?: boolean;
  kind?: string;
  createdAt: string;
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
};

export type NewAttachment = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

const BUCKET = "message-media";
const MAX_UPLOAD = 15 * 1024 * 1024;
/** Πόσα μηνύματα έρχονται ανά σελίδα. Ίδιο με το default του list_messages. */
export const PAGE_SIZE = 50;

function db() {
  if (!supabase) throw new Error(t("err.notConfigured"));
  return supabase;
}

/** Πετάει σφάλμα στη γλώσσα του χρήστη. Το μήνυμα της βάσης, αν το ξέρουμε,
 *  μεταφράζεται· αλλιώς μπαίνει το γενικό μήνυμα της ενέργειας. */
function fail(fallback: TKey, error: { message?: string } | null): never {
  throw new Error(translateError(error?.message) || t(fallback));
}

async function currentUserId(): Promise<string> {
  const { data } = await db().auth.getUser();
  if (!data.user) throw new Error(t("err.signedOut"));
  return data.user.id;
}

const dicebear = (seed: string) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=6d5dfc`;

/** «@username», ή τίποτα αν δεν υπάρχει. */
export const handleOf = (user: { username: string | null }) =>
  user.username ? `@${user.username}` : "";

/** Εικονίδιο ομάδας: ίδια υπηρεσία, άλλο χρώμα, ώστε να ξεχωρίζει με μια ματιά. */
export const groupAvatar = (name: string) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name || "?")}&backgroundColor=272634`;

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
    avatar: row.avatar_path || dicebear(row.display_name),
    privacy: {
      discover: row.discover_by_email,
      showEmail: row.show_email,
      receipts: row.read_receipts,
      online: row.show_online,
    },
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
  return toUser(data as ProfileRow);
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
  return toUser(data as ProfileRow);
}

// ---------------------------------------------------------------------------
// Λογαριασμός: εξαγωγή και διαγραφή
// ---------------------------------------------------------------------------

/** Όλα τα δεδομένα του χρήστη σε JSON (GDPR άρθρο 20). Δεν αλλάζει τίποτα. */
export async function exportMyData(): Promise<unknown> {
  const { data, error } = await db().rpc("export_my_data");
  if (error) fail("err.export", error);
  return data;
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
  const { error } = await db().rpc("delete_my_account");
  if (error) fail("err.deleteAccount", error);
  await db()
    .auth.signOut()
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Αναζήτηση ανθρώπων
// ---------------------------------------------------------------------------

export async function searchUsers(term: string): Promise<User[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await db().rpc("search_profiles", {
    search_term: trimmed,
  });
  if (error) fail("err.search", error);
  return (data || []) as User[];
}

export async function matchContacts(hashes: string[]): Promise<User[]> {
  if (!hashes.length) return [];
  const { data, error } = await db().rpc("match_contacts", {
    email_hashes: hashes.slice(0, 500),
  });
  if (error) fail("err.matchContacts", error);
  return (data || []) as User[];
}

// ---------------------------------------------------------------------------
// Συνημμένα
// ---------------------------------------------------------------------------

// Ο bucket message-media είναι private, οπότε κάθε συνημμένο θέλει
// βραχύβιο signed URL. Τα ζητάμε μαζεμένα για να μη γίνει ένα request
// ανά μήνυμα.
async function withSignedUrls(messages: Msg[]): Promise<Msg[]> {
  const paths = messages
    .map((m) => m.attachment?.path)
    .filter((p): p is string => Boolean(p));
  if (!paths.length) return messages;

  const { data } = await db()
    .storage.from(BUCKET)
    .createSignedUrls([...new Set(paths)], 3600);

  const urls = new Map<string, string>();
  for (const item of data || []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  return messages.map((m) =>
    m.attachment?.path
      ? {
          ...m,
          attachment: {
            ...m.attachment,
            url: urls.get(m.attachment.path) || "",
          },
        }
      : m,
  );
}

export async function uploadAttachment(
  file: File,
  conversationId: string,
): Promise<NewAttachment> {
  if (file.size > MAX_UPLOAD) throw new Error(t("err.fileTooLarge"));

  const uid = await currentUserId();
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.slice(0, 10).toLowerCase()
    : "bin";
  // Ο πρώτος φάκελος ΠΡΕΠΕΙ να είναι το uid: το απαιτούν το policy του storage
  // και το send_message, που δεν δέχεται αρχείο από ξένο φάκελο.
  const path = `${uid}/${conversationId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await db()
    .storage.from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) fail("err.upload", error);

  return {
    path,
    name: file.name.slice(0, 180),
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}

/** Σβήνει αρχεία από το storage. Best-effort: αν αποτύχει, μένει ορφανό αρχείο
 *  που δεν το δείχνει πια κανένα μήνυμα — δεν αξίζει να ενοχλήσει τον χρήστη. */
async function removeFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await db().storage.from(BUCKET).remove(paths);
  if (error) console.warn("Could not remove files:", error.message);
}

// ---------------------------------------------------------------------------
// Συνομιλίες
// ---------------------------------------------------------------------------

export async function listChats(): Promise<Chat[]> {
  const { data, error } = await db().rpc("list_conversations");
  if (error) fail("err.loadChats", error);
  return (data || []) as Chat[];
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
    messages: await withSignedUrls(page),
    hasMore: page.length === PAGE_SIZE,
  };
}

/** Ένα μήνυμα, φρέσκο. null αν δεν υπάρχει πια για μένα. */
export async function getMessage(messageId: string): Promise<Msg | null> {
  const { data, error } = await db().rpc("get_message", { message: messageId });
  if (error || !data) return null;
  const [signed] = await withSignedUrls([data as Msg]);
  return signed;
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
  options: { replyTo?: string; attachment?: NewAttachment } = {},
): Promise<void> {
  const { error } = await db().rpc("send_message", {
    conversation: conversationId,
    body,
    client_id: crypto.randomUUID(),
    reply_to_message: options.replyTo ?? null,
    attachment: options.attachment ?? null,
  });
  if (error) {
    // Το μήνυμα δεν γράφτηκε, άρα το αρχείο που ανέβηκε δεν θα το δείξει ποτέ
    // κανείς. Το μαζεύουμε.
    if (options.attachment) void removeFiles([options.attachment.path]);
    fail("err.send", error);
  }
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

/** Ίδιο emoji δεύτερη φορά = αφαίρεση. Το χειρίζεται η βάση. */
export async function react(messageId: string, emoji: string): Promise<void> {
  const { error } = await db().rpc("react_to_message", {
    message: messageId,
    reaction: emoji,
  });
  if (error) fail("err.react", error);
}

export async function searchMessages(
  term: string,
  conversationId?: string,
): Promise<Msg[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await db().rpc("search_messages", {
    search_term: trimmed,
    conversation: conversationId ?? null,
  });
  if (error) fail("err.search", error);
  return (data || []) as Msg[];
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
  return (data || []) as User[];
}

export async function reportUser(
  userId: string,
  reason: string,
): Promise<void> {
  const uid = await currentUserId();
  const { error } = await db()
    .from("reports")
    .insert({
      reporter_id: uid,
      reported_id: userId,
      reason: reason.slice(0, 500),
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
    );
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

// Το "γράφει..." είναι εφήμερο και δεν αποθηκεύεται πουθενά, οπότε πάει από
// Broadcast αντί για τη βάση.
export function subscribeToTyping(
  conversationId: string,
  onTyping: (active: boolean, userId: string) => void,
): RealtimeChannel {
  const channel = db()
    .channel(`typing:${conversationId}`, {
      config: { broadcast: { self: false } },
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      onTyping(Boolean(payload?.active), String(payload?.userId || ""));
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
): void {
  if (!channel) return;
  try {
    void Promise.resolve(
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: { active, userId },
      }),
    ).catch(() => undefined);
  } catch {
    // Κλειστό κανάλι: το «γράφει…» είναι διακοσμητικό, δεν αξίζει σφάλμα.
  }
}

export function unsubscribe(channel: RealtimeChannel | null): void {
  if (channel) void supabase?.removeChannel(channel);
}
