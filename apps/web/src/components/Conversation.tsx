// Η ανοιχτή συνομιλία: κεφαλίδα (με κλήσεις και «σε σύνδεση»), μηνύματα και
// κλήσεις στη σειρά τους (σελίδα-σελίδα, με διαχωριστές ημέρας και «αδιάβαστα»),
// ενέργειες ανά μήνυμα, και το πεδίο γραψίματος (Composer.tsx).

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  Clock,
  Flag,
  LockKeyhole,
  MoreVertical,
  Phone,
  Pin,
  PinOff,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  Video,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as backend from "../data";
import type { Call, Chat, MediaInfo, Member, Msg, Presence, User } from "../data";
import * as calls from "../calls";
import { t, translateError } from "../i18n";
import { dayKey, dayLabel, lastSeenText } from "../format";
import { ConfirmDialog, Empty, Modal } from "./common";
import { GroupInfoDialog } from "./Groups";
import { Bubble, editable } from "./Bubble";
import { Composer } from "./Composer";
import { ForwardDialog, MediaViewer, SendFilesDialog, isVisual } from "./Media";
import type { Prepared } from "./Media";
import { CallEntry } from "./CallsTab";
import { clock, useActiveCallId } from "./Call";
import { ReportDialog } from "./Report";
import type { ReportTarget } from "./Report";

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

/** Ίδια σειρά με τη βάση: (created_at, id). */
function mergeMessages(current: Msg[], incoming: Msg[]): Msg[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (delta) return delta;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

export function chatTitle(chat: Chat): string {
  if (chat.type === "group") return chat.name || t("chat.group");
  return chat.others[0]?.deleted
    ? t("chat.deletedUser")
    : chat.others[0]?.name || t("chat.unknownUser");
}

export function chatAvatar(chat: Chat): string {
  if (chat.type === "group") return backend.groupAvatar(chat.name || "");
  return chat.others[0]?.avatar || backend.groupAvatar("?");
}

/** Σύντομη περιγραφή μηνύματος, για τη λίστα συνομιλιών και τις παραθέσεις. */
export function messageSnippet(m: {
  body: string;
  deleted?: boolean;
  undecryptable?: boolean;
  pendingKey?: boolean;
  attachment?: { name: string; mime?: string; voice?: boolean; duration?: number } | null;
  attachmentName?: string | null;
}): string {
  if (m.deleted) return t("msg.deleted");
  if (m.undecryptable)
    return `\u{1F512} ${t(m.pendingKey ? "msg.pendingKey" : "msg.undecryptable")}`;
  const a = m.attachment;
  if (a?.voice)
    return `\u{1F3A4} ${t("msg.voice")}${a.duration ? ` (${clock(a.duration)})` : ""}`;
  if (a?.mime?.startsWith("image/")) return `\u{1F4F7} ${m.body || t("msg.photo")}`;
  if (a?.mime?.startsWith("video/")) return `\u{1F3A5} ${m.body || t("msg.video")}`;
  if (a?.mime?.startsWith("audio/")) return `\u{1F3B5} ${m.body || a.name}`;
  if (m.body) return m.body;
  const file = a?.name || m.attachmentName;
  return file ? `\u{1F4CE} ${file}` : "";
}

/** Μπορούν να γίνουν κλήσεις εδώ; Μόνο σε αποδεκτή συνομιλία, όχι με
 *  αποκλεισμένο ή διαγραμμένο λογαριασμό. Το ίδιο ελέγχει και η βάση. */
export function canCall(chat: Chat): boolean {
  return (
    calls.callsSupported &&
    chat.requestStatus === "accepted" &&
    !chat.blockedByMe &&
    !(chat.type === "direct" && (chat.others[0]?.deleted || !chat.others[0]))
  );
}

type Item =
  | { kind: "msg"; at: string; m: Msg }
  | { kind: "call"; at: string; call: Call };

const MUTE_OPTIONS: Array<{ key: "8h" | "week" | "always"; ms: number | null }> = [
  { key: "8h", ms: 8 * 3600_000 },
  { key: "week", ms: 7 * 86400_000 },
  { key: "always", ms: null },
];

export function Conversation({
  me,
  chat,
  chats,
  contacts,
  jumpTo,
  onJumped,
  onBack,
  onChanged,
  onGone,
  onBlockChanged,
  notify,
}: {
  me: User;
  chat: Chat;
  /** Όλες οι συνομιλίες, για την προώθηση. */
  chats: Chat[];
  /** Άνθρωποι που μπορώ να βάλω σε ομάδα (αποδεκτές ατομικές συνομιλίες). */
  contacts: User[];
  /** Μήνυμα στο οποίο πρέπει να πάει η οθόνη (από την αναζήτηση). */
  jumpTo: string | null;
  onJumped: () => void;
  onBack: () => void;
  /** Κάτι άλλαξε που επηρεάζει τη λίστα συνομιλιών. */
  onChanged: () => void;
  /** Η συνομιλία δεν υπάρχει πια για μένα (αποχώρησα, με έβγαλαν). */
  onGone: () => void;
  onBlockChanged: () => void;
  notify: (message: string) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]),
    [callLog, setCallLog] = useState<Call[]>([]),
    [hasMore, setHasMore] = useState(false),
    [loaded, setLoaded] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false),
    [typing, setTyping] = useState<{ name: string; activity: backend.Activity } | null>(null),
    [replyTo, setReplyTo] = useState<Msg | null>(null),
    [editing, setEditing] = useState<Msg | null>(null),
    [busy, setBusy] = useState(""),
    [menuFor, setMenuFor] = useState<string | null>(null),
    [deleting, setDeleting] = useState<Msg | null>(null),
    [forwarding, setForwarding] = useState<Msg | null>(null),
    [viewing, setViewing] = useState<string | null>(null),
    [pendingFiles, setPendingFiles] = useState<{ files: File[]; caption: string } | null>(null),
    [headerMenu, setHeaderMenu] = useState(false),
    [dialog, setDialog] = useState<
      "details" | "block" | "group" | "mute" | null
    >(null),
    [reporting, setReporting] = useState<ReportTarget | null>(null),
    [highlight, setHighlight] = useState<string | null>(null),
    [presence, setPresence] = useState<Presence | null>(null),
    [unreadFrom, setUnreadFrom] = useState<{ id: string; count: number } | null>(null),
    [showDown, setShowDown] = useState(false),
    [dragging, setDragging] = useState(false);

  const scroller = useRef<HTMLDivElement>(null),
    typingChannel = useRef<RealtimeChannel | null>(null),
    typingTimer = useRef<number | undefined>(undefined),
    // Ποια συνομιλία δείχνει ΤΩΡΑ η οθόνη. Οι απαντήσεις της βάσης αργούν· αν
    // στο μεταξύ άλλαξε συνομιλία, η απάντηση πετιέται.
    showing = useRef(chat.id),
    nearBottom = useRef(true),
    // Τι να κάνει το scroll μετά το επόμενο render.
    scrollPlan = useRef<"bottom" | "keep" | "unread" | "none">("bottom"),
    distanceFromBottom = useRef(0),
    messagesRef = useRef<Msg[]>([]),
    hasMoreRef = useRef(false),
    // Το τελευταίο εισερχόμενο μήνυμα που έχω ήδη σημάνει ως διαβασμένο.
    lastMarked = useRef<string | null>(null),
    // Πόσα αδιάβαστα είχε η συνομιλία τη στιγμή που άνοιξε.
    unreadAtOpen = useRef(chat.unread),
    dragDepth = useRef(0);

  messagesRef.current = messages;
  hasMoreRef.current = hasMore;

  const activeCallId = useActiveCallId();
  const isGroup = chat.type === "group";
  const other: Member | undefined = isGroup ? undefined : chat.others[0];
  const title = chatTitle(chat);
  const nameOf = useCallback(
    (userId: string, fallback?: string | null) =>
      userId === me.id
        ? t("chat.you")
        : chat.others.find((u) => u.id === userId)?.name ||
          fallback ||
          t("chat.formerMember"),
    [chat.others, me.id],
  );

  // -------------------------------------------------------------------------
  // Φόρτωμα και ζωντανή ενημέρωση
  // -------------------------------------------------------------------------

  const loadCalls = useCallback(async () => {
    const id = chat.id;
    const oldest = messagesRef.current[0];
    try {
      const list = await backend.listCalls(
        id,
        hasMoreRef.current && oldest ? oldest.createdAt : undefined,
      );
      if (showing.current === id) setCallLog(list);
    } catch {
      // Το ιστορικό κλήσεων είναι συμπλήρωμα· τα μηνύματα φαίνονται κανονικά.
    }
  }, [chat.id]);

  const refreshLatest = useCallback(
    async (forceBottom = false) => {
      const id = chat.id;
      try {
        const page = await backend.listMessages(id);
        if (showing.current !== id) return;
        const before = messagesRef.current;
        const merged = mergeMessages(before, page.messages);
        const newest = merged[merged.length - 1];
        const grew = newest && newest.id !== before[before.length - 1]?.id;
        if (forceBottom || (grew && (nearBottom.current || newest.senderId === me.id)))
          scrollPlan.current = "bottom";
        setMessages(merged);
        if (!before.length) setHasMore(page.hasMore);
        // Διαβάστηκε μόνο αν ο χρήστης όντως κοιτάζει την οθόνη, και μόνο
        // όταν ήρθε κάτι καινούργιο από άλλον — όχι σε κάθε ανανέωση.
        const newestIncoming = [...merged]
          .reverse()
          .find((m) => m.senderId !== me.id);
        if (
          newestIncoming &&
          newestIncoming.id !== lastMarked.current &&
          document.visibilityState === "visible"
        ) {
          lastMarked.current = newestIncoming.id;
          void backend.markRead(id).then(onChanged);
        }
      } catch (caught) {
        if (showing.current === id) notify(messageOf(caught));
      }
    },
    // Το onChanged/notify έρχονται από το App και είναι σταθερά σε νόημα.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.id, me.id],
  );

  const patchMessage = useCallback(
    async (messageId: string) => {
      const id = chat.id;
      if (!messagesRef.current.some((m) => m.id === messageId)) return;
      const fresh = await backend.getMessage(messageId);
      if (showing.current !== id) return;
      scrollPlan.current = nearBottom.current ? "bottom" : "none";
      setMessages((current) =>
        fresh
          ? mergeMessages(current, [fresh])
          : current.filter((m) => m.id !== messageId),
      );
    },
    [chat.id],
  );

  useEffect(() => {
    const id = chat.id;
    showing.current = id;
    lastMarked.current = null;
    nearBottom.current = true;
    scrollPlan.current = "bottom";
    unreadAtOpen.current = chat.unread;
    setMessages([]);
    setCallLog([]);
    setHasMore(false);
    setLoaded(false);
    setTyping(null);
    setReplyTo(null);
    setEditing(null);
    setMenuFor(null);
    setHeaderMenu(false);
    setDialog(null);
    setUnreadFrom(null);
    setShowDown(false);
    setPresence(chat.type === "direct" ? chat.others[0]?.presence ?? null : null);

    backend
      .listMessages(id)
      .then((page) => {
        if (showing.current !== id) return;
        scrollPlan.current = "bottom";
        lastMarked.current =
          [...page.messages].reverse().find((m) => m.senderId !== me.id)?.id ||
          null;
        // «Ν αδιάβαστα μηνύματα»: η γραμμή μπαίνει πριν από το πρώτο από αυτά.
        const unread = unreadAtOpen.current;
        if (unread > 0) {
          const incoming = page.messages.filter((m) => m.senderId !== me.id && !m.deleted);
          const first = incoming[Math.max(0, incoming.length - unread)];
          if (first) {
            setUnreadFrom({ id: first.id, count: Math.min(unread, incoming.length) });
            if (unread > 3) scrollPlan.current = "unread";
          }
        }
        messagesRef.current = page.messages;
        hasMoreRef.current = page.hasMore;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setLoaded(true);
        void loadCalls();
      })
      .catch((caught) => {
        if (showing.current === id) {
          setLoaded(true);
          notify(messageOf(caught));
        }
      });
    void backend.markRead(id).then(onChanged);

    const changes = backend.subscribeToConversation(id, {
      onRefresh: () => void refreshLatest(),
      onMessageChanged: (messageId) => void patchMessage(messageId),
    });
    typingChannel.current = backend.subscribeToTyping(id, (activeNow, userId, activity) => {
      window.clearTimeout(typingTimer.current);
      if (!activeNow) {
        setTyping(null);
        return;
      }
      setTyping({ name: nameOf(userId), activity });
      // Αν το «σταμάτησε» χαθεί στον δρόμο, να μη μείνει για πάντα.
      typingTimer.current = window.setTimeout(() => setTyping(null), 6000);
    });

    // Γύρισε στο app μετά από ώρα: φέρε ό,τι έχασε και σήμανέ τα διαβασμένα.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLatest();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Παραδόθηκαν κλειδιά για μηνύματα σε αναμονή, ή ήρθε κλειδί για εμένα.
    const onKeys = () => void refreshLatest();
    window.addEventListener("mila:keys-delivered", onKeys);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("mila:keys-delivered", onKeys);
      window.clearTimeout(typingTimer.current);
      backend.sendTyping(typingChannel.current, false, me.id);
      backend.unsubscribe(changes);
      backend.unsubscribe(typingChannel.current);
      typingChannel.current = null;
    };
    // Ξαναστήνεται ΜΟΝΟ όταν αλλάζει συνομιλία.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // Οι κλήσεις της συνομιλίας: ξαναφορτώνονται όταν αλλάξει η τελευταία
  // (νέα κλήση, απαντήθηκε, έκλεισε).
  const lastCallStamp = chat.lastCall
    ? `${chat.lastCall.id}|${chat.lastCall.status}|${chat.lastCall.participants.map((p) => p.state).join()}`
    : "";
  useEffect(() => {
    if (loaded && lastCallStamp) void loadCalls();
  }, [lastCallStamp, loaded, loadCalls]);

  // «Σε σύνδεση» / «τελευταία φορά»: από τη λίστα, και ανανέωση κάθε 30''.
  useEffect(() => {
    if (!other || other.deleted) return;
    let alive = true;
    const poll = () =>
      void backend.getPresence(other.id).then((p) => alive && setPresence(p));
    const timer = window.setInterval(poll, 30_000);
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [other?.id, other?.deleted]);

  // Το scroll αποφασίζεται ΠΡΙΝ ζωγραφιστεί η οθόνη, για να μην «πηδάει».
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (scrollPlan.current === "keep")
      el.scrollTop = el.scrollHeight - distanceFromBottom.current;
    else if (scrollPlan.current === "bottom") el.scrollTop = el.scrollHeight;
    else if (scrollPlan.current === "unread") {
      // Άνοιγμα με αδιάβαστα: η οθόνη πάει στη γραμμή «αδιάβαστα», όχι στο τέλος.
      const divider = el.querySelector<HTMLElement>(".unread-divider");
      el.scrollTop = divider ? Math.max(0, divider.offsetTop - 90) : el.scrollHeight;
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    }
    scrollPlan.current = "none";
  }, [messages, typing, callLog]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    setShowDown(el.scrollHeight - el.scrollTop - el.clientHeight > 400);
  }

  /** Οι εικόνες παίρνουν ύψος αφού φορτώσουν· αν ήμασταν κάτω, μένουμε κάτω. */
  function onMediaLoad() {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }

  async function loadOlder(): Promise<boolean> {
    const id = chat.id;
    const oldest = messagesRef.current[0];
    if (!oldest || !hasMoreRef.current) return false;
    setLoadingOlder(true);
    try {
      const page = await backend.listMessages(id, oldest.id);
      if (showing.current !== id) return false;
      const el = scroller.current;
      if (el) distanceFromBottom.current = el.scrollHeight - el.scrollTop;
      scrollPlan.current = "keep";
      hasMoreRef.current = page.hasMore;
      messagesRef.current = mergeMessages(messagesRef.current, page.messages);
      setMessages(messagesRef.current);
      setHasMore(page.hasMore);
      void loadCalls();
      return page.messages.length > 0;
    } catch (caught) {
      notify(messageOf(caught));
      return false;
    } finally {
      setLoadingOlder(false);
    }
  }

  function flash(messageId: string) {
    requestAnimationFrame(() => {
      document
        .getElementById(`m-${messageId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlight(messageId);
      window.setTimeout(
        () => setHighlight((h) => (h === messageId ? null : h)),
        2200,
      );
    });
  }

  /** Πήγαινε σε μήνυμα. Αν είναι παλιό, φέρνει σελίδες προς τα πίσω μέχρι να
   *  το βρει (με όριο, για να μην κατεβάσει ολόκληρη συνομιλία χρόνων). */
  async function goTo(messageId: string) {
    nearBottom.current = false;
    for (let pages = 0; pages < 40; pages++) {
      if (messagesRef.current.some((m) => m.id === messageId)) {
        flash(messageId);
        return;
      }
      if (!(await loadOlder())) break;
    }
    if (messagesRef.current.some((m) => m.id === messageId)) flash(messageId);
    else notify(t("msg.notFound"));
  }

  useEffect(() => {
    if (!jumpTo || !loaded) return;
    void goTo(jumpTo).finally(onJumped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo, loaded]);

  // -------------------------------------------------------------------------
  // Ενέργειες
  // -------------------------------------------------------------------------

  async function send(body: string, reply: Msg | null): Promise<boolean> {
    try {
      await backend.sendMessage(chat.id, body, { replyTo: reply?.id });
      setUnreadFrom(null);
      await refreshLatest(true);
      onChanged();
      return true;
    } catch (caught) {
      // Να μη χαθεί αυτό που έγραψε.
      setReplyTo(reply);
      notify(messageOf(caught));
      return false;
    }
  }

  async function saveEdit(message: Msg, body: string): Promise<boolean> {
    try {
      await backend.editMessage(message, body);
      await patchMessage(message.id);
      onChanged();
      return true;
    } catch (caught) {
      notify(messageOf(caught));
      return false;
    }
  }

  /** Ένα-ένα, με τη λεζάντα στο πρώτο. Αν σπάσει κάποιο, τα υπόλοιπα συνεχίζουν. */
  async function sendFiles(items: Prepared[], caption: string) {
    setPendingFiles(null);
    const reply = replyTo;
    setReplyTo(null);
    let failed = 0;
    for (let i = 0; i < items.length; i++) {
      setBusy(
        items.length > 1
          ? t("chat.sendingN", { i: i + 1, n: items.length })
          : t("chat.uploading"),
      );
      try {
        const attachment = await backend.uploadAttachment(items[i].file, chat.id, items[i].info);
        await backend.sendMessage(chat.id, i === 0 ? caption : "", {
          attachment,
          replyTo: i === 0 ? reply?.id : undefined,
        });
        await refreshLatest(true);
      } catch (caught) {
        failed++;
        notify(messageOf(caught));
      }
    }
    setBusy("");
    if (failed < items.length) onChanged();
  }

  async function sendVoice(file: File, info: MediaInfo) {
    setBusy(t("chat.uploading"));
    try {
      const attachment = await backend.uploadAttachment(file, chat.id, info);
      await backend.sendMessage(chat.id, "", { attachment, replyTo: replyTo?.id });
      setReplyTo(null);
      await refreshLatest(true);
      onChanged();
    } catch (caught) {
      notify(messageOf(caught));
    } finally {
      setBusy("");
    }
  }

  async function reactTo(message: Msg, emoji: string) {
    setMenuFor(null);
    try {
      await backend.react(message.id, emoji);
      await patchMessage(message.id);
    } catch (caught) {
      notify(messageOf(caught));
    }
  }

  async function copy(message: Msg) {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(message.body);
      notify(t("msg.copied"));
    } catch {
      notify(t("msg.copyFailed"));
    }
  }

  async function remove(message: Msg, forEveryone: boolean) {
    await backend.deleteMessage(message.id, forEveryone);
    if (showing.current !== chat.id) return;
    if (forEveryone) await patchMessage(message.id);
    else setMessages((current) => current.filter((m) => m.id !== message.id));
    if (replyTo?.id === message.id) setReplyTo(null);
    onChanged();
  }

  async function decide(accept: boolean) {
    try {
      await backend.respondToRequest(chat.id, accept);
      if (accept) onChanged();
      else onGone();
    } catch (caught) {
      notify(messageOf(caught));
    }
  }

  async function unblock() {
    if (!other) return;
    try {
      await backend.unblockUser(other.id);
      onBlockChanged();
    } catch (caught) {
      notify(messageOf(caught));
    }
  }

  async function prefs(change: Parameters<typeof backend.setChatPrefs>[1], done?: string) {
    try {
      await backend.setChatPrefs(chat.id, change);
      if (done) notify(done);
      onChanged();
    } catch (caught) {
      notify(messageOf(caught));
    }
  }

  function call(video: boolean) {
    calls.placeCall(chat, video).catch((caught) => notify(messageOf(caught)));
  }

  function openFiles(files: File[], caption = "") {
    if (!files.length) return;
    setPendingFiles({ files, caption });
  }

  // -------------------------------------------------------------------------
  // Οθόνη
  // -------------------------------------------------------------------------

  const incomingRequest =
    chat.requestStatus === "pending" && chat.requestFrom !== me.id;
  const outgoingRequest =
    chat.requestStatus === "pending" && chat.requestFrom === me.id;
  const composerHidden =
    chat.requestStatus === "rejected" ||
    Boolean(chat.blockedByMe) ||
    Boolean(other?.deleted);
  const callable = canCall(chat);
  const ongoing =
    chat.lastCall && chat.lastCall.status !== "ended" ? chat.lastCall : null;
  const inThisCall = Boolean(ongoing && activeCallId === ongoing.id);
  const muted = Boolean(chat.mutedUntil && Date.parse(chat.mutedUntil) > Date.now());

  const subtitle = typing
    ? typing.activity === "recording"
      ? isGroup
        ? t("chat.recordingNamed", { name: typing.name })
        : t("chat.recording")
      : isGroup
        ? t("chat.typingNamed", { name: typing.name })
        : t("chat.typing")
    : isGroup
      ? chat.others.length + 1 === 1
        ? t("group.membersOne")
        : t("group.membersMany", { n: chat.others.length + 1 })
      : other && !other.deleted
        ? presence?.online
          ? t("presence.online")
          : presence?.lastSeen
            ? lastSeenText(presence.lastSeen)
            : backend.handleOf(other)
        : "";

  // Μηνύματα και κλήσεις σε μία σειρά. Κλήσεις πριν από το παλαιότερο μήνυμα
  // που έχει φορτώσει δεν φαίνονται ακόμα (θα έρθουν με τις παλαιότερες σελίδες).
  const items = useMemo<Item[]>(() => {
    const oldest = messages[0];
    const list: Item[] = messages.map((m) => ({ kind: "msg", at: m.createdAt, m }));
    for (const c of callLog)
      if (!hasMore || !oldest || c.createdAt >= oldest.createdAt)
        list.push({ kind: "call", at: c.createdAt, call: c });
    return list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [messages, callLog, hasMore]);

  const media = useMemo(
    () => messages.filter((m) => !m.deleted && !m.undecryptable && isVisual(m.attachment?.mime)),
    [messages],
  );
  const lastMine = [...messages].reverse().find((m) => m.senderId === me.id);

  return (
    <div
      className="conversation-inner"
      onDragEnter={(e) => {
        if (composerHidden || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (dragging) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        if (!dragging) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        openFiles([...e.dataTransfer.files]);
      }}
    >
      <header>
        <button
          className="icon back"
          onClick={onBack}
          aria-label={t("common.back")}
        >
          <ArrowLeft />
        </button>
        <img src={chatAvatar(chat)} alt="" />
        <div
          className="clickable header-title"
          onClick={() => setDialog(isGroup ? "group" : other && !other.deleted ? "details" : null)}
        >
          <b>
            {title}
            {muted && <BellOff size={13} className="muted-icon" aria-label={t("chat.muted")} />}
          </b>
          <small className={typing ? "typing-text" : presence?.online ? "online-text" : ""}>
            {subtitle}
          </small>
        </div>
        <span />
        {ongoing && !inThisCall && callable ? (
          <button className="join-call" onClick={() => void calls.joinOngoing(ongoing)}>
            {ongoing.video ? <Video size={16} /> : <Phone size={16} />} {t("calls.join")}
          </button>
        ) : (
          callable && (
            <>
              <button
                className="icon header-call"
                onClick={() => call(true)}
                aria-label={t("chat.videoCall")}
                title={t("chat.videoCall")}
                disabled={activeCallId !== null}
              >
                <Video />
              </button>
              <button
                className="icon header-call"
                onClick={() => call(false)}
                aria-label={t("chat.voiceCall")}
                title={t("chat.voiceCall")}
                disabled={activeCallId !== null}
              >
                <Phone />
              </button>
            </>
          )
        )}
        <div className="conversation-menu">
          <button
            className="icon"
            aria-label={t("chat.options")}
            onClick={() => setHeaderMenu((open) => !open)}
          >
            <MoreVertical />
          </button>
          {headerMenu && (
            <>
              <div className="click-away" onClick={() => setHeaderMenu(false)} />
              <div className="menu-popover" onClick={() => setHeaderMenu(false)}>
                {isGroup ? (
                  <>
                    <button onClick={() => setDialog("group")}>
                      <Users /> {t("group.info")}
                    </button>
                    <button className="danger" onClick={() => setReporting({ kind: "group" })}>
                      <Flag /> {t("report.group")}
                    </button>
                  </>
                ) : (
                  other &&
                  !other.deleted && (
                    <button onClick={() => setDialog("details")}>
                      <UserRound /> {t("chat.details")}
                    </button>
                  )
                )}
                {muted ? (
                  <button onClick={() => void prefs({ mutedUntil: null }, t("chat.unmuted"))}>
                    <Bell /> {t("chat.unmute")}
                  </button>
                ) : (
                  <button onClick={() => setDialog("mute")}>
                    <BellOff /> {t("chat.mute")}
                  </button>
                )}
                {chat.pinnedAt ? (
                  <button onClick={() => void prefs({ pinned: false })}>
                    <PinOff /> {t("chat.unpin")}
                  </button>
                ) : (
                  <button onClick={() => void prefs({ pinned: true })}>
                    <Pin /> {t("chat.pin")}
                  </button>
                )}
                {chat.archived ? (
                  <button onClick={() => void prefs({ archived: false }, t("chat.unarchived"))}>
                    <ArchiveRestore /> {t("chat.unarchive")}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      void prefs({ archived: true }, t("chat.archived"));
                      onBack();
                    }}
                  >
                    <Archive /> {t("chat.archive")}
                  </button>
                )}
                {!isGroup && other && !other.deleted && (
                  <>
                    {chat.blockedByMe ? (
                      <button onClick={() => void unblock()}>
                        <Ban /> {t("chat.unblock")}
                      </button>
                    ) : (
                      <button onClick={() => setDialog("block")}>
                        <Ban /> {t("chat.block")}
                      </button>
                    )}
                    <button
                      className="danger"
                      onClick={() => setReporting({ kind: "person", person: other })}
                    >
                      <Flag /> {t("chat.report")}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="messages" ref={scroller} onScroll={onScroll}>
        {incomingRequest && (
          <div className="request">
            <ShieldCheck />
            <h3>{t("request.title", { name: title })}</h3>
            <p>{t("request.text")}</p>
            <div>
              <button className="secondary" onClick={() => void decide(false)}>
                {t("request.decline")}
              </button>
              <button onClick={() => void decide(true)}>
                {t("request.accept")}
              </button>
            </div>
          </div>
        )}

        {!hasMore && loaded && (
          <p className="e2ee-note">
            <LockKeyhole size={13} /> {t("chat.encryptedNote")}
          </p>
        )}

        {hasMore && (
          <button
            className="load-older"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
          >
            {loadingOlder ? t("common.loading") : t("chat.loadOlder")}
          </button>
        )}

        {loaded && !items.length && !incomingRequest && (
          <Empty
            icon={<Send />}
            title={t("chat.emptyTitle")}
            text={
              outgoingRequest
                ? t("request.waiting", { name: title })
                : t("chat.emptyText")
            }
          />
        )}

        {items.map((item, index) => {
          const previous = items[index - 1];
          const newDay = !previous || dayKey(previous.at) !== dayKey(item.at);
          if (item.kind === "call")
            return (
              <React.Fragment key={`c-${item.call.id}`}>
                {newDay && <div className="day">{dayLabel(item.at)}</div>}
                <CallEntry
                  call={item.call}
                  me={me}
                  inThisCall={activeCallId === item.call.id}
                  onCall={(video) => (callable ? call(video) : undefined)}
                  onJoin={(c) => void calls.joinOngoing(c)}
                />
              </React.Fragment>
            );
          const m = item.m;
          const sender = chat.others.find((u) => u.id === m.senderId);
          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="day">{dayLabel(m.createdAt)}</div>}
              {unreadFrom?.id === m.id && (
                <div className="unread-divider">
                  {unreadFrom.count === 1
                    ? t("chat.unreadOne")
                    : t("chat.unreadMany", { n: unreadFrom.count })}
                </div>
              )}
              <Bubble
                m={m}
                chat={chat}
                own={m.senderId === me.id}
                meId={me.id}
                showSender={isGroup && m.senderId !== me.id}
                senderName={nameOf(m.senderId, m.senderName)}
                senderAvatar={sender?.avatar}
                nameOf={nameOf}
                highlighted={highlight === m.id}
                menuOpen={menuFor === m.id}
                toggleMenu={() =>
                  setMenuFor((current) => (current === m.id ? null : m.id))
                }
                onReact={(emoji) => void reactTo(m, emoji)}
                onReply={() => {
                  setMenuFor(null);
                  setEditing(null);
                  setReplyTo(m);
                }}
                onCopy={() => void copy(m)}
                onDelete={() => {
                  setMenuFor(null);
                  setDeleting(m);
                }}
                onEdit={() => {
                  setMenuFor(null);
                  setReplyTo(null);
                  setEditing(m);
                }}
                onForward={() => {
                  setMenuFor(null);
                  setForwarding(m);
                }}
                onReport={() => {
                  setMenuFor(null);
                  setReporting({ kind: "message", message: m });
                }}
                onQuoteClick={(id) => void goTo(id)}
                onMediaLoad={onMediaLoad}
                onOpenMedia={() => setViewing(m.id)}
                onOpenFile={() =>
                  m.attachment &&
                  void backend.openAttachment(m.attachment).catch((caught) =>
                    notify(messageOf(caught)),
                  )
                }
                canReply={!composerHidden}
              />
            </React.Fragment>
          );
        })}

        {typing && (
          <div className="bubble typing">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

      {showDown && (
        <button
          className="scroll-down"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          }}
          aria-label={t("chat.scrollDown")}
        >
          <ArrowDown size={20} />
        </button>
      )}

      {dragging && (
        <div className="drop-zone">
          <Upload size={34} />
          <b>{t("chat.dropHere")}</b>
        </div>
      )}

      {!composerHidden && messages.some((m) => m.senderId === me.id && m.waiting) && (
        <div className="composer-note waiting-note">
          <Clock size={15} />
          <span>
            {isGroup
              ? t("msg.waitingNoteGroup")
              : t("msg.waitingNote", { name: other?.name || title })}
          </span>
        </div>
      )}
      {chat.blockedByMe && other && (
        <div className="composer-note">
          <span>{t("chat.youBlocked", { name: other.name })}</span>
          <button onClick={() => void unblock()}>{t("chat.unblock")}</button>
        </div>
      )}
      {other?.deleted && (
        <div className="composer-note">
          <span>{t("chat.accountDeleted")}</span>
        </div>
      )}

      {!composerHidden && (
        <Composer
          me={me}
          chatId={chat.id}
          typingChannel={typingChannel}
          replyTo={replyTo}
          clearReply={() => setReplyTo(null)}
          editing={editing}
          clearEditing={() => setEditing(null)}
          busy={busy}
          nameOf={nameOf}
          onSend={send}
          onSaveEdit={saveEdit}
          onFiles={openFiles}
          onVoice={(file, info) => void sendVoice(file, info)}
          onEditLast={() => {
            if (lastMine && editable(lastMine, me.id) && !lastMine.attachment?.voice)
              setEditing(lastMine);
          }}
          notify={notify}
        />
      )}

      {pendingFiles && (
        <SendFilesDialog
          files={pendingFiles.files}
          initialCaption={pendingFiles.caption}
          send={(prepared, caption) => void sendFiles(prepared, caption)}
          close={() => setPendingFiles(null)}
        />
      )}

      {viewing && (
        <MediaViewer
          items={media}
          startId={viewing}
          nameOf={nameOf}
          close={() => setViewing(null)}
          onForward={(m) => {
            setViewing(null);
            setForwarding(m);
          }}
        />
      )}

      {forwarding && (
        <ForwardDialog
          chats={chats}
          message={forwarding}
          forward={async (m, ids) => {
            await backend.forwardMessage(m, ids);
            notify(ids.length === 1 ? t("msg.forwardedOne") : t("msg.forwardedMany", { n: ids.length }));
            onChanged();
            if (ids.includes(chat.id)) await refreshLatest(true);
          }}
          close={() => setForwarding(null)}
        />
      )}

      {deleting && (
        <DeleteMessageDialog
          message={deleting}
          own={deleting.senderId === me.id}
          remove={remove}
          close={() => setDeleting(null)}
        />
      )}

      {dialog === "mute" && (
        <MuteDialog
          close={() => setDialog(null)}
          choose={(ms) =>
            void prefs(
              {
                // «Πάντα» = μέχρι το 9999: η βάση θέλει ημερομηνία, όχι άπειρο.
                mutedUntil: new Date(ms === null ? Date.UTC(9999, 0, 1) : Date.now() + ms).toISOString(),
              },
              t("chat.mutedDone"),
            )
          }
        />
      )}

      {dialog === "details" && other && (
        <Modal title={t("chat.details")} close={() => setDialog(null)}>
          <div className="contact-card">
            <img src={other.avatar} alt="" />
            <b>{other.name}</b>
            {other.username && <small>{backend.handleOf(other)}</small>}
            <small>{other.email || t("people.privateEmail")}</small>
            {presence && (
              <small className={presence.online ? "online-text" : ""}>
                {presence.online
                  ? t("presence.online")
                  : presence.lastSeen
                    ? lastSeenText(presence.lastSeen)
                    : ""}
              </small>
            )}
            {other.bio && <p>{other.bio}</p>}
            {callable && (
              <div className="contact-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setDialog(null);
                    call(false);
                  }}
                >
                  <Phone size={16} /> {t("chat.voiceCall")}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setDialog(null);
                    call(true);
                  }}
                >
                  <Video size={16} /> {t("chat.videoCall")}
                </button>
              </div>
            )}
          </div>
          <SafetyCode person={other} />
          {!other.deleted && (
            <div className="contact-actions">
              <button
                className="secondary report"
                onClick={() => {
                  setDialog(null);
                  setReporting({ kind: "person", person: other });
                }}
              >
                <Flag size={16} /> {t("chat.report")}
              </button>
            </div>
          )}
        </Modal>
      )}

      {dialog === "block" && other && (
        <ConfirmDialog
          title={t("chat.blockTitle", { name: other.name })}
          text={t("chat.blockText")}
          confirmLabel={t("chat.block")}
          danger
          onConfirm={async () => {
            await backend.blockUser(other.id);
            onBlockChanged();
          }}
          close={() => setDialog(null)}
        />
      )}

      {reporting && (
        <ReportDialog
          target={reporting}
          chat={chat}
          me={me}
          messages={messages}
          nameOf={nameOf}
          done={() => notify(t("chat.reportThanks"))}
          close={() => setReporting(null)}
        />
      )}

      {dialog === "group" && isGroup && (
        <GroupInfoDialog
          me={me}
          chat={chat}
          contacts={contacts}
          onChanged={onChanged}
          onLeft={onGone}
          close={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function MuteDialog({
  close,
  choose,
}: {
  close: () => void;
  choose: (ms: number | null) => void;
}) {
  const [pick, setPick] = useState<number>(0);
  return (
    <Modal title={t("chat.muteTitle")} icon={<BellOff size={18} />} close={close}>
      <p>{t("chat.muteText")}</p>
      <div className="mute-options">
        {MUTE_OPTIONS.map((option, i) => (
          <label key={option.key}>
            <input type="radio" name="mute" checked={pick === i} onChange={() => setPick(i)} />
            {t(`chat.mute_${option.key}`)}
          </label>
        ))}
      </div>
      <div className="modal-actions">
        <button className="ghost" onClick={close}>
          {t("common.cancel")}
        </button>
        <button
          className="primary"
          onClick={() => {
            choose(MUTE_OPTIONS[pick].ms);
            close();
          }}
        >
          {t("chat.mute")}
        </button>
      </div>
    </Modal>
  );
}

function DeleteMessageDialog({
  message,
  own,
  remove,
  close,
}: {
  message: Msg;
  own: boolean;
  remove: (message: Msg, forEveryone: boolean) => Promise<void>;
  close: () => void;
}) {
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const canForEveryone = own && !message.deleted;

  async function run(forEveryone: boolean) {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await remove(message, forEveryone);
      close();
    } catch (caught) {
      setError(messageOf(caught));
      setWorking(false);
    }
  }

  return (
    <Modal
      title={t("msg.deleteTitle")}
      icon={<Trash2 size={18} />}
      close={close}
      locked={working}
    >
      <p>
        {canForEveryone ? t("msg.deleteTextOwn") : t("msg.deleteTextOther")}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions stacked">
        {canForEveryone && (
          <button
            className="danger"
            onClick={() => void run(true)}
            disabled={working}
          >
            {t("msg.deleteForEveryone")}
          </button>
        )}
        <button
          className={canForEveryone ? "ghost" : "danger"}
          onClick={() => void run(false)}
          disabled={working}
        >
          {t("msg.deleteForMe")}
        </button>
        <button className="ghost" onClick={close} disabled={working}>
          {t("common.cancel")}
        </button>
      </div>
    </Modal>
  );
}

/** Ο κωδικός ασφαλείας με κάποιον: τον συγκρίνετε από κοντά ή σε τηλέφωνο. */
function SafetyCode({ person }: { person: User }) {
  const [code, setCode] = useState<string[] | null>(null),
    [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    backend
      .safetyCodeWith(person.id)
      .then((c) => alive && setCode(c))
      .catch((caught) => alive && setError(messageOf(caught)));
    return () => {
      alive = false;
    };
  }, [person.id]);

  return (
    <div className="safety-code">
      <h3>
        <ShieldCheck size={16} /> {t("chat.safetyCode")}
      </h3>
      {error ? (
        <p className="error">{error}</p>
      ) : code === null ? (
        <p className="hint">{t("common.loading")}</p>
      ) : code.length ? (
        <>
          <p className="hint">{t("chat.safetyText", { name: person.name })}</p>
          <div className="digits">
            {code.map((group, i) => (
              <code key={i}>{group}</code>
            ))}
          </div>
          <p className="hint">{t("chat.safetyChanges")}</p>
        </>
      ) : (
        <p className="hint">{t("chat.safetyNone", { name: person.name })}</p>
      )}
    </div>
  );
}
