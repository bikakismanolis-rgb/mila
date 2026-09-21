// Μικρά κομμάτια που χρησιμοποιούνται παντού: κενή κατάσταση, παράθυρα
// διαλόγου. Τα παράθυρα αντικαθιστούν τα alert/confirm/prompt του browser,
// που δεν μεταφράζονται, δεν ταιριάζουν με το app και σε εγκατεστημένο PWA
// στο iOS δεν εμφανίζονται καν.

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { t } from "../i18n";

export function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function Modal({
  title,
  icon,
  danger,
  close,
  locked,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  danger?: boolean;
  close: () => void;
  /** Όσο τρέχει κάτι που δεν πρέπει να διακοπεί, το παράθυρο δεν κλείνει. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, locked]);

  return (
    <div className="modal-backdrop" onClick={locked ? undefined : close}>
      <div
        className={`modal ${danger ? "danger-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          {icon}
          <span>{title}</span>
          {!locked && (
            <button
              className="modal-close"
              onClick={close}
              aria-label={t("common.close")}
            >
              <X size={18} />
            </button>
          )}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  close,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  close: () => void;
}) {
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");

  async function run() {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await onConfirm();
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("err.generic"));
      setWorking(false);
    }
  }

  return (
    <Modal title={title} danger={danger} close={close} locked={working}>
      <p>{text}</p>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={close} disabled={working}>
          {t("common.cancel")}
        </button>
        <button
          className={danger ? "danger" : "primary"}
          onClick={run}
          disabled={working}
        >
          {working ? t("common.working") : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog({
  title,
  text,
  placeholder,
  initial = "",
  confirmLabel,
  multiline,
  maxLength = 500,
  onSubmit,
  close,
}: {
  title: string;
  text?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel: string;
  multiline?: boolean;
  maxLength?: number;
  onSubmit: (value: string) => Promise<void> | void;
  close: () => void;
}) {
  const [value, setValue] = useState(initial),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const ready = value.trim().length > 0;

  async function run() {
    if (!ready || working) return;
    setWorking(true);
    setError("");
    try {
      await onSubmit(value.trim());
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("err.generic"));
      setWorking(false);
    }
  }

  return (
    <Modal title={title} close={close} locked={working}>
      {text && <p>{text}</p>}
      {multiline ? (
        <textarea
          className="modal-field"
          autoFocus
          rows={4}
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          disabled={working}
        />
      ) : (
        <input
          className="modal-field"
          autoFocus
          maxLength={maxLength}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          disabled={working}
        />
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={close} disabled={working}>
          {t("common.cancel")}
        </button>
        <button className="primary" onClick={run} disabled={!ready || working}>
          {working ? t("common.working") : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
