// Φωνητικά μηνύματα: το μικρόφωνο στο πεδίο γραψίματος και ο player μέσα στη
// συνομιλία.
//
// Όπως στο WhatsApp: κρατάς πατημένο το μικρόφωνο και μιλάς, αφήνεις και
// φεύγει. Σέρνεις αριστερά για ακύρωση, πάνω για «κλείδωμα» (μιλάς χωρίς να
// κρατάς). Ένα γρήγορο πάτημα κλειδώνει κατευθείαν.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Lock, Mic, Pause, Play, SendHorizontal, Trash2 } from "lucide-react";
import * as backend from "../data";
import type { Attachment, MediaInfo } from "../data";
import { MAX_VOICE_SECONDS, canRecord, startRecording } from "../media";
import type { Recording } from "../media";
import { lang, t, translateError } from "../i18n";
import { clock } from "./Call";

// ---------------------------------------------------------------------------
// Ηχογράφηση
// ---------------------------------------------------------------------------

type Mode = "idle" | "starting" | "hold" | "locked";

export function VoiceButton({
  disabled,
  onRecordingChange,
  onSend,
  onError,
}: {
  disabled?: boolean;
  /** Για το «ηχογραφεί…» που βλέπει ο άλλος. */
  onRecordingChange: (recording: boolean) => void;
  onSend: (file: File, info: MediaInfo) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("idle"),
    [elapsed, setElapsed] = useState(0),
    [level, setLevel] = useState(0),
    [paused, setPaused] = useState(false),
    [drag, setDrag] = useState({ dx: 0, dy: 0 });
  const recording = useRef<Recording | null>(null),
    pointer = useRef<{ x: number; y: number; at: number; down: boolean } | null>(null),
    modeRef = useRef<Mode>("idle"),
    history = useRef<number[]>([]);
  modeRef.current = mode;

  const reset = useCallback(() => {
    recording.current = null;
    pointer.current = null;
    history.current = [];
    setMode("idle");
    setElapsed(0);
    setPaused(false);
    setDrag({ dx: 0, dy: 0 });
    onRecordingChange(false);
  }, [onRecordingChange]);

  const cancel = useCallback(() => {
    recording.current?.cancel();
    reset();
  }, [reset]);

  const send = useCallback(async () => {
    const current = recording.current;
    if (!current) return;
    recording.current = null;
    const result = await current.finish();
    reset();
    if (result) onSend(result.file, result.info);
    else onError(t("voice.tooShort"));
  }, [onError, onSend, reset]);

  // Χρόνος και στάθμη, όσο γράφει.
  useEffect(() => {
    if (mode !== "hold" && mode !== "locked") return;
    const timer = window.setInterval(() => {
      const r = recording.current;
      if (!r) return;
      const seconds = r.elapsed();
      setElapsed(seconds);
      const value = r.paused() ? 0 : r.level();
      setLevel(value);
      history.current = [...history.current.slice(-39), value];
      if (seconds >= MAX_VOICE_SECONDS) void send();
    }, 80);
    return () => window.clearInterval(timer);
  }, [mode, send]);

  // Αν φύγει από τη συνομιλία στη μέση, η ηχογράφηση ακυρώνεται.
  useEffect(() => () => recording.current?.cancel(), []);

  async function begin(locked: boolean) {
    if (modeRef.current !== "idle") return;
    setMode("starting");
    try {
      recording.current = await startRecording();
    } catch (caught) {
      const name = (caught as DOMException | null)?.name;
      setMode("idle");
      onError(
        name === "NotAllowedError" || name === "SecurityError"
          ? t("voice.errPermission")
          : translateError(caught instanceof Error ? caught.message : "") || t("voice.errStart"),
      );
      return;
    }
    if ("vibrate" in navigator) {
      try {
        navigator.vibrate(30);
      } catch {
        // όχι παντού
      }
    }
    onRecordingChange(true);
    // Το δάχτυλο σηκώθηκε πριν ξεκινήσει (π.χ. ρωτούσε για το μικρόφωνο):
    // συνεχίζει «κλειδωμένο» αντί να στείλει μισό δευτερόλεπτο σιωπής.
    setMode(locked || !pointer.current?.down ? "locked" : "hold");
  }

  if (!canRecord) return null;

  if (mode === "locked") {
    return (
      <div className="voice-bar locked">
        <button className="voice-trash" onClick={cancel} aria-label={t("voice.cancel")}>
          <Trash2 size={19} />
        </button>
        <span className={`voice-dot ${paused ? "paused" : ""}`} />
        <span className="voice-time">{clock(elapsed)}</span>
        <LiveWave values={history.current} />
        <button
          className="voice-pause"
          onClick={() => {
            const r = recording.current;
            if (!r) return;
            if (r.paused()) r.resume();
            else r.pause();
            setPaused(r.paused());
          }}
          aria-label={paused ? t("voice.resume") : t("voice.pause")}
        >
          {paused ? <Mic size={18} /> : <Pause size={18} />}
        </button>
        <button className="send" onClick={() => void send()} aria-label={t("chat.send")}>
          <SendHorizontal />
        </button>
      </div>
    );
  }

  const holding = mode === "hold" || mode === "starting";
  return (
    <>
      {holding && (
        <div className="voice-bar holding" aria-live="polite">
          <span className="voice-dot" />
          <span className="voice-time">{clock(elapsed)}</span>
          <span
            className="voice-slide"
            style={{ transform: `translateX(${Math.min(0, drag.dx) / 2}px)`, opacity: 1 + Math.min(0, drag.dx) / 120 }}
          >
            <ChevronLeft size={16} /> {t("voice.slideToCancel")}
          </span>
          <span className="voice-lock" style={{ transform: `translateY(${Math.min(0, drag.dy) / 2}px)` }}>
            <Lock size={14} />
          </span>
        </div>
      )}
      <button
        className={`send mic ${holding ? "recording" : ""}`}
        style={holding ? { transform: `translate(${Math.min(0, drag.dx)}px, ${Math.min(0, drag.dy)}px) scale(${1.25 + level * 0.25})` } : undefined}
        disabled={disabled}
        aria-label={t("voice.record")}
        title={t("voice.holdToRecord")}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 || disabled) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer.current = { x: e.clientX, y: e.clientY, at: Date.now(), down: true };
          void begin(false);
        }}
        onPointerMove={(e) => {
          const start = pointer.current;
          if (!start?.down || modeRef.current !== "hold") return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          setDrag({ dx, dy });
          if (dx < -110) cancel();
          else if (dy < -80) {
            pointer.current = { ...start, down: false };
            setDrag({ dx: 0, dy: 0 });
            setMode("locked");
          }
        }}
        onPointerUp={() => {
          const start = pointer.current;
          if (!start) return;
          pointer.current = { ...start, down: false };
          if (modeRef.current !== "hold") return;
          if (Date.now() - start.at < 400) {
            setDrag({ dx: 0, dy: 0 });
            setMode("locked");
          } else void send();
        }}
        onPointerCancel={() => {
          if (modeRef.current === "hold") cancel();
        }}
        onClick={(e) => {
          // Μόνο από πληκτρολόγιο (το ποντίκι/δάχτυλο το χειρίζονται τα pointer).
          if (e.detail === 0 && modeRef.current === "idle") void begin(true);
        }}
      >
        <Mic />
      </button>
    </>
  );
}

function LiveWave({ values }: { values: number[] }) {
  const padded = [...new Array(Math.max(0, 40 - values.length)).fill(0), ...values];
  return (
    <span className="voice-live">
      {padded.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(8, v * 100)}%` }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Αναπαραγωγή
// ---------------------------------------------------------------------------

/** Ένα φωνητικό τη φορά, όπως παντού. */
let playing: HTMLAudioElement | null = null;

const SPEEDS = [1, 1.5, 2];

export function VoicePlayer({
  attachment,
  own,
  avatar,
}: {
  attachment: Attachment;
  own: boolean;
  /** Η φωτογραφία του αποστολέα, δίπλα στο φωνητικό (όπως στο WhatsApp). */
  avatar?: string;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle"),
    [position, setPosition] = useState(0),
    [speed, setSpeed] = useState(1),
    [error, setError] = useState(false),
    [realDuration, setRealDuration] = useState(0);
  const duration = attachment.duration || realDuration || 0;
  const bars = attachment.waveform?.length ? attachment.waveform : new Array(40).fill(9);

  useEffect(
    () => () => {
      const el = audio.current;
      if (el) {
        el.pause();
        if (playing === el) playing = null;
      }
    },
    [],
  );

  async function element(): Promise<HTMLAudioElement> {
    if (audio.current) return audio.current;
    setState("loading");
    const url = await backend.mediaUrl(attachment);
    const el = new Audio();
    el.preload = "auto";
    el.src = url;
    el.ontimeupdate = () => setPosition(el.currentTime);
    el.onended = () => {
      setState("paused");
      setPosition(0);
      if (playing === el) playing = null;
    };
    el.onpause = () => setState((s) => (s === "playing" ? "paused" : s));
    el.onplay = () => setState("playing");
    el.onloadedmetadata = () => {
      // Τα αρχεία του MediaRecorder συχνά δεν γράφουν διάρκεια (Infinity).
      if (Number.isFinite(el.duration)) setRealDuration(el.duration);
    };
    audio.current = el;
    return el;
  }

  async function toggle() {
    try {
      const el = await element();
      if (!el.paused) {
        el.pause();
        return;
      }
      if (playing && playing !== el) playing.pause();
      playing = el;
      el.playbackRate = speed;
      await el.play();
    } catch {
      setError(true);
      setState("idle");
    }
  }

  async function seek(fraction: number) {
    if (!duration) return;
    try {
      const el = await element();
      el.currentTime = Math.max(0, Math.min(duration - 0.05, fraction * duration));
      setPosition(el.currentTime);
    } catch {
      setError(true);
    }
  }

  const progress = duration ? Math.min(1, position / duration) : 0;
  const active = state === "playing" || state === "paused";

  return (
    <div className={`voice-player ${own ? "own" : ""}`}>
      {avatar && !active && (
        <span className="voice-avatar">
          <img src={avatar} alt="" />
          <Mic size={12} />
        </span>
      )}
      <button
        className="voice-play"
        onClick={() => void toggle()}
        aria-label={state === "playing" ? t("voice.pause") : t("voice.play")}
        disabled={state === "loading"}
      >
        {state === "playing" ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <span className="voice-track">
        <span
          className="voice-wave"
          role="slider"
          aria-label={t("voice.position")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          tabIndex={0}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            void seek((e.clientX - box.left) / box.width);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") void seek(progress + 0.05);
            if (e.key === "ArrowLeft") void seek(progress - 0.05);
          }}
        >
          {bars.map((v, i) => (
            <i
              key={i}
              className={i / bars.length < progress ? "on" : ""}
              style={{ height: `${Math.max(10, (v / 31) * 100)}%` }}
            />
          ))}
        </span>
        <small>
          {error
            ? t("err.download")
            : state === "loading"
              ? t("common.loading")
              : clock(active ? position : duration)}
        </small>
      </span>
      {active && (
        <button
          className="voice-speed"
          onClick={() => {
            const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
            setSpeed(next);
            if (audio.current) audio.current.playbackRate = next;
          }}
          aria-label={t("voice.speed")}
        >
          {lang === "el" ? String(speed).replace(".", ",") : speed}×
        </button>
      )}
    </div>
  );
}
