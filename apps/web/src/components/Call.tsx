// Οι οθόνες των κλήσεων: εισερχόμενη, η ίδια η κλήση (ατομική ή ομαδική), η
// μικρή μπάρα όταν πας αλλού μέσα στο app, και το «σε καλεί κι άλλος» όταν
// μιλάς ήδη. Η λογική είναι στο calls.ts· εδώ μόνο ό,τι φαίνεται.

import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronDown,
  LockKeyhole,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Phone,
  PhoneOff,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import * as calls from "../calls";
import type { CallView, RemotePeer } from "../calls";
import * as backend from "../data";
import type { Call, Chat, User } from "../data";
import { t } from "../i18n";
import { chatAvatar, chatTitle } from "./Conversation";

export function useCalls() {
  return useSyncExternalStore(calls.subscribe, calls.snapshot);
}

/** Μόνο ποια κλήση τρέχει (όχι κάθε αλλαγή της), για όσους δεν δείχνουν την ίδια την κλήση. */
export function useActiveCallId(): string | null {
  return useSyncExternalStore(calls.subscribe, calls.activeCallId);
}

/** «03:12» ή «1:03:12». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function Video_({
  stream,
  track,
  mirror,
  fit = "cover",
}: {
  stream?: MediaStream;
  track?: MediaStreamTrack | null;
  mirror?: boolean;
  fit?: "cover" | "contain";
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const key = track?.id || stream?.id || "";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : stream || null;
    void el.play().catch(() => undefined);
  }, [key, stream, track]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`call-video ${mirror ? "mirror" : ""} ${fit}`}
    />
  );
}

function personFor(chat: Chat | undefined, userId: string): User | undefined {
  return chat?.others.find((u) => u.id === userId);
}

function statusLine(view: CallView, now: number, chat?: Chat): string {
  if (view.phase === "ended") {
    switch (view.endReason) {
      case "declined":
        return t("call.declined");
      case "busy":
        return t("call.busy");
      case "noAnswer":
        return t("call.noAnswer");
      case "failed":
        return t("call.failed");
      case "elsewhere":
        return t("call.answeredElsewhere");
      default:
        return t("call.ended");
    }
  }
  if (view.phase === "starting") return t("call.starting");
  if (view.phase === "ringing")
    return chat?.type === "group" ? t("call.ringingGroup") : t("call.ringing");
  if (view.phase === "connecting") return t("call.connecting");
  if (view.reconnecting) return t("call.reconnecting");
  return view.connectedAt
    ? clock((now - view.connectedAt) / 1000)
    : t("call.connecting");
}

export function CallOverlay({ me, chats }: { me: User; chats: Chat[] }) {
  const { active, incoming } = useCalls();
  const ringing = incoming[0];
  const chatOf = (call: Call) =>
    chats.find((c) => c.id === call.conversationId);

  // Ο τίτλος της καρτέλας αναβοσβήνει όσο χτυπάει, για όποιον έχει άλλο παράθυρο μπροστά.
  useEffect(() => {
    if (!ringing) return;
    const chat = chatOf(ringing);
    const caller = personFor(chat, ringing.callerId)?.name || t("call.someone");
    const original = document.title;
    let on = false;
    const timer = window.setInterval(() => {
      on = !on;
      document.title = on
        ? `\u{1F4DE} ${t("call.isCalling", { name: caller })}`
        : original;
    }, 1000);
    return () => {
      window.clearInterval(timer);
      document.title = original;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringing?.id]);

  return (
    <>
      {active &&
        (active.minimized ? (
          <MiniCall view={active} chat={chatOf(active.call)} />
        ) : (
          <CallScreen view={active} me={me} chat={chatOf(active.call)} />
        ))}
      {ringing &&
        (active && active.phase !== "ended" ? (
          <CallWaiting call={ringing} chat={chatOf(ringing)} />
        ) : (
          <IncomingCall call={ringing} chat={chatOf(ringing)} />
        ))}
    </>
  );
}

function IncomingCall({ call, chat }: { call: Call; chat?: Chat }) {
  const caller = personFor(chat, call.callerId);
  const isGroup = chat?.type === "group";
  const title = chat ? chatTitle(chat) : caller?.name || t("call.someone");
  const avatar = chat ? chatAvatar(chat) : caller?.avatar || backend.groupAvatar(title);
  return (
    <div
      className="call-screen incoming"
      role="dialog"
      aria-label={t("call.incomingVoice")}
    >
      <div className="call-top">
        <span className="call-lock">
          <LockKeyhole size={13} /> {t("call.encrypted")}
        </span>
      </div>
      <div className="call-hero">
        <div className="call-avatar pulsing">
          <img src={avatar} alt="" />
        </div>
        <h2>{title}</h2>
        <p>
          {isGroup && caller ? `${caller.name} · ` : ""}
          {call.video ? t("call.incomingVideo") : t("call.incomingVoice")}
        </p>
      </div>
      <div className="call-answer">
        <div>
          <button
            className="call-btn hangup"
            onClick={() => void calls.decline(call.id)}
            aria-label={t("call.decline")}
          >
            <PhoneOff />
          </button>
          <small>{t("call.decline")}</small>
        </div>
        {call.video && (
          <div>
            <button
              className="call-btn light"
              onClick={() => void calls.answer(call.id, false)}
              aria-label={t("call.answerVoice")}
            >
              <Phone />
            </button>
            <small>{t("call.answerVoice")}</small>
          </div>
        )}
        <div>
          <button
            className="call-btn accept"
            onClick={() => void calls.answer(call.id, call.video)}
            aria-label={t("call.answer")}
          >
            {call.video ? <Video /> : <Phone />}
          </button>
          <small>{t("call.answer")}</small>
        </div>
      </div>
    </div>
  );
}

function CallWaiting({ call, chat }: { call: Call; chat?: Chat }) {
  const caller = personFor(chat, call.callerId);
  const title =
    chat?.type === "group"
      ? chatTitle(chat)
      : caller?.name || t("call.someone");
  return (
    <div className="call-waiting" role="alert">
      <span>
        <b>{title}</b>
        <small>
          {call.video ? t("call.incomingVideo") : t("call.incomingVoice")}
        </small>
      </span>
      <button className="decline" onClick={() => void calls.decline(call.id)}>
        {t("call.decline")}
      </button>
      <button
        className="accept"
        onClick={() => void calls.answer(call.id, call.video)}
      >
        {t("call.endAndAnswer")}
      </button>
    </div>
  );
}

function MiniCall({ view, chat }: { view: CallView; chat?: Chat }) {
  const now = useNow(view.phase !== "ended");
  return (
    <div className="call-mini" role="status">
      <button
        className="call-mini-open"
        onClick={() => calls.setMinimized(false)}
      >
        <Volume2 size={16} />
        <b>{chat ? chatTitle(chat) : t("call.title")}</b>
        <span>{statusLine(view, now, chat)}</span>
        <small>{t("call.tapToReturn")}</small>
      </button>
      {view.phase !== "ended" && (
        <button
          className="call-mini-end"
          onClick={calls.hangUp}
          aria-label={t("call.hangUp")}
        >
          <PhoneOff size={18} />
        </button>
      )}
    </div>
  );
}

function Tile({
  peer,
  chat,
  big,
}: {
  peer: RemotePeer;
  chat?: Chat;
  big?: boolean;
}) {
  const person = personFor(chat, peer.userId);
  const showVideo = peer.videoLive;
  return (
    <div
      className={`call-tile ${big ? "big" : ""} ${showVideo ? "has-video" : ""}`}
    >
      {showVideo ? (
        <Video_ stream={peer.stream} fit={peer.screen ? "contain" : "cover"} />
      ) : (
        <div className="call-tile-avatar">
          <img src={person?.avatar || backend.groupAvatar("?")} alt="" />
        </div>
      )}
      {!big && (
        <span className="call-tile-name">
          {!peer.mic && <MicOff size={13} />}
          {person?.name || t("chat.unknownUser")}
          {!peer.connected && ` · ${t("call.connecting")}`}
        </span>
      )}
    </div>
  );
}

function CallScreen({
  view,
  me,
  chat,
}: {
  view: CallView;
  me: User;
  chat?: Chat;
}) {
  const now = useNow(view.phase === "active");
  const isGroup = chat?.type === "group";
  const ended = view.phase === "ended";
  const peers = view.peers;
  const direct = !isGroup;
  const main = direct ? peers[0] : undefined;
  const remoteVideo = Boolean(main?.videoLive);
  const title = chat ? chatTitle(chat) : t("call.title");

  // Σε ομαδική: όσοι χτυπάνε ακόμα φαίνονται κι αυτοί, με «Χτυπάει…».
  const ringingPeople = isGroup
    ? view.call.participants
        .filter((p) => p.state === "ringing" && p.userId !== me.id)
        .map((p) => personFor(chat, p.userId))
        .filter((u): u is User => Boolean(u))
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") calls.setMinimized(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={`call-screen ${remoteVideo ? "with-video" : ""} ${isGroup ? "group" : ""}`}
      role="dialog"
      aria-label={title}
    >
      {direct && remoteVideo && main && (
        <div className="call-remote">
          <Video_
            stream={main.stream}
            fit={main.screen ? "contain" : "cover"}
          />
        </div>
      )}

      <div className="call-top">
        {!ended && (
          <button
            className="call-icon"
            onClick={() => calls.setMinimized(true)}
            aria-label={t("call.minimize")}
          >
            <ChevronDown />
          </button>
        )}
        <span className="call-lock">
          <LockKeyhole size={13} /> {t("call.encrypted")}
        </span>
        <span />
      </div>

      {(!direct || !remoteVideo) && (
        <div className="call-hero">
          {direct || peers.length === 0 ? (
            <>
              <div
                className={`call-avatar ${view.phase === "ringing" ? "pulsing" : ""}`}
              >
                <img src={chat ? chatAvatar(chat) : backend.groupAvatar(title)} alt="" />
              </div>
              <h2>{title}</h2>
              <p>{statusLine(view, now, chat)}</p>
              {direct && main && !main.mic && view.phase === "active" && (
                <p className="call-muted-note">
                  <MicOff size={14} />{" "}
                  {t("call.theyMuted", {
                    name: personFor(chat, main.userId)?.name || "",
                  })}
                </p>
              )}
            </>
          ) : (
            <>
              <h2 className="call-group-title">{title}</h2>
              <p>{statusLine(view, now, chat)}</p>
              <div
                className={`call-grid n${Math.min(peers.length + ringingPeople.length, 8)}`}
              >
                {peers.map((p) => (
                  <Tile key={p.deviceId} peer={p} chat={chat} />
                ))}
                {ringingPeople.map((u) => (
                  <div key={u.id} className="call-tile ringing">
                    <div className="call-tile-avatar">
                      <img src={u.avatar} alt="" />
                    </div>
                    <span className="call-tile-name">
                      {u.name} · {t("call.ringingShort")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {direct && remoteVideo && (
        <div className="call-overlay-title">
          <h2>{title}</h2>
          <p>{statusLine(view, now, chat)}</p>
        </div>
      )}

      {view.localVideo && !ended && (
        <div className="call-self">
          <Video_
            track={view.localVideo}
            mirror={view.facing === "user" && !view.screen}
            fit={view.screen ? "contain" : "cover"}
          />
        </div>
      )}

      {view.audioBlocked && !ended && (
        <button className="call-unmute" onClick={calls.resumeAudio}>
          <Volume2 size={18} /> {t("call.tapForSound")}
        </button>
      )}
      {view.notice && <p className="call-notice">{view.notice}</p>}

      {ended ? (
        <div className="call-controls">
          <button className="call-close" onClick={calls.dismiss}>
            {t("common.close")}
          </button>
        </div>
      ) : (
        <div className="call-controls">
          <button
            className={`call-btn ${view.camera ? "light" : "dim"}`}
            onClick={calls.toggleCamera}
            aria-label={view.camera ? t("call.cameraOff") : t("call.cameraOn")}
            title={view.camera ? t("call.cameraOff") : t("call.cameraOn")}
          >
            {view.camera ? <Video /> : <VideoOff />}
          </button>
          {view.canFlip && view.camera && (
            <button
              className="call-btn dim"
              onClick={calls.flipCamera}
              aria-label={t("call.flip")}
              title={t("call.flip")}
            >
              <SwitchCamera />
            </button>
          )}
          <button
            className={`call-btn ${view.mic ? "dim" : "light"}`}
            onClick={calls.toggleMic}
            aria-label={view.mic ? t("call.mute") : t("call.unmute")}
            title={view.mic ? t("call.mute") : t("call.unmute")}
            aria-pressed={!view.mic}
          >
            {view.mic ? <Mic /> : <MicOff />}
          </button>
          {view.canShare && (
            <button
              className={`call-btn ${view.screen ? "light" : "dim"}`}
              onClick={calls.toggleScreen}
              aria-label={view.screen ? t("call.stopShare") : t("call.share")}
              title={view.screen ? t("call.stopShare") : t("call.share")}
            >
              {view.screen ? <MonitorOff /> : <MonitorUp />}
            </button>
          )}
          <button
            className="call-btn hangup"
            onClick={calls.hangUp}
            aria-label={t("call.hangUp")}
            title={t("call.hangUp")}
          >
            <PhoneOff />
          </button>
        </div>
      )}
    </div>
  );
}
