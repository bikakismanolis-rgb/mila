// Φωτογραφίες και βίντεο: προβολή σε όλη την οθόνη, προεπισκόπηση πριν την
// αποστολή (με λεζάντα), και προώθηση σε άλλες συνομιλίες.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Forward,
  Play,
  SendHorizontal,
  X,
} from "lucide-react";
import * as backend from "../data";
import type { Chat, MediaInfo, Msg } from "../data";
import { t } from "../i18n";
import { dayLabel, fileSize, time } from "../format";
import { canSqueezeVideo, prepareSqueeze, prepareVideo, preparePhoto } from "../media";
import { fitsUpload, shouldSqueeze, videoPlan } from "../limits";
import { Modal } from "./common";
import { chatAvatar, chatTitle } from "./Conversation";

const MAX_FILES = 10;

export const isVisual = (mime?: string) =>
  Boolean(mime && (mime.startsWith("image/") || mime.startsWith("video/")));

// ---------------------------------------------------------------------------
// Προβολή
// ---------------------------------------------------------------------------

export function MediaViewer({
  items,
  startId,
  nameOf,
  close,
  onForward,
}: {
  /** Όλα τα μηνύματα με εικόνα ή βίντεο που έχουν φορτώσει, με τη σειρά. */
  items: Msg[];
  startId: string;
  nameOf: (userId: string, fallback?: string | null) => string;
  close: () => void;
  onForward: (message: Msg) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(0, items.findIndex((m) => m.id === startId)),
  );
  const [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false);
  const touch = useRef<number | null>(null);
  const current = items[index];
  const attachment = current?.attachment;

  useEffect(() => {
    let alive = true;
    setFailed(false);
    if (!attachment) return;
    if (attachment.url) {
      setUrl(attachment.url);
      return;
    }
    setUrl("");
    backend
      .mediaUrl(attachment)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attachment]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, items.length]);

  if (!current || !attachment) return null;
  const video = attachment.mime.startsWith("video/");

  return (
    <div
      className="viewer"
      role="dialog"
      aria-label={attachment.name}
      onTouchStart={(e) => {
        touch.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        const end = e.changedTouches[0]?.clientX;
        touch.current = null;
        if (start === null || end === undefined) return;
        if (end - start > 60) setIndex((i) => Math.max(0, i - 1));
        if (start - end > 60) setIndex((i) => Math.min(items.length - 1, i + 1));
      }}
    >
      <header>
        <button className="viewer-btn" onClick={close} aria-label={t("common.close")}>
          <X />
        </button>
        <span>
          <b>{nameOf(current.senderId, current.senderName)}</b>
          <small>
            {dayLabel(current.createdAt)}, {time(current.createdAt)}
          </small>
        </span>
        <button
          className="viewer-btn"
          onClick={() => onForward(current)}
          aria-label={t("msg.forward")}
          title={t("msg.forward")}
        >
          <Forward />
        </button>
        <button
          className="viewer-btn"
          onClick={() => void backend.openAttachment(attachment).catch(() => setFailed(true))}
          aria-label={t("chat.download")}
          title={t("chat.download")}
        >
          <Download />
        </button>
      </header>
      <div className="viewer-stage" onClick={(e) => e.target === e.currentTarget && close()}>
        {index > 0 && (
          <button
            className="viewer-nav prev"
            onClick={() => setIndex(index - 1)}
            aria-label={t("common.back")}
          >
            <ChevronLeft />
          </button>
        )}
        {failed ? (
          <p className="viewer-error">{t("err.download")}</p>
        ) : !url ? (
          <p className="viewer-error">{t("common.loading")}</p>
        ) : video ? (
          <video key={url} src={url} controls autoPlay playsInline poster={attachment.poster} />
        ) : (
          <img src={url} alt={attachment.name} />
        )}
        {index < items.length - 1 && (
          <button
            className="viewer-nav next"
            onClick={() => setIndex(index + 1)}
            aria-label={t("common.next")}
          >
            <ChevronRight />
          </button>
        )}
      </div>
      {current.body && <p className="viewer-caption">{current.body}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Πριν την αποστολή
// ---------------------------------------------------------------------------

export type Prepared = { file: File; info: MediaInfo };

type Item = {
  source: File;
  prepared: Prepared | null;
  preview: string;
  error: string;
  /** Μεγάλο βίντεο που θα μικρύνει πριν φύγει (media.ts, prepareSqueeze). */
  squeeze: boolean;
};

/** Οι φωτογραφίες μικραίνουν, τα βίντεο παίρνουν μικρογραφία (και τα μεγάλα
 *  συμπιέζονται, όταν πατηθεί η αποστολή). Μετά φεύγουν. */
export function SendFilesDialog({
  files,
  initialCaption,
  send,
  close,
}: {
  files: File[];
  initialCaption: string;
  send: (items: Prepared[], caption: string) => void;
  close: () => void;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    files.slice(0, MAX_FILES).map((source) => ({
      source,
      prepared: null,
      preview: "",
      error: "",
      squeeze: false,
    })),
  );
  const [caption, setCaption] = useState(initialCaption),
    [active, setActive] = useState(0),
    // Όσο μικραίνει κάποιο βίντεο: ποιο (i από n) και πόσο (0-100).
    [squeezing, setSqueezing] = useState<{ i: number; n: number; p: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Κλείνει το παράθυρο (π.χ. άλλαξε συνομιλία): η συμπίεση σταματά.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    void Promise.all(
      files.slice(0, MAX_FILES).map(async (source, i) => {
        let prepared: Prepared;
        if (source.type.startsWith("image/")) prepared = await preparePhoto(source);
        else if (source.type.startsWith("video/"))
          prepared = { file: source, info: await prepareVideo(source) };
        else prepared = { file: source, info: {} };
        let preview = "";
        if (prepared.file.type.startsWith("image/")) {
          preview = URL.createObjectURL(prepared.file);
          urls.push(preview);
        } else if (prepared.info.poster) preview = prepared.info.poster;
        const { duration, width, height } = prepared.info;
        const squeeze =
          source.type.startsWith("video/") &&
          canSqueezeVideo &&
          shouldSqueeze(prepared.file.size, duration) &&
          videoPlan(duration || 0, width || 0, height || 0) !== null;
        const error = !fitsUpload(prepared.file.size) && !squeeze ? t("err.fileTooLarge") : "";
        if (alive)
          setItems((list) =>
            list.map((item, j) =>
              j === i ? { ...item, prepared, preview, error, squeeze } : item,
            ),
          );
      }),
    );
    return () => {
      alive = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [files]);

  const ready =
    !squeezing && items.every((i) => i.prepared) && items.some((i) => !i.error);
  const shown = items[active] || items[0];

  function submit() {
    if (!ready) return;
    const chosen = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.prepared && !item.error);
    const targets = chosen.filter(({ item }) => item.squeeze);
    if (!targets.length) {
      send(chosen.map(({ item }) => item.prepared!), caption.trim());
      return;
    }
    // Μέσα στο πάτημα, πριν από κάθε await (δες prepareSqueeze).
    const batch = prepareSqueeze(targets.map(({ item }) => item.prepared!.file));
    void squeezeAndSend(chosen, targets, batch);
  }

  async function squeezeAndSend(
    chosen: { item: Item; index: number }[],
    targets: { item: Item; index: number }[],
    batch: ReturnType<typeof prepareSqueeze>,
  ) {
    const controller = new AbortController();
    abort.current = controller;
    const done = new Map<number, Prepared | null>();
    try {
      for (let k = 0; k < targets.length; k++) {
        const { item, index } = targets[k];
        setSqueezing({ i: k + 1, n: targets.length, p: 0 });
        const out = batch
          ? await batch.run(
              k,
              (fraction) => {
                const p = Math.floor(fraction * 100);
                setSqueezing((s) => (s && s.p !== p ? { ...s, p } : s));
              },
              controller.signal,
            )
          : null;
        // Ακύρωση: πίσω στο παράθυρο, δεν φεύγει τίποτα.
        if (controller.signal.aborted) return;
        // Κρατάμε το μικρό μόνο αν όντως μίκρυνε.
        done.set(
          index,
          out && out.file.size < item.prepared!.file.size
            ? { file: out.file, info: { ...item.prepared!.info, width: out.width, height: out.height } }
            : null,
        );
      }
    } finally {
      batch?.dispose();
      if (abort.current === controller) abort.current = null;
      setSqueezing(null);
    }

    // Όσα δεν μίκρυναν: φεύγουν όπως είναι αν χωράνε, αλλιώς «πολύ μεγάλο».
    let tooLarge = false;
    const next = items.map((item, index) => {
      if (!done.has(index)) return item;
      const small = done.get(index);
      if (small) return { ...item, prepared: small, squeeze: false };
      if (fitsUpload(item.prepared!.file.size)) return { ...item, squeeze: false };
      tooLarge = true;
      return { ...item, squeeze: false, error: t("err.fileTooLarge") };
    });
    setItems(next);
    // Κάποιο δεν χωράει: ο χρήστης το βλέπει, και στέλνει τα υπόλοιπα αν θέλει.
    if (tooLarge) return;
    send(
      chosen.map(({ index }) => next[index].prepared!),
      caption.trim(),
    );
  }

  return (
    <Modal title={t("send.title", { n: items.length })} close={close} locked={Boolean(squeezing)}>
      <div className="send-preview">
        {!shown?.prepared ? (
          <p className="hint">{t("send.preparing")}</p>
        ) : shown.preview ? (
          <div className="send-preview-media">
            <img src={shown.preview} alt="" />
            {shown.source.type.startsWith("video/") && (
              <span className="play-badge">
                <Play size={22} />
              </span>
            )}
          </div>
        ) : (
          <div className="file-card">
            <FileText />
            <span>
              <b>{shown.source.name}</b>
              <small>{fileSize(shown.prepared.file.size)}</small>
            </span>
          </div>
        )}
        {shown?.error && <p className="error">{shown.error}</p>}
        {shown?.squeeze && !shown.error && !squeezing && (
          <p className="hint">{t("squeeze.note")}</p>
        )}
      </div>
      {items.length > 1 && (
        <div className="send-strip">
          {items.map((item, i) => (
            <button
              key={i}
              className={i === active ? "on" : ""}
              onClick={() => setActive(i)}
              aria-label={item.source.name}
            >
              {item.preview ? <img src={item.preview} alt="" /> : <FileText size={18} />}
            </button>
          ))}
        </div>
      )}
      {files.length > MAX_FILES && <p className="hint">{t("send.tooMany", { n: MAX_FILES })}</p>}
      {squeezing ? (
        <div className="squeeze-progress" role="status">
          <span>
            {squeezing.n > 1
              ? t("squeeze.workingN", { i: squeezing.i, n: squeezing.n, p: squeezing.p })
              : t("squeeze.working", { p: squeezing.p })}
          </span>
          <progress max={100} value={squeezing.p} />
          <small className="hint">{t("squeeze.keepOpen")}</small>
          <button className="ghost" onClick={() => abort.current?.abort()}>
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <div className="send-caption">
          <input
            className="modal-field"
            autoFocus
            maxLength={2000}
            value={caption}
            placeholder={t("send.caption")}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            className="send"
            disabled={!ready}
            onClick={submit}
            aria-label={t("chat.send")}
          >
            <SendHorizontal />
          </button>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Προώθηση
// ---------------------------------------------------------------------------

const MAX_FORWARD = 5;

export function ForwardDialog({
  chats,
  message,
  forward,
  close,
}: {
  chats: Chat[];
  message: Msg;
  forward: (message: Msg, conversationIds: string[]) => Promise<void>;
  close: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");

  const options = useMemo(
    () =>
      chats.filter(
        (c) =>
          c.requestStatus === "accepted" &&
          !c.blockedByMe &&
          !(c.type === "direct" && c.others[0]?.deleted) &&
          chatTitle(c).toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [chats, query],
  );

  async function run() {
    if (!picked.length || working) return;
    setWorking(true);
    setError("");
    try {
      await forward(message, picked);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("err.generic"));
      setWorking(false);
    }
  }

  return (
    <Modal title={t("msg.forwardTo")} icon={<Forward size={18} />} close={close} locked={working}>
      <input
        className="modal-field"
        value={query}
        placeholder={t("list.searchPlaceholder")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="people-picker forward-list">
        {options.map((c) => {
          const on = picked.includes(c.id);
          return (
            <label key={c.id} className={on ? "on" : ""}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && picked.length >= MAX_FORWARD}
                onChange={() =>
                  setPicked((list) => (on ? list.filter((x) => x !== c.id) : [...list, c.id]))
                }
              />
              <img src={chatAvatar(c)} alt="" />
              <span>
                <b>{chatTitle(c)}</b>
              </span>
            </label>
          );
        })}
        {!options.length && <p className="hint">{t("list.noneTitle")}</p>}
      </div>
      {picked.length >= MAX_FORWARD && <p className="hint">{t("msg.forwardLimit", { n: MAX_FORWARD })}</p>}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={close} disabled={working}>
          {t("common.cancel")}
        </button>
        <button className="primary" onClick={() => void run()} disabled={!picked.length || working}>
          {working ? t("common.working") : t("msg.forwardSend", { n: picked.length || "" })}
        </button>
      </div>
    </Modal>
  );
}
