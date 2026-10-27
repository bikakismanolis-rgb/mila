// «Άνοιξε τις ειδοποιήσεις»: μια κάρτα στην κορυφή της λίστας συνομιλιών (όπως
// στο WhatsApp), και μία ερώτηση, μία φορά, όταν τελειώσει η πρώτη κλήση που
// κάνει ο χρήστης. Χωρίς αυτά οι ειδοποιήσεις ανοίγουν μόνο από τις Ρυθμίσεις,
// και οι περισσότεροι δεν θα μάθαιναν ποτέ ότι τους έγραψαν ή τους κάλεσαν.
//
// Δεν επιμένει: αν την κλείσεις, ξαναφαίνεται μετά από 14 ημέρες· αν έχεις πει
// «όχι» στον browser, δεν φαίνεται ποτέ (εκεί μένει μόνο η εξήγηση στις
// Ρυθμίσεις). Στο iPhone/iPad, από τον Safari, ειδοποιήσεις δεν γίνονται: η
// κάρτα λέει πώς μπαίνει το Mila στην αρχική οθόνη.

import React, { useEffect, useState } from "react";
import { BellRing, Share, X } from "lucide-react";
import * as calls from "../calls";
import { enablePush, pushOfferAgain, pushSupported, setPushOfferAgain } from "../push";
import { isIOS, isNative, isStandalone, isTauri } from "../platform";
import { t, translateError } from "../i18n";
import { Modal } from "./common";

const DISMISSED_KEY = "mila:push-card-dismissed";
const ASKED_KEY = "mila:push-asked-after-call";
const QUIET_DAYS = 14;

// Ιδιωτική περιήγηση χωρίς localStorage: η κάρτα απλώς ξαναφαίνεται.
function stamp(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function setStamp(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Δεν πειράζει: θα ξαναρωτήσει την επόμενη φορά.
  }
}

const quiet = () => Date.now() - stamp(DISMISSED_KEY) < QUIET_DAYS * 86400_000;

/** iPhone/iPad σε απλή καρτέλα του browser: εκεί δεν υπάρχει Web Push. */
const needsHomeScreen = isIOS && !isStandalone && !isNative && !isTauri;

/** Ο browser δεν έχει ρωτήσει ακόμα (ούτε «ναι» ούτε «όχι»), ή είχε πει «ναι»
 *  αλλά οι ειδοποιήσεις έκλεισαν με την αποσύνδεση (δες pushOfferAgain). Τότε
 *  το «Άνοιγμα» δεν δείχνει καν παράθυρο του browser. */
const askable = () =>
  pushSupported &&
  typeof Notification !== "undefined" &&
  (Notification.permission === "default" ||
    (Notification.permission === "granted" && pushOfferAgain()));

type Offer = "enable" | "homeScreen" | null;

function currentOffer(): Offer {
  if (quiet()) return null;
  if (needsHomeScreen) return "homeScreen";
  return askable() ? "enable" : null;
}

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

/** Ανοίγει τις ειδοποιήσεις. Καλείται κατευθείαν από το πάτημα: το iOS
 *  δείχνει το παράθυρο άδειας μόνο τότε. "" αν πέτυχε, αλλιώς το σφάλμα.
 *  Όποιος δείχνει την κατάσταση (οι Ρυθμίσεις, η κάρτα) ξανακοιτάζει. */
async function turnOn(): Promise<string> {
  try {
    await enablePush();
    return "";
  } catch (caught) {
    return messageOf(caught);
  } finally {
    window.dispatchEvent(new Event("mila:push-changed"));
  }
}

export function PushCard({ notify }: { notify: (message: string) => void }) {
  const [offer, setOffer] = useState<Offer>(currentOffer),
    [working, setWorking] = useState(false);

  // Απαντήθηκε αλλού (η ερώτηση μετά την κλήση, οι Ρυθμίσεις).
  useEffect(() => {
    const again = () => setOffer(currentOffer());
    window.addEventListener("mila:push-changed", again);
    return () => window.removeEventListener("mila:push-changed", again);
  }, []);

  if (!offer) return null;

  async function enable() {
    if (working) return;
    setWorking(true);
    const error = await turnOn();
    setWorking(false);
    notify(error || t("pushCard.done"));
    setOffer(currentOffer());
  }

  function dismiss() {
    setStamp(DISMISSED_KEY);
    setPushOfferAgain(false);
    setOffer(null);
  }

  const title = offer === "homeScreen" ? t("pushCard.iosTitle") : t("pushCard.title");
  return (
    <div className="push-card" role="region" aria-label={title}>
      <span className="push-card-icon">
        {offer === "homeScreen" ? <Share size={18} /> : <BellRing size={18} />}
      </span>
      <div className="push-card-text">
        <b>{title}</b>
        <p>{offer === "homeScreen" ? t("pushCard.iosText") : t("pushCard.text")}</p>
        {offer === "enable" && (
          <button className="push-card-action" onClick={() => void enable()} disabled={working}>
            {working ? t("common.working") : t("pushCard.enable")}
          </button>
        )}
      </div>
      <button
        className="icon push-card-close"
        onClick={dismiss}
        aria-label={t("pushCard.dismiss")}
        title={t("pushCard.dismiss")}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Μία φορά, όταν κλείσει η πρώτη κλήση που έκανε ο χρήστης: τότε φαίνεται
 *  γιατί αξίζουν οι ειδοποιήσεις (για να χτυπάει και σε εκείνον). */
export function PushAfterCall({
  meId,
  notify,
}: {
  meId: string;
  notify: (message: string) => void;
}) {
  const [asking, setAsking] = useState(false),
    [working, setWorking] = useState(false);

  useEffect(() => {
    let placed = false;
    return calls.subscribe(() => {
      const view = calls.snapshot().active;
      if (view) {
        if (view.call.callerId === meId) placed = true;
        return;
      }
      if (!placed) return;
      placed = false;
      if (stamp(ASKED_KEY) || quiet() || needsHomeScreen || !askable()) return;
      setStamp(ASKED_KEY);
      setAsking(true);
    });
  }, [meId]);

  if (!asking) return null;

  function done() {
    setAsking(false);
    window.dispatchEvent(new Event("mila:push-changed"));
  }

  async function enable() {
    if (working) return;
    setWorking(true);
    const error = await turnOn();
    setWorking(false);
    notify(error || t("pushCard.done"));
    done();
  }

  return (
    <Modal
      title={t("pushAsk.title")}
      icon={<BellRing size={18} />}
      close={() => {
        setStamp(DISMISSED_KEY);
        setPushOfferAgain(false);
        done();
      }}
      locked={working}
    >
      <p>{t("pushAsk.text")}</p>
      <div className="modal-actions">
        <button
          className="ghost"
          onClick={() => {
            setStamp(DISMISSED_KEY);
            setPushOfferAgain(false);
            done();
          }}
          disabled={working}
        >
          {t("pushCard.dismiss")}
        </button>
        <button className="primary" onClick={() => void enable()} disabled={working}>
          {t("pushCard.enable")}
        </button>
      </div>
    </Modal>
  );
}
