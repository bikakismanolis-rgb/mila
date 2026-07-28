// Data layer πάνω από το Supabase. Αντικαθιστά όλες τις κλήσεις προς
// http://localhost:8787 και το WebSocket του Express.
//
// Οι συναρτήσεις επιστρέφουν ΤΑ ΙΔΙΑ σχήματα που επέστρεφε ο Express, ώστε τα
// components να μείνουν όπως είναι. Η μετατροπή γίνεται στα RPCs (0005).

import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type Privacy = {
  discover: "everyone" | "contacts" | "nobody";
  showEmail: "chat" | "contacts" | "nobody";
  receipts: boolean;
  online: boolean;
};

export type User = {
  id: string;
  email: string | null;
  name: string;
  username: string;
  bio: string;
  avatar: string;
  privacy: Privacy;
};

export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  url?: string;
};

export type Msg = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  encrypted?: boolean;
  kind?: string;
  createdAt: string;
  readBy: string[];
  deliveredTo: string[];
  attachment?: Attachment;
};

export type Chat = {
  id: string;
  type: string;
  others: User[];
  last?: Msg;
  unread: number;
  requestFrom?: string;
  requestStatus?: "pending" | "accepted" | "rejected";
  createdAt: string;
};

const BUCKET = "message-media";
const MAX_UPLOAD = 15 * 1024 * 1024;

function db() {
  if (!supabase)
    throw new Error("Supabase is not configured. Check your environment file.");
  return supabase;
}

function fail(message: string, error: { message?: string } | null): never {
  throw new Error(error?.message || message);
}

async function currentUserId(): Promise<string> {
  const { data } = await db().auth.getUser();
  if (!data.user) throw new Error("You are signed out.");
  return data.user.id;
}

const dicebear = (seed: string) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=6d5dfc`;

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

export async function getMe(): Promise<User> {
  const uid = await currentUserId();
  const { data, error } = await db()
    .from("profiles")
    .select("*")
    .eq("id", uid)
    .single();
  if (error || !data) fail("Could not load your profile.", error);
  return toUser(data as ProfileRow);
}

export async function updateMe(patch: {
  name?: string;
  bio?: string;
  privacy?: Privacy;
}): Promise<User> {
  const uid = await currentUserId();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.display_name = patch.name;
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
  if (error || !data) fail("Could not save your profile.", error);
  return toUser(data as ProfileRow);
}

export async function searchUsers(term: string): Promise<User[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await db().rpc("search_profiles", {
    search_term: trimmed,
  });
  if (error) fail("Search is unavailable right now.", error);
  return (data || []) as User[];
}

export async function matchContacts(hashes: string[]): Promise<User[]> {
  if (!hashes.length) return [];
  const { data, error } = await db().rpc("match_contacts", {
    email_hashes: hashes.slice(0, 500),
  });
  if (error) fail("Could not match your contacts.", error);
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
): Promise<{ path: string; name: string; mime: string; size: number }> {
  if (file.size > MAX_UPLOAD)
    throw new Error("That file is larger than the 15 MB limit.");

  const uid = await currentUserId();
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.slice(0, 10).toLowerCase()
    : "bin";
  // Το policy media_insert_authenticated απαιτεί ο πρώτος φάκελος να είναι
  // το uid του χρήστη, αλλιώς το upload απορρίπτεται.
  const path = `${uid}/${conversationId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await db()
    .storage.from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) fail("Upload failed.", error);

  return {
    path,
    name: file.name.slice(0, 180),
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}

// ---------------------------------------------------------------------------
// Συνομιλίες
// ---------------------------------------------------------------------------

export async function listChats(): Promise<Chat[]> {
  const { data, error } = await db().rpc("list_conversations");
  if (error) fail("Could not load your conversations.", error);
  const chats = (data || []) as Chat[];
  // Μόνο το τελευταίο μήνυμα κάθε συνομιλίας χρειάζεται URL εδώ.
  const lasts = chats.map((c) => c.last).filter((m): m is Msg => Boolean(m));
  const signed = await withSignedUrls(lasts);
  const byId = new Map(signed.map((m) => [m.id, m]));
  return chats.map((c) =>
    c.last ? { ...c, last: byId.get(c.last.id) || c.last } : c,
  );
}

export async function listMessages(conversationId: string): Promise<Msg[]> {
  const { data, error } = await db().rpc("list_messages", {
    conversation: conversationId,
  });
  if (error) fail("Could not load these messages.", error);
  return withSignedUrls((data || []) as Msg[]);
}

export async function startChat(userId: string): Promise<string> {
  const { data, error } = await db().rpc("start_direct_conversation", {
    target_user: userId,
  });
  if (error || !data) fail("Could not start that conversation.", error);
  return data as string;
}

export async function sendMessage(
  conversationId: string,
  body: string,
  attachment?: { path: string; name: string; mime: string; size: number },
): Promise<void> {
  const uid = await currentUserId();

  const { data: message, error } = await db()
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: uid,
      ciphertext: body,
      encryption_version: 0,
      client_message_id: crypto.randomUUID(),
    })
    .select("id")
    .single();
  if (error || !message) fail("Message could not be sent.", error);

  if (attachment) {
    const { error: attachError } = await db().from("attachments").insert({
      message_id: (message as { id: string }).id,
      conversation_id: conversationId,
      storage_path: attachment.path,
      encrypted_metadata: JSON.stringify({
        name: attachment.name,
        mime: attachment.mime,
      }),
      byte_size: attachment.size,
    });
    // Το μήνυμα έχει ήδη γραφτεί, οπότε μια αποτυχία εδώ αφήνει κενό μήνυμα.
    // Σπάνιο, αλλά θέλει RPC για να γίνει πραγματικά ατομικό.
    if (attachError) fail("The file could not be attached.", attachError);
  }
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
  if (error) fail("Could not update that request.", error);
}

// ---------------------------------------------------------------------------
// Αποκλεισμός και αναφορές
// ---------------------------------------------------------------------------

export async function blockUser(userId: string): Promise<void> {
  const uid = await currentUserId();
  const { error } = await db()
    .from("blocks")
    .insert({ blocker_id: uid, blocked_id: userId });
  if (error && error.code !== "23505") fail("Could not block them.", error);
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
  if (error) fail("Could not send that report.", error);
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

// Αντικαθιστά το ws://localhost:8787/realtime. Το RLS ισχύει στα
// postgres_changes, οπότε ο κάθε χρήστης βλέπει μόνο τις δικές του συνομιλίες
// — δεν χρειάζεται φίλτρο εδώ.
export function subscribeToChanges(handlers: {
  onMessage: () => void;
  onConversation: () => void;
}): RealtimeChannel {
  const channel = db()
    .channel("mila-changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      () => handlers.onMessage(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "message_receipts" },
      () => handlers.onConversation(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversations" },
      () => handlers.onConversation(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversation_members" },
      () => handlers.onConversation(),
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

export async function sendTyping(
  channel: RealtimeChannel | null,
  active: boolean,
): Promise<void> {
  if (!channel) return;
  const uid = await currentUserId().catch(() => null);
  if (!uid) return;
  channel.send({
    type: "broadcast",
    event: "typing",
    payload: { active, userId: uid },
  });
}
