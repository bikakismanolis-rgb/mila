// Ένα μήνυμα στη συνομιλία: κείμενο, φωτογραφία, βίντεο, φωνητικό ή αρχείο,
// με παράθεση, αντιδράσεις, τικ παράδοσης και το μενού ενεργειών του.

import React, { useEffect, useRef } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  Flag,
  Forward,
  LockKeyhole,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import type { Chat, Msg } from "../data";
import { t } from "../i18n";
import { fileSize, time } from "../format";
import { clock } from "./Call";
import { VoicePlayer } from "./Voice";
import { messageSnippet } from "./Conversation";

// Γραμμένα ως κωδικοί και όχι ως χαρακτήρες: το αρχείο έχει ήδη πάθει μία φορά
// ζημιά σε emoji όταν αποθηκεύτηκε με λάθος κωδικοποίηση στα Windows.
export const REACTIONS = [
  "\u{1F44D}", // μπράβο
  "❤️", // καρδιά
  "\u{1F602}", // γέλιο
  "\u{1F62E}", // έκπληξη
  "\u{1F622}", // λύπη
  "\u{1F64F}", // ευχαριστώ
];

/** Πόσο προχώρησε ένα δικό μου μήνυμα: όπως τα τικ του WhatsApp. Σε ομάδα,
 *  «διαβάστηκε» όταν το διάβασαν όλοι. */
export function receiptOf(m: Msg, chat: Chat): "waiting" | "sent" | "delivered" | "read" {
  if (m.waiting) return "waiting";
  const others = chat.others.filter((u) => !u.deleted).map((u) => u.id);
  if (!others.length) return "sent";
  if (others.every((id) => m.readBy.includes(id))) return "read";
  if (others.every((id) => m.deliveredTo.includes(id) || m.readBy.includes(id))) return "delivered";
  return "sent";
}

/** Μπορώ ακόμα να το αλλάξω; (15 λεπτά, όπως και η βάση). */
export function editable(m: Msg, meId: string): boolean {
  return (
    m.senderId === meId &&
    !m.deleted &&
    !m.undecryptable &&
    Boolean(m.e2ee) &&
    Date.now() - Date.parse(m.createdAt) < 15 * 60_000 - 5000
  );
}

/** Γράφοντας ένα URL μέσα στο κείμενο, γίνεται σύνδεσμος. Τίποτα άλλο (όχι HTML). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow">
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** Μόνο emoji (έως 3): μεγάλα, χωρίς φούσκα, όπως στο WhatsApp. */
function onlyEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 24) return false;
  return /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s){1,24}$/u.test(trimmed) &&
    [...trimmed.replace(/\s/g, "")].filter((c) => /\p{Extended_Pictographic}/u.test(c)).length <= 3;
}

export function Bubble({
  m,
  chat,
  own,
  meId,
  showSender,
  senderName,
  senderAvatar,
  nameOf,
  highlighted,
  menuOpen,
  toggleMenu,
  onReact,
  onReply,
  onCopy,
  onDelete,
  onEdit,
  onForward,
  onReport,
  onQuoteClick,
  onMediaLoad,
  onOpenMedia,
  onOpenFile,
  canReply,
}: {
  m: Msg;
  chat: Chat;
  own: boolean;
  meId: string;
  showSender: boolean;
  senderName: string;
  senderAvatar?: string;
  nameOf: (userId: string, fallback?: string | null) => string;
  highlighted: boolean;
  menuOpen: boolean;
  toggleMenu: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onForward: () => void;
  /** Αναφορά για αυτό το μήνυμα (μόνο για μηνύματα άλλων). */
  onReport?: () => void;
  onQuoteClick: (messageId: string) => void;
  onMediaLoad: () => void;
  onOpenMedia: () => void;
  onOpenFile: () => void;
  canReply: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menuOpen) menu.current?.scrollIntoView({ block: "nearest" });
  }, [menuOpen]);

  const a = m.attachment;
  const mediaUrl = a?.url || "";
  const mine = m.reactions?.find((r) => r.userId === meId)?.emoji;
  const isImage = Boolean(a?.mime.startsWith("image/"));
  const isVideo = Boolean(a?.mime.startsWith("video/"));
  const isAudio = Boolean(a && (a.voice || a.mime.startsWith("audio/")));
  const big = !a && !m.replyTo && !m.deleted && !m.undecryptable && onlyEmoji(m.body);
  const receipt = own && !m.deleted ? receiptOf(m, chat) : null;

  // Ίδια emoji μαζί, με μετρητή.
  const grouped = new Map<string, string[]>();
  for (const r of m.reactions || [])
    grouped.set(r.emoji, [...(grouped.get(r.emoji) || []), r.userId]);

  const ratio = a?.width && a?.height ? `${a.width} / ${a.height}` : undefined;

  return (
    <div
      id={`m-${m.id}`}
      className={`msg ${own ? "own" : ""} ${highlighted ? "flash" : ""}`}
    >
      {showSender && <span className="sender">{senderName}</span>}
      <div
        className={`bubble ${own ? "own" : ""} ${m.deleted ? "deleted" : ""} ${big ? "big-emoji" : ""} ${isImage || isVideo ? "media" : ""}`}
        onClick={(e) => {
          // Το πάτημα σε σύνδεσμο/αρχείο/παράθεση/player κάνει τη δική του δουλειά.
          if ((e.target as HTMLElement).closest("a, .quote, .voice-player, .media-open")) return;
          toggleMenu();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!menuOpen) toggleMenu();
        }}
      >
        {m.forwarded && !m.deleted && (
          <span className="forwarded">
            <Forward size={12} /> {t("msg.forwarded")}
          </span>
        )}
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
            {isImage && a ? (
              <button
                className="media-open"
                onClick={onOpenMedia}
                style={{ aspectRatio: ratio }}
                aria-label={a.name}
              >
                {mediaUrl ? (
                  <img
                    className="message-image"
                    src={mediaUrl}
                    alt={a.name}
                    onLoad={onMediaLoad}
                  />
                ) : (
                  <span className="media-placeholder" />
                )}
              </button>
            ) : isVideo && a ? (
              <button
                className="media-open video"
                onClick={onOpenMedia}
                style={{ aspectRatio: ratio }}
                aria-label={a.name}
              >
                {a.poster ? (
                  <img className="message-image" src={a.poster} alt="" onLoad={onMediaLoad} />
                ) : (
                  <span className="media-placeholder" />
                )}
                <span className="play-badge">
                  <Play size={22} />
                </span>
                {a.duration ? <small className="media-duration">{clock(a.duration)}</small> : null}
              </button>
            ) : isAudio && a ? (
              <VoicePlayer
                attachment={a}
                own={own}
                avatar={a.voice && !own ? senderAvatar : undefined}
              />
            ) : a ? (
              <a
                className="file-card"
                href={mediaUrl || "#"}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  // Κρυπτογραφημένο αρχείο: κατεβαίνει και ανοίγει μόνο όταν το ζητήσεις.
                  if (a.key || !mediaUrl) {
                    e.preventDefault();
                    onOpenFile();
                  }
                }}
              >
                {a.key ? <Download /> : <FileText />}
                <span>
                  <b>{a.name}</b>
                  <small>{fileSize(a.size)}</small>
                </span>
              </a>
            ) : null}
            {m.undecryptable ? (
              <p className="undecryptable">
                <LockKeyhole size={12} />{" "}
                {t(m.pendingKey ? "msg.pendingKey" : "msg.undecryptable")}
              </p>
            ) : (
              m.body && (
                <p>
                  <Linkified text={m.body} />
                </p>
              )
            )}
          </>
        )}
        <small>
          {m.editedAt && !m.deleted && <span className="edited">{t("msg.edited")}</span>}
          {time(m.createdAt)}{" "}
          {receipt === "waiting" ? (
            <Clock aria-label={t("msg.waiting")} />
          ) : receipt === "read" ? (
            <CheckCheck className="read" aria-label={t("msg.read")} />
          ) : receipt === "delivered" ? (
            <CheckCheck aria-label={t("msg.delivered")} />
          ) : receipt === "sent" ? (
            <Check aria-label={t("msg.sent")} />
          ) : null}
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
            {!m.deleted && !m.undecryptable && (m.body || a) && (
              <button onClick={onForward}>
                <Forward /> {t("msg.forward")}
              </button>
            )}
            {!m.deleted && m.body && !m.undecryptable && (
              <button onClick={onCopy}>
                <Copy /> {t("msg.copy")}
              </button>
            )}
            {canReply && editable(m, meId) && !isAudio && (
              <button onClick={onEdit}>
                <Pencil /> {t("msg.edit")}
              </button>
            )}
            {!own && !m.deleted && onReport && (
              <button className="danger" onClick={onReport}>
                <Flag /> {t("chat.report")}
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
