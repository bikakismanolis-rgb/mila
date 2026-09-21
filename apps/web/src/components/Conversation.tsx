// Η ανοιχτή συνομιλία: κεφαλίδα, μηνύματα (σελίδα-σελίδα, με διαχωριστές
// ημέρας), ενέργειες ανά μήνυμα (απάντηση, αντίδραση, αντιγραφή, διαγραφή),
// και το πεδίο γραψίματος.

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  FileText,
  Flag,
  LockKeyhole,
  MoreVertical,
  Paperclip,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as backend from "../data";
import type { Chat, Member, Msg, User } from "../data";
import { t, translateError } from "../i18n";
import { dayKey, dayLabel, fileSize, time } from "../format";
import { ConfirmDialog, Empty, Modal, PromptDialog } from "./common";
import { GroupInfoDialog } from "./Groups";

// Γραμμένα ως κωδικοί και όχι ως χαρακτήρες: το αρχείο έχει ήδη πάθει μία φορά
// ζημιά σε emoji όταν αποθηκεύτηκε με λάθος κωδικοποίηση στα Windows.
const REACTIONS = [
  "\u{1F44D}", // μπράβο
  "\u2764\uFE0F", // καρδιά
  "\u{1F602}", // γέλιο
  "\u{1F62E}", // έκπληξη
  "\u{1F622}", // λύπη
  "\u{1F64F}", // ευχαριστώ
];

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
  attachment?: { name: string } | null;
  attachmentName?: string | null;
}): string {
  if (m.deleted) return t("msg.deleted");
  if (m.body) return m.body;
  const file = m.attachment?.name || m.attachmentName;
  return file ? `\u{1F4CE} ${file}` : "";
}

export function Conversation({
  me,
  chat,
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
    [hasMore, setHasMore] = useState(false),
    [loaded, setLoaded] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false),
    [typingName, setTypingName] = useState<string | null>(null),
    [text, setText] = useState(""),
    [replyTo, setReplyTo] = useState<Msg | null>(null),
    [uploading, setUploading] = useState(false),
    [menuFor, setMenuFor] = useState<string | null>(null),
    [deleting, setDeleting] = useState<Msg | null>(null),
    [headerMenu, setHeaderMenu] = useState(false),
    [dialog, setDialog] = useState<
      "details" | "report" | "block" | "group" | null
    >(null),
    [highlight, setHighlight] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    typingChannel = useRef<RealtimeChannel | null>(null),
    typingTimer = useRef<number | undefined>(undefined),
    // Ποια συνομιλία δείχνει ΤΩΡΑ η οθόνη. Οι απαντήσεις της βάσης αργούν· αν
    // στο μεταξύ άλλαξε συνομιλία, η απάντηση πετιέται.
    showing = useRef(chat.id),
    nearBottom = useRef(true),
    // Τι να κάνει το scroll μετά το επόμενο render.
    scrollPlan = useRef<"bottom" | "keep" | "none">("bottom"),
    distanceFromBottom = useRef(0),
    messagesRef = useRef<Msg[]>([]),
    hasMoreRef = useRef(false),
    // Το τελευταίο εισερχόμενο μήνυμα που έχω ήδη σημάνει ως διαβασμένο.
    lastMarked = useRef<string | null>(null);

  messagesRef.current = messages;
  hasMoreRef.current = hasMore;

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
    setMessages([]);
    setHasMore(false);
    setLoaded(false);
    setTypingName(null);
    setReplyTo(null);
    setMenuFor(null);
    setHeaderMenu(false);
    setDialog(null);
    setText("");

    backend
      .listMessages(id)
      .then((page) => {
        if (showing.current !== id) return;
        scrollPlan.current = "bottom";
        lastMarked.current =
          [...page.messages].reverse().find((m) => m.senderId !== me.id)?.id ||
          null;
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setLoaded(true);
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
    typingChannel.current = backend.subscribeToTyping(id, (active, userId) => {
      window.clearTimeout(typingTimer.current);
      if (!active) {
        setTypingName(null);
        return;
      }
      setTypingName(nameOf(userId));
      // Αν το «σταμάτησε να γράφει» χαθεί στον δρόμο, να μη μείνει για πάντα.
      typingTimer.current = window.setTimeout(() => setTypingName(null), 6000);
    });

    // Γύρισε στο app μετά από ώρα: φέρε ό,τι έχασε και σήμανέ τα διαβασμένα.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLatest();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(typingTimer.current);
      backend.sendTyping(typingChannel.current, false, me.id);
      backend.unsubscribe(changes);
      backend.unsubscribe(typingChannel.current);
      typingChannel.current = null;
    };
    // Ξαναστήνεται ΜΟΝΟ όταν αλλάζει συνομιλία.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  // Το scroll αποφασίζεται ΠΡΙΝ ζωγραφιστεί η οθόνη, για να μην «πηδάει».
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (scrollPlan.current === "keep")
      el.scrollTop = el.scrollHeight - distanceFromBottom.current;
    else if (scrollPlan.current === "bottom") el.scrollTop = el.scrollHeight;
    scrollPlan.current = "none";
  }, [messages, typingName]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
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

  async function send() {
    const body = text.trim();
    if (!body) return;
    const reply = replyTo;
    setText("");
    setReplyTo(null);
    backend.sendTyping(typingChannel.current, false, me.id);
    try {
      await backend.sendMessage(chat.id, body, { replyTo: reply?.id });
      await refreshLatest(true);
      onChanged();
    } catch (caught) {
      // Να μη χαθεί αυτό που έγραψε.
      setText(body);
      setReplyTo(reply);
      notify(messageOf(caught));
    }
  }

  async function sendAttachment(file?: File) {
    if (!file) return;
    const reply = replyTo;
    setUploading(true);
    try {
      const attachment = await backend.uploadAttachment(file, chat.id);
      await backend.sendMessage(chat.id, "", {
        attachment,
        replyTo: reply?.id,
      });
      setReplyTo(null);
      await refreshLatest(true);
      onChanged();
    } catch (caught) {
      notify(messageOf(caught));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
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

  const subtitle = typingName
    ? isGroup
      ? t("chat.typingNamed", { name: typingName })
      : t("chat.typing")
    : isGroup
      ? chat.others.length + 1 === 1
        ? t("group.membersOne")
        : t("group.membersMany", { n: chat.others.length + 1 })
      : other && !other.deleted
        ? backend.handleOf(other)
        : "";

  return (
    <>
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
          className={isGroup ? "clickable" : ""}
          onClick={isGroup ? () => setDialog("group") : undefined}
        >
          <b>{title}</b>
          <small>{subtitle}</small>
        </div>
        <span />
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
                  <button onClick={() => setDialog("group")}>
                    <Users /> {t("group.info")}
                  </button>
                ) : (
                  other &&
                  !other.deleted && (
                    <>
                      <button onClick={() => setDialog("details")}>
                        <UserRound /> {t("chat.details")}
                      </button>
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
                        onClick={() => setDialog("report")}
                      >
                        <Flag /> {t("chat.report")}
                      </button>
                    </>
                  )
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

        {hasMore && (
          <button
            className="load-older"
            onClick={() => void loadOlder()}
            disabled={loadingOlder}
          >
            {loadingOlder ? t("common.loading") : t("chat.loadOlder")}
          </button>
        )}

        {loaded && !messages.length && !incomingRequest && (
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

        {messages.map((m, index) => {
          const previous = messages[index - 1];
          const newDay =
            !previous || dayKey(previous.createdAt) !== dayKey(m.createdAt);
          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="day">{dayLabel(m.createdAt)}</div>}
              <Bubble
                m={m}
                own={m.senderId === me.id}
                meId={me.id}
                showSender={isGroup && m.senderId !== me.id}
                senderName={nameOf(m.senderId, m.senderName)}
                nameOf={nameOf}
                highlighted={highlight === m.id}
                menuOpen={menuFor === m.id}
                toggleMenu={() =>
                  setMenuFor((current) => (current === m.id ? null : m.id))
                }
                onReact={(emoji) => void reactTo(m, emoji)}
                onReply={() => {
                  setMenuFor(null);
                  setReplyTo(m);
                  composer.current?.focus();
                }}
                onCopy={() => void copy(m)}
                onDelete={() => {
                  setMenuFor(null);
                  setDeleting(m);
                }}
                onQuoteClick={(id) => void goTo(id)}
                onMediaLoad={onMediaLoad}
                canReply={!composerHidden}
              />
            </React.Fragment>
          );
        })}

        {typingName && (
          <div className="bubble typing">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>

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
        <footer>
          {replyTo && (
            <div className="reply-bar">
              <CornerUpLeft size={16} />
              <span>
                <b>{nameOf(replyTo.senderId, replyTo.senderName)}</b>
                <small>{messageSnippet(replyTo)}</small>
              </span>
              <button
                onClick={() => setReplyTo(null)}
                aria-label={t("common.cancel")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="composer-row">
            <input
              ref={fileInput}
              type="file"
              hidden
              accept="image/*,.pdf,.txt,.zip,.docx,.xlsx"
              onChange={(e) => void sendAttachment(e.target.files?.[0])}
            />
            <button
              className="plus"
              title={t("chat.attach")}
              aria-label={t("chat.attach")}
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </button>
            <textarea
              ref={composer}
              rows={1}
              value={text}
              maxLength={8000}
              onChange={(e) => {
                setText(e.target.value);
                backend.sendTyping(
                  typingChannel.current,
                  !!e.target.value,
                  me.id,
                );
              }}
              onBlur={() => backend.sendTyping(typingChannel.current, false, me.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                uploading ? t("chat.uploading") : t("chat.placeholder")
              }
            />
            <button
              className="send"
              disabled={!text.trim()}
              onClick={() => void send()}
              aria-label={t("chat.send")}
            >
              <Send />
            </button>
          </div>
        </footer>
      )}

      {deleting && (
        <DeleteMessageDialog
          message={deleting}
          own={deleting.senderId === me.id}
          remove={remove}
          close={() => setDeleting(null)}
        />
      )}

      {dialog === "details" && other && (
        <Modal title={t("chat.details")} close={() => setDialog(null)}>
          <div className="contact-card">
            <img src={other.avatar} alt="" />
            <b>{other.name}</b>
            {other.username && <small>{backend.handleOf(other)}</small>}
            <small>{other.email || t("people.privateEmail")}</small>
            {other.bio && <p>{other.bio}</p>}
          </div>
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

      {dialog === "report" && other && (
        <PromptDialog
          title={t("chat.reportTitle", { name: other.name })}
          text={t("chat.reportText")}
          placeholder={t("chat.reportPlaceholder")}
          confirmLabel={t("chat.reportSend")}
          multiline
          onSubmit={async (reason) => {
            await backend.reportUser(other.id, reason);
            notify(t("chat.reportThanks"));
          }}
          close={() => setDialog(null)}
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
    </>
  );
}

function Bubble({
  m,
  own,
  meId,
  showSender,
  senderName,
  nameOf,
  highlighted,
  menuOpen,
  toggleMenu,
  onReact,
  onReply,
  onCopy,
  onDelete,
  onQuoteClick,
  onMediaLoad,
  canReply,
}: {
  m: Msg;
  own: boolean;
  meId: string;
  showSender: boolean;
  senderName: string;
  nameOf: (userId: string, fallback?: string | null) => string;
  highlighted: boolean;
  menuOpen: boolean;
  toggleMenu: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onQuoteClick: (messageId: string) => void;
  onMediaLoad: () => void;
  canReply: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menuOpen) menu.current?.scrollIntoView({ block: "nearest" });
  }, [menuOpen]);

  // Το url είναι βραχύβιο signed URL από το Supabase Storage (data.ts).
  const mediaUrl = m.attachment?.url || "";
  const mine = m.reactions?.find((r) => r.userId === meId)?.emoji;

  // Ίδια emoji μαζί, με μετρητή.
  const grouped = new Map<string, string[]>();
  for (const r of m.reactions || [])
    grouped.set(r.emoji, [...(grouped.get(r.emoji) || []), r.userId]);

  return (
    <div
      id={`m-${m.id}`}
      className={`msg ${own ? "own" : ""} ${highlighted ? "flash" : ""}`}
    >
      {showSender && <span className="sender">{senderName}</span>}
      <div
        className={`bubble ${own ? "own" : ""} ${m.deleted ? "deleted" : ""}`}
        onClick={(e) => {
          // Το πάτημα σε σύνδεσμο/αρχείο/παράθεση κάνει τη δική του δουλειά.
          if ((e.target as HTMLElement).closest("a, .quote")) return;
          toggleMenu();
        }}
      >
        {m.replyTo && !m.deleted && (
          <div
            className="quote"
            onClick={() => onQuoteClick(m.replyTo!.id)}
            role="button"
          >
            <b>{nameOf(m.replyTo.senderId, m.replyTo.senderName)}</b>
            <small>{messageSnippet(m.replyTo)}</small>
          </div>
        )}
        {m.deleted ? (
          <p className="deleted-text">
            <Ban size={13} /> {t("msg.deleted")}
          </p>
        ) : (
          <>
            {m.attachment?.mime.startsWith("image/") ? (
              <a href={mediaUrl} target="_blank" rel="noreferrer">
                <img
                  className="message-image"
                  src={mediaUrl}
                  alt={m.attachment.name}
                  onLoad={onMediaLoad}
                />
              </a>
            ) : m.attachment ? (
              <a
                className="file-card"
                href={mediaUrl}
                target="_blank"
                rel="noreferrer"
              >
                <FileText />
                <span>
                  <b>{m.attachment.name}</b>
                  <small>{fileSize(m.attachment.size)}</small>
                </span>
              </a>
            ) : null}
            {m.body && (
              <p>
                {m.encrypted ? (
                  <>
                    <LockKeyhole size={12} /> {t("msg.encrypted")}
                  </>
                ) : (
                  m.body
                )}
              </p>
            )}
          </>
        )}
        <small>
          {time(m.createdAt)}{" "}
          {own &&
            !m.deleted &&
            (m.readBy.length > 0 ? <CheckCheck /> : <Check />)}
        </small>
      </div>

      {grouped.size > 0 && (
        <div className="reactions">
          {[...grouped.entries()].map(([emoji, users]) => (
            <button
              key={emoji}
              className={users.includes(meId) ? "mine" : ""}
              title={users.map((id) => nameOf(id)).join(", ")}
              onClick={() => onReact(emoji)}
            >
              {emoji}
              {users.length > 1 && <span>{users.length}</span>}
            </button>
          ))}
        </div>
      )}

      {menuOpen && (
        <>
          <div className="click-away" onClick={toggleMenu} />
          <div className="msg-menu" ref={menu}>
            {!m.deleted && (
              <div className="emoji-row">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    className={mine === emoji ? "mine" : ""}
                    onClick={() => onReact(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            {!m.deleted && canReply && (
              <button onClick={onReply}>
                <CornerUpLeft /> {t("msg.reply")}
              </button>
            )}
            {!m.deleted && m.body && !m.encrypted && (
              <button onClick={onCopy}>
                <Copy /> {t("msg.copy")}
              </button>
            )}
            <button className="danger" onClick={onDelete}>
              <Trash2 /> {t("msg.delete")}
            </button>
          </div>
        </>
      )}
    </div>
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
