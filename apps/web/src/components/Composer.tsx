// Το πεδίο γραψίματος: κείμενο, emoji, συνημμένα (φωτογραφίες, κάμερα,
// έγγραφα), φωνητικό, απάντηση σε μήνυμα και επεξεργασία μηνύματος.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Camera,
  CornerUpLeft,
  FileText,
  Images,
  Paperclip,
  Pencil,
  SendHorizontal,
  Smile,
  X,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as backend from "../data";
import type { MediaInfo, Msg, User } from "../data";
import { t } from "../i18n";
import { holdReload, isMobile } from "../platform";
import { EmojiPicker } from "./Emoji";
import { VoiceButton } from "./Voice";
import { messageSnippet } from "./Conversation";

export function Composer({
  me,
  chatId,
  typingChannel,
  replyTo,
  clearReply,
  editing,
  clearEditing,
  busy,
  nameOf,
  onSend,
  onSaveEdit,
  onFiles,
  onVoice,
  onEditLast,
  notify,
}: {
  me: User;
  chatId: string;
  typingChannel: React.MutableRefObject<RealtimeChannel | null>;
  replyTo: Msg | null;
  clearReply: () => void;
  editing: Msg | null;
  clearEditing: () => void;
  /** Κείμενο κατάστασης όσο ανεβαίνει κάτι («Στέλνεται 2/5…»). */
  busy: string;
  nameOf: (userId: string, fallback?: string | null) => string;
  /** Επιστρέφει false αν απέτυχε, για να ξαναμπεί το κείμενο στο πεδίο. */
  onSend: (body: string, reply: Msg | null) => Promise<boolean>;
  onSaveEdit: (message: Msg, body: string) => Promise<boolean>;
  onFiles: (files: File[], caption: string) => void;
  onVoice: (file: File, info: MediaInfo) => void;
  /** Βελάκι πάνω σε άδειο πεδίο: επεξεργασία του τελευταίου μου μηνύματος. */
  onEditLast: () => void;
  notify: (message: string) => void;
}) {
  const [text, setText] = useState(""),
    [emoji, setEmoji] = useState(false),
    [attach, setAttach] = useState(false),
    [recording, setRecording] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null),
    gallery = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null),
    documents = useRef<HTMLInputElement>(null),
    drafts = useRef(new Map<string, string>()),
    recordingTimer = useRef<number | undefined>(undefined);

  // Ό,τι είχες αρχίσει να γράφεις σε κάθε συνομιλία μένει εκεί (όπως στο WhatsApp).
  useEffect(() => {
    setText(drafts.current.get(chatId) || "");
    setEmoji(false);
    setAttach(false);
    return () => {
      const el = field.current;
      if (el) drafts.current.set(chatId, el.value);
    };
  }, [chatId]);

  // Κείμενο που δεν στάλθηκε, εδώ ή σε άλλη συνομιλία (τα drafts είναι μόνο
  // στη μνήμη): η σελίδα δεν ξαναφορτώνει μόνη της για νέα έκδοση.
  const unsent =
    Boolean(text.trim()) ||
    [...drafts.current].some(([id, draft]) => id !== chatId && draft.trim());
  useEffect(() => (unsent ? holdReload() : undefined), [unsent]);

  // Επεξεργασία: το πεδίο γεμίζει με το παλιό κείμενο.
  useEffect(() => {
    if (editing) {
      setText(editing.body);
      requestAnimationFrame(() => {
        field.current?.focus();
        field.current?.setSelectionRange(editing.body.length, editing.body.length);
      });
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) field.current?.focus();
  }, [replyTo]);

  // Το πεδίο μεγαλώνει όσο γράφεις, μέχρι ένα όριο.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  // Σταματάμε το «ηχογραφεί…» αν φύγει η συνομιλία.
  useEffect(() => () => window.clearInterval(recordingTimer.current), []);

  function typing(active: boolean) {
    backend.sendTyping(typingChannel.current, active, me.id);
  }

  function setRecordingActivity(active: boolean) {
    setRecording(active);
    window.clearInterval(recordingTimer.current);
    backend.sendTyping(typingChannel.current, active, me.id, "recording");
    // Ο άλλος το σβήνει μόνος του μετά από 6 δευτερόλεπτα· το ανανεώνουμε.
    if (active)
      recordingTimer.current = window.setInterval(
        () => backend.sendTyping(typingChannel.current, true, me.id, "recording"),
        4000,
      );
  }

  async function submit() {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      if (body === editing.body.trim()) {
        clearEditing();
        setText("");
        return;
      }
      setText("");
      const message = editing;
      clearEditing();
      if (!(await onSaveEdit(message, body))) setText(body);
      return;
    }
    const reply = replyTo;
    setText("");
    drafts.current.delete(chatId);
    clearReply();
    typing(false);
    if (!(await onSend(body, reply))) setText(body);
  }

  function pick(list: FileList | null) {
    const files = [...(list || [])];
    if (files.length) onFiles(files, text.trim());
    for (const input of [gallery, camera, documents]) if (input.current) input.current.value = "";
    setAttach(false);
  }

  function insertEmoji(value: string) {
    const el = field.current;
    if (!el) {
      setText((current) => current + value);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + value.length, start + value.length);
    });
  }

  const showMic = !text.trim() && !editing && !busy;

  return (
    <footer>
      {editing && (
        <div className="reply-bar editing">
          <Pencil size={16} />
          <span>
            <b>{t("msg.editing")}</b>
            <small>{messageSnippet(editing)}</small>
          </span>
          <button
            onClick={() => {
              clearEditing();
              setText("");
            }}
            aria-label={t("common.cancel")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {replyTo && !editing && (
        <div className="reply-bar">
          <CornerUpLeft size={16} />
          <span>
            <b>{nameOf(replyTo.senderId, replyTo.senderName)}</b>
            <small>{messageSnippet(replyTo)}</small>
          </span>
          <button onClick={clearReply} aria-label={t("common.cancel")}>
            <X size={16} />
          </button>
        </div>
      )}
      {emoji && (
        <EmojiPicker onPick={insertEmoji} close={() => setEmoji(false)} />
      )}
      <div className={`composer-row ${recording ? "recording" : ""}`}>
        <input
          ref={gallery}
          type="file"
          hidden
          multiple
          accept="image/*,video/*"
          onChange={(e) => pick(e.target.files)}
        />
        <input
          ref={camera}
          type="file"
          hidden
          accept="image/*,video/*"
          capture="environment"
          onChange={(e) => pick(e.target.files)}
        />
        <input
          ref={documents}
          type="file"
          hidden
          multiple
          onChange={(e) => pick(e.target.files)}
        />
        {!recording && (
          <>
            {!isMobile && (
              <button
                className="plus emoji-toggle"
                onClick={() => setEmoji((open) => !open)}
                aria-label={t("emoji.title")}
                title={t("emoji.title")}
              >
                <Smile />
              </button>
            )}
            <div className="attach-menu">
              <button
                className="plus"
                title={t("chat.attach")}
                aria-label={t("chat.attach")}
                disabled={Boolean(busy)}
                onClick={() => setAttach((open) => !open)}
              >
                <Paperclip />
              </button>
              {attach && (
                <>
                  <div className="click-away" onClick={() => setAttach(false)} />
                  <div className="menu-popover up">
                    <button onClick={() => gallery.current?.click()}>
                      <Images /> {t("attach.gallery")}
                    </button>
                    {isMobile && (
                      <button onClick={() => camera.current?.click()}>
                        <Camera /> {t("attach.camera")}
                      </button>
                    )}
                    <button onClick={() => documents.current?.click()}>
                      <FileText /> {t("attach.document")}
                    </button>
                  </div>
                </>
              )}
            </div>
            <textarea
              ref={field}
              rows={1}
              value={text}
              maxLength={8000}
              onChange={(e) => {
                setText(e.target.value);
                if (!editing) typing(Boolean(e.target.value));
              }}
              onBlur={() => typing(false)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (files.length) {
                  e.preventDefault();
                  onFiles(files, text.trim());
                }
              }}
              onKeyDown={(e) => {
                // Στο κινητό το Enter αλλάζει γραμμή (όπως στο WhatsApp)· στον
                // υπολογιστή στέλνει, και το Shift+Enter αλλάζει γραμμή.
                if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === "Escape" && editing) {
                  clearEditing();
                  setText("");
                }
                if (e.key === "ArrowUp" && !text && !editing && !isMobile) onEditLast();
              }}
              placeholder={busy || t("chat.placeholder")}
            />
          </>
        )}
        {showMic ? (
          <VoiceButton
            onRecordingChange={setRecordingActivity}
            onSend={onVoice}
            onError={notify}
          />
        ) : (
          <button
            className="send"
            disabled={!text.trim() || Boolean(busy)}
            onClick={() => void submit()}
            aria-label={editing ? t("msg.saveEdit") : t("chat.send")}
          >
            <SendHorizontal />
          </button>
        )}
      </div>
    </footer>
  );
}
