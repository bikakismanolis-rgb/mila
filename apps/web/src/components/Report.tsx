// Αναφορά για ένα μήνυμα, μια ομάδα ή έναν άνθρωπο.
//
// Τα μηνύματα είναι κρυπτογραφημένα από άκρη σε άκρη: οι συντονιστές δεν τα
// διαβάζουν. Αν ο χρήστης το θέλει (και μόνο τότε, με το κουτάκι), αυτή η
// συσκευή στέλνει μαζί με την αναφορά το κείμενο που ήδη βλέπει: το μήνυμα, ή
// τα τελευταία μηνύματα της συνομιλίας. Πριν σταλεί, φαίνεται ακριβώς τι θα φύγει.

import React, { useMemo, useState } from "react";
import { Flag } from "lucide-react";
import * as backend from "../data";
import type { Chat, Msg, User } from "../data";
import { t } from "../i18n";
import { Modal } from "./common";

export type ReportTarget =
  | { kind: "message"; message: Msg }
  | { kind: "group" }
  | { kind: "person"; person: User };

/** Πόσα από τα τελευταία μηνύματα στέλνονται σε αναφορά ομάδας ή ανθρώπου
 *  (όπως στο WhatsApp). */
const RECENT = 5;
/** Ίδιο όριο με τη βάση. */
const MAX_EXCERPT = 4000;

/** Μία γραμμή του αποσπάσματος: «[2026-10-27 12:03 UTC] Όνομα: κείμενο». Η ώρα
 *  σε UTC, ώστε ο συντονιστής να τη βρίσκει όπως είναι στη βάση. */
function line(m: Msg, nameOf: (userId: string, fallback?: string | null) => string): string {
  const a = m.attachment;
  const what = [
    a ? (a.voice ? t("report.voice") : t("report.attachment", { name: a.name })) : "",
    m.body,
  ]
    .filter(Boolean)
    .join(" ");
  const at = new Date(m.createdAt).toISOString().slice(0, 16).replace("T", " ");
  return `[${at} UTC] ${nameOf(m.senderId, m.senderName)}: ${what}`;
}

/** Ό,τι μπορεί να σταλεί: μόνο μηνύματα που αυτή η συσκευή έχει ανοίξει. */
const readable = (m: Msg) =>
  !m.deleted && !m.undecryptable && Boolean(m.body || m.attachment);

export function ReportDialog({
  target,
  chat,
  me,
  messages,
  nameOf,
  done,
  close,
}: {
  target: ReportTarget;
  chat: Chat;
  me: User;
  /** Τα μηνύματα που έχει φορτώσει η οθόνη, για το απόσπασμα. */
  messages: Msg[];
  nameOf: (userId: string, fallback?: string | null) => string;
  done: () => void;
  close: () => void;
}) {
  const [reason, setReason] = useState(""),
    [share, setShare] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");

  const picked = useMemo(
    () =>
      target.kind === "message"
        ? [target.message].filter(readable)
        : messages
            .filter((m) =>
              target.kind === "person" ? m.senderId === target.person.id : m.senderId !== me.id,
            )
            .filter(readable)
            .slice(-RECENT),
    [target, messages, me.id],
  );
  const excerpt = picked.map((m) => line(m, nameOf)).join("\n").slice(0, MAX_EXCERPT);

  const title =
    target.kind === "message"
      ? t("report.titleMessage")
      : target.kind === "group"
        ? t("report.titleGroup", { name: chat.name || t("chat.group") })
        : t("chat.reportTitle", { name: target.person.name });

  async function send() {
    if (!reason.trim() || working) return;
    setWorking(true);
    setError("");
    try {
      await backend.sendReport({
        reason: reason.trim(),
        conversationId: chat.id,
        messageId: target.kind === "message" ? target.message.id : undefined,
        userId: target.kind === "person" ? target.person.id : undefined,
        excerpt: share && excerpt ? excerpt : undefined,
      });
      done();
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("err.generic"));
      setWorking(false);
    }
  }

  return (
    <Modal title={title} icon={<Flag size={18} />} close={close} locked={working}>
      <p>{target.kind === "group" ? t("report.textGroup") : t("chat.reportText")}</p>
      <textarea
        className="modal-field"
        autoFocus
        rows={3}
        maxLength={500}
        value={reason}
        placeholder={t("chat.reportPlaceholder")}
        onChange={(e) => setReason(e.target.value)}
        disabled={working}
      />
      {excerpt ? (
        <>
          <div className="mute-options report-share">
            <label>
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => setShare(e.target.checked)}
                disabled={working}
              />
              {target.kind === "message"
                ? t("report.shareMessage")
                : t("report.shareRecent", { n: picked.length })}
            </label>
          </div>
          {share && (
            <>
              <p className="hint">{t("report.preview")}</p>
              <pre className="report-preview">{excerpt}</pre>
            </>
          )}
          <p className="hint">{t("report.shareHint")}</p>
        </>
      ) : (
        <p className="hint">{t("report.nothingToShare")}</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={close} disabled={working}>
          {t("common.cancel")}
        </button>
        <button className="danger" onClick={send} disabled={!reason.trim() || working}>
          {working ? t("common.working") : t("chat.reportSend")}
        </button>
      </div>
    </Modal>
  );
}
