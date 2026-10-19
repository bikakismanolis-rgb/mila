// «Κάλεσε φίλο»: ετοιμάζει ένα μήνυμα πρόσκλησης και ανοίγει τα SMS, το
// WhatsApp ή το email ΤΟΥ ΧΡΗΣΤΗ για να το στείλει ο ίδιος.
//
// ΙΔΙΩΤΙΚΟΤΗΤΑ: ό,τι γράφεται εδώ (κινητό ή email) μένει ΜΟΝΟ σε αυτό το
// component. Δεν περνάει από το data.ts, δεν πάει στη βάση, δεν σώζεται σε
// localStorage, δεν μπαίνει σε log. Χτίζει ένα link (sms:, mailto:, wa.me) και
// το ανοίγει· μετά το πεδίο αδειάζει. Αν αλλάξει ποτέ αυτό, πρέπει να αλλάξει
// και το κείμενο της οθόνης και η πολιτική απορρήτου.

import React, { useState } from "react";
import { Copy, LockKeyhole, Mail, MessageSquare, Share2 } from "lucide-react";
import type { User } from "../data";
import { publicSiteUrl } from "../platform";
import { t } from "../i18n";
import { Modal } from "./common";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Ελληνικό ή διεθνές κινητό σε μορφή +30…, ή null. Μόνο για να χτιστεί το link. */
function asPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^[+0-9\s().-]{8,22}$/.test(trimmed)) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  if (!digits.startsWith("+")) {
    // 69xxxxxxxx / 2xxxxxxxxx: ελληνικός αριθμός χωρίς πρόθεμα χώρας.
    digits = /^[26]\d{9}$/.test(digits) ? "+30" + digits : "+" + digits;
  }
  const count = digits.replace(/\D/g, "").length;
  return count >= 8 && count <= 15 ? digits : null;
}

export function InviteDialog({
  me,
  initial = "",
  close,
}: {
  me: User;
  /** Π.χ. το email που ψάχτηκε και δεν βρέθηκε. */
  initial?: string;
  close: () => void;
}) {
  const [target, setTarget] = useState(initial),
    [withEmail, setWithEmail] = useState(Boolean(me.email)),
    [notice, setNotice] = useState("");

  const phone = asPhone(target);
  const email = EMAIL.test(target.trim()) ? target.trim() : null;

  const message =
    t("invite.message", { url: publicSiteUrl }) +
    (withEmail && me.email ? "\n" + t("invite.findMe", { email: me.email }) : "");

  function open(href: string, newTab = false) {
    if (newTab) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.href = href;
    // Ο αριθμός / το email δεν χρειάζεται πια· δεν τον κρατάμε ούτε στη μνήμη.
    setTarget("");
    setNotice(t("invite.opened"));
  }

  async function share() {
    try {
      await navigator.share({ title: "Mila", text: message });
      setNotice(t("invite.opened"));
    } catch {
      // Ακύρωσε ο χρήστης: τίποτα να γίνει.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setNotice(t("invite.copied"));
    } catch {
      setNotice(t("msg.copyFailed"));
    }
  }

  const body = encodeURIComponent(message);

  return (
    <Modal title={t("invite.title")} icon={<Share2 size={18} />} close={close}>
      <p className="hint invite-lede">{t("invite.lede")}</p>

      <label>
        {t("invite.field")}
        <input
          className="modal-field"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setNotice("");
          }}
          placeholder={t("invite.placeholder")}
          // Να μην το θυμάται ούτε ο browser.
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          name="mila-invite-nosave"
        />
      </label>

      <p className="invite-privacy">
        <LockKeyhole size={15} />
        <span>
          <b>{t("invite.privacyTitle")}</b> {t("invite.privacyText")}
        </span>
      </p>

      {me.email && (
        <label className="invite-check">
          <input
            type="checkbox"
            checked={withEmail}
            onChange={(e) => setWithEmail(e.target.checked)}
          />
          <span>{t("invite.includeEmail", { email: me.email })}</span>
        </label>
      )}

      <pre className="invite-preview">{message}</pre>

      <div className="invite-actions">
        {phone && (
          <>
            <button type="button" onClick={() => open(`sms:${phone}?&body=${body}`)}>
              <MessageSquare size={16} /> {t("invite.sms")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => open(`https://wa.me/${phone.replace(/\D/g, "")}?text=${body}`, true)}
            >
              {t("invite.whatsapp")}
            </button>
          </>
        )}
        {email && (
          <button
            type="button"
            onClick={() =>
              open(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(t("invite.subject"))}&body=${body}`)
            }
          >
            <Mail size={16} /> {t("invite.email")}
          </button>
        )}
        {!phone && !email && target.trim().length > 3 && (
          <p className="hint">{t("invite.notRecognised")}</p>
        )}
        {"share" in navigator && (
          <button type="button" className="secondary" onClick={() => void share()}>
            <Share2 size={16} /> {t("invite.share")}
          </button>
        )}
        <button type="button" className="ghost" onClick={() => void copy()}>
          <Copy size={16} /> {t("invite.copy")}
        </button>
      </div>
      {notice && <p className="notice">{notice}</p>}
    </Modal>
  );
}
