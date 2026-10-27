// Η οθόνη ενός λογαριασμού σε αναστολή (δες supabase/migrations/0014). Αντί
// για ένα app που αποτυγχάνει σε κάθε βήμα: τι έγινε, γιατί, και τι μπορεί
// ακόμα να κάνει ο χρήστης (τα δεδομένα του, διαγραφή, αποσύνδεση).

import React, { useState } from "react";
import { Ban, Download, LogOut, Trash2 } from "lucide-react";
import type { Suspension } from "../data";
import { privacyPolicyUrl } from "../platform";
import { locale, t } from "../i18n";
import { DeleteAccountDialog, downloadMyData } from "./Settings";

const dateFormat = new Intl.DateTimeFormat(locale, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function SuspendedScreen({
  suspension,
  email,
  signOut,
}: {
  suspension: Suspension;
  email: string;
  signOut: () => void;
}) {
  const [downloading, setDownloading] = useState(false),
    [deleting, setDeleting] = useState(false),
    [error, setError] = useState("");

  async function download() {
    setError("");
    setDownloading(true);
    try {
      await downloadMyData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("err.generic"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="login suspended">
      <section className="login-card">
        <div className="brandmark">
          <Ban />
        </div>
        <h1>{t("suspended.title")}</h1>
        <p className="lede">
          {t("suspended.text", { date: dateFormat.format(new Date(suspension.at)) })}
        </p>
        <div className="suspended-reason">
          <b>{t("suspended.reason")}</b>
          <p>{suspension.reason || t("suspended.noReason")}</p>
        </div>
        <p className="hint">
          {t("suspended.contestBefore")}{" "}
          <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
            {t("suspended.contestLink")}
          </a>
          {t("suspended.contestAfter")}
        </p>
        <p className="hint">{t("suspended.stillCan")}</p>
        <button className="secondary" onClick={() => void download()} disabled={downloading}>
          <Download size={15} />
          {downloading ? t("account.preparing") : t("account.download")}
        </button>
        <button className="secondary danger" onClick={() => setDeleting(true)}>
          <Trash2 size={15} />
          {t("account.delete")}
        </button>
        <button onClick={signOut}>
          <LogOut size={15} />
          {t("nav.signOut")}
        </button>
        {error && <p className="error">{error}</p>}
      </section>
      {deleting && <DeleteAccountDialog email={email} close={() => setDeleting(false)} />}
    </main>
  );
}
