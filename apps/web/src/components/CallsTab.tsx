// Ιστορικό κλήσεων: η καρτέλα «Κλήσεις», και οι κλήσεις όπως φαίνονται μέσα
// στη συνομιλία («Αναπάντητη βιντεοκλήση», «Κλήση · 3:12»).

import React, { useEffect, useState } from "react";
import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Video,
} from "lucide-react";
import * as backend from "../data";
import type { Call, Chat, User } from "../data";
import { t, translateError } from "../i18n";
import { listTime, time } from "../format";
import { Empty } from "./common";
import { chatAvatar, chatTitle } from "./Conversation";
import { clock } from "./Call";

export type CallSummary = {
  outgoing: boolean;
  missed: boolean;
  ongoing: boolean;
  /** Π.χ. «Αναπάντητη βιντεοκλήση», «Εξερχόμενη κλήση». */
  label: string;
  /** Διάρκεια ή λόγος («Δεν απάντησε», «Κατειλημμένο»). */
  detail: string;
};

export function describeCall(call: Call, meId: string): CallSummary {
  const outgoing = call.callerId === meId;
  const mine = call.participants.find((p) => p.userId === meId);
  const ongoing = call.status !== "ended";
  const answered = Boolean(call.answeredAt);
  const iJoined = Boolean(mine?.joinedAt);
  const missed = !outgoing && !ongoing && !iJoined && mine?.state !== "declined";
  const seconds =
    answered && call.endedAt
      ? (Date.parse(call.endedAt) - Date.parse(call.answeredAt!)) / 1000
      : 0;

  const kind = call.video ? "video" : "voice";
  let label: string;
  if (ongoing) label = t(kind === "video" ? "calls.ongoingVideo" : "calls.ongoingVoice");
  else if (missed) label = t(kind === "video" ? "calls.missedVideo" : "calls.missedVoice");
  else if (outgoing) label = t(kind === "video" ? "calls.outgoingVideo" : "calls.outgoingVoice");
  else label = t(kind === "video" ? "calls.incomingVideo" : "calls.incomingVoice");

  let detail = "";
  if (!ongoing) {
    // Σήκωσαν, αλλά η σύνδεση δεν στήθηκε ποτέ: όχι διάρκεια, το γιατί.
    if (call.endReason === "failed") detail = t("call.failed");
    else if (answered && (iJoined || outgoing) && seconds >= 1) detail = clock(seconds);
    else if (outgoing && call.endReason === "busy") detail = t("call.busy");
    else if (outgoing && call.endReason === "declined") detail = t("call.declined");
    else if (outgoing && !answered) detail = t("call.noAnswer");
    else if (!outgoing && mine?.state === "declined") detail = t("calls.youDeclined");
  }
  return { outgoing, missed, ongoing, label, detail };
}

export function CallIcon({ summary, size = 15 }: { summary: CallSummary; size?: number }) {
  if (summary.missed) return <PhoneMissed size={size} className="call-icon-missed" />;
  if (summary.outgoing) return <PhoneOutgoing size={size} />;
  return <PhoneIncoming size={size} />;
}

/** Μέσα στη συνομιλία: μια κλήση ως «συμβάν» ανάμεσα στα μηνύματα. */
export function CallEntry({
  call,
  me,
  inThisCall,
  onCall,
  onJoin,
}: {
  call: Call;
  me: User;
  inThisCall: boolean;
  onCall: (video: boolean) => void;
  onJoin: (call: Call) => void;
}) {
  const summary = describeCall(call, me.id);
  return (
    <div className={`call-entry ${summary.missed ? "missed" : ""}`}>
      <button
        onClick={() => (summary.ongoing ? !inThisCall && onJoin(call) : onCall(call.video))}
        title={summary.ongoing ? t("calls.join") : t("calls.callBack")}
      >
        {call.video ? <Video size={15} /> : <CallIcon summary={summary} />}
        <span>
          <b>{summary.label}</b>
          <small>
            {[summary.detail, time(call.createdAt)].filter(Boolean).join(" · ")}
          </small>
        </span>
        {summary.ongoing && !inThisCall && <em>{t("calls.join")}</em>}
      </button>
    </div>
  );
}

/** Η καρτέλα «Κλήσεις». */
export function CallsList({
  me,
  chats,
  version,
  onCall,
  onOpenChat,
}: {
  me: User;
  chats: Chat[];
  /** Αλλάζει όταν έρχεται νέα κλήση ή αλλάζει μια κλήση. */
  version: number;
  onCall: (chat: Chat, video: boolean) => void;
  onOpenChat: (chatId: string) => void;
}) {
  const [list, setList] = useState<Call[] | null>(null),
    [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    backend
      .listCalls()
      .then((items) => {
        if (!alive) return;
        setList(items);
        setError("");
      })
      .catch((caught) => {
        if (alive)
          setError(
            translateError(caught instanceof Error ? caught.message : "") || t("err.loadCalls"),
          );
      });
    return () => {
      alive = false;
    };
  }, [version]);

  // Ό,τι φάνηκε εδώ δεν μετράει πια ως «αναπάντητη» στο σήμα της καρτέλας.
  useEffect(() => {
    if (list) markCallsSeen();
  }, [list]);

  const rows = (list || [])
    .map((call) => ({ call, chat: chats.find((c) => c.id === call.conversationId) }))
    .filter((row): row is { call: Call; chat: Chat } => Boolean(row.chat));

  return (
    <div className="chatlist calls-list">
      {error && <p className="error list-error">{error}</p>}
      {rows.map(({ call, chat }) => {
        const summary = describeCall(call, me.id);
        const blocked = chat.blockedByMe || chat.others[0]?.deleted;
        return (
          <div key={call.id} className="call-row">
            <button className="call-row-main" onClick={() => onOpenChat(chat.id)}>
              <div className="avatar">
                <img src={chatAvatar(chat)} alt="" />
              </div>
              <span>
                <strong>
                  <span className={`title ${summary.missed ? "call-icon-missed" : ""}`}>
                    {chatTitle(chat)}
                  </span>
                  <time>{listTime(call.createdAt)}</time>
                </strong>
                <small>
                  <CallIcon summary={summary} size={13} /> {summary.label}
                  {summary.detail ? ` · ${summary.detail}` : ""}
                </small>
              </span>
            </button>
            {!blocked && chat.requestStatus === "accepted" && (
              <button
                className="icon call-row-action"
                onClick={() => onCall(chat, call.video)}
                aria-label={call.video ? t("chat.videoCall") : t("chat.voiceCall")}
                title={call.video ? t("chat.videoCall") : t("chat.voiceCall")}
              >
                {call.video ? <Video size={18} /> : <Phone size={18} />}
              </button>
            )}
          </div>
        );
      })}
      {list && !rows.length && !error && (
        <Empty icon={<Phone />} title={t("calls.emptyTitle")} text={t("calls.emptyText")} />
      )}
    </div>
  );
}

// --- Σήμα αναπάντητων στην καρτέλα -------------------------------------------

const SEEN_KEY = "mila:calls-seen";

function seenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function markCallsSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    // Ιδιωτική περιήγηση: το σήμα απλώς μένει.
  }
  window.dispatchEvent(new Event("mila:calls-seen"));
}

/** Πόσες αναπάντητες κλήσεις υπάρχουν από την τελευταία φορά που άνοιξε η καρτέλα. */
export function unseenMissed(chats: Chat[], meId: string): number {
  const since = seenAt();
  return chats.filter((c) => {
    const call = c.lastCall;
    return (
      call &&
      Date.parse(call.createdAt) > since &&
      describeCall(call, meId).missed
    );
  }).length;
}
