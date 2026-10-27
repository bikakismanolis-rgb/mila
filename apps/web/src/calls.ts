// Κλήσεις φωνής και βίντεο, συσκευή με συσκευή (WebRTC).
//
// ΠΟΙΟΣ ΚΑΝΕΙ ΤΙ
//
//   * Η βάση (0013) ξέρει ότι «η Α καλεί τον Β»: από εκεί χτυπάει το τηλέφωνο
//     (Realtime όσο το app είναι ανοιχτό, push όταν είναι κλειστό), εκεί
//     γράφεται ποιος σήκωσε και πότε έκλεισε.
//   * Η «χειραψία» (περιγραφές SDP, υποψήφιες διαδρομές ICE) πάει από ένα
//     κανάλι Broadcast της Supabase, «call:<id>». Κάθε μήνυμα σφραγίζεται με
//     κλειδί που βγαίνει από τα κλειδιά των δύο συσκευών (e2ee.sealSignal):
//     ο server το μεταφέρει αλλά δεν το διαβάζει και δεν μπορεί να το αλλάξει.
//     Έτσι δεν μπορεί να βάλει τον εαυτό του ανάμεσα στον ήχο.
//   * Ο ήχος και η εικόνα πάνε κατευθείαν από συσκευή σε συσκευή,
//     κρυπτογραφημένα (DTLS-SRTP). Όταν το δίκτυο δεν το επιτρέπει, περνάνε
//     από αναμεταδότη (TURN), πάλι κρυπτογραφημένα.
//
// ΠΟΙΟΣ ΚΑΛΕΙ ΠΟΙΟΝ ΜΕΣΑ ΣΤΗΝ ΚΛΗΣΗ
//
//   Κάθε συσκευή που μπαίνει δηλώνεται στο Presence του καναλιού. Για κάθε
//   ζεύγος συσκευών, αυτή με το «μικρότερο» id στέλνει την πρώτη πρόταση
//   (offer)· η άλλη απαντάει. Σε ομαδική κλήση έτσι συνδέεται κάθε συσκευή με
//   κάθε άλλη (έως 8 άτομα). Ό,τι αλλάζει μετά (π.χ. επανασύνδεση όταν αλλάξει
//   δίκτυο) ακολουθεί το «perfect negotiation» του WebRTC.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import * as backend from "./data";
import type { Call, CallParticipant, Chat, MemberDevice, User } from "./data";
import * as e2ee from "./e2ee";
import type { DeviceKeys } from "./e2ee";
import { t, translateError } from "./i18n";
import type { TKey } from "./i18n";
import { isMobile } from "./platform";
import { blip, startTone } from "./tones";

export type Phase = "starting" | "ringing" | "connecting" | "active" | "ended";

export type EndReason =
  | "hangup"
  | "declined"
  | "busy"
  | "noAnswer"
  | "failed"
  | "elsewhere"
  | "ended"
  | "error";

export type RemotePeer = {
  deviceId: string;
  userId: string;
  stream: MediaStream;
  /** Αλλάζει όταν αλλάζει το βίντεο, για να ξέρει η οθόνη πότε να το ξαναδέσει. */
  videoKey: string;
  /** Έρχεται εικόνα που αξίζει να φανεί (όχι μαύρο από κλειστή κάμερα). */
  videoLive: boolean;
  mic: boolean;
  camera: boolean;
  screen: boolean;
  connected: boolean;
};

export type CallView = {
  call: Call;
  phase: Phase;
  endReason: EndReason | null;
  /** Μήνυμα που αξίζει να δει ο χρήστης (π.χ. «η κάμερα δεν άνοιξε»). */
  notice: string;
  localVideo: MediaStreamTrack | null;
  mic: boolean;
  camera: boolean;
  screen: boolean;
  facing: "user" | "environment";
  canFlip: boolean;
  canShare: boolean;
  peers: RemotePeer[];
  connectedAt: number | null;
  reconnecting: boolean;
  /** Ο browser δεν άφησε να ακουστεί ο άλλος χωρίς πάτημα. */
  audioBlocked: boolean;
  minimized: boolean;
};

type State = { active: CallView | null; incoming: Call[] };

// ---------------------------------------------------------------------------
// Κατάσταση για την οθόνη (useSyncExternalStore)
// ---------------------------------------------------------------------------

let state: State = { active: null, incoming: [] };
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const snapshot = (): State => state;

function emit(): void {
  state = {
    active: session ? session.view() : null,
    incoming: [...incoming.values()],
  };
  for (const listener of listeners) listener();
}

// ---------------------------------------------------------------------------
// Βοηθητικά
// ---------------------------------------------------------------------------

const RING_TIMEOUT = 45_000;
const HEARTBEAT = 10_000;
const INCOMING_MAX_AGE = 75_000;

const videoConstraints = (
  facing: "user" | "environment",
): MediaTrackConstraints => ({
  facingMode: { ideal: facing },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
});

const AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Γιατί δεν άνοιξε το μικρόφωνο (ή η κάμερα): δεν δόθηκε άδεια, δεν
 *  υπάρχει, το κρατάει άλλη εφαρμογή, ή κάτι άλλο. */
type MediaProblem = "permission" | "missing" | "busy" | "other";

const MEDIA_TEXT: Record<MediaProblem, TKey> = {
  permission: "call.errPermission",
  missing: "call.errNoMic",
  busy: "call.errDeviceBusy",
  other: "call.errMedia",
};

/** Το ίδιο, όταν συμβαίνει τη στιγμή που πατάς «Απάντηση». */
const ANSWER_TEXT: Record<MediaProblem, TKey> = {
  permission: "call.answerNoPermission",
  missing: "call.answerNoMic",
  busy: "call.answerMicBusy",
  other: "call.answerMediaFailed",
};

class MediaError extends Error {
  constructor(public problem: MediaProblem) {
    super(t(MEDIA_TEXT[problem]));
  }
}

function mediaError(caught: unknown): MediaError {
  const name = (caught as DOMException | null)?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new MediaError("permission");
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new MediaError("missing");
  if (name === "NotReadableError" || name === "AbortError")
    return new MediaError("busy");
  return new MediaError("other");
}

export const callsSupported =
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  typeof window.RTCPeerConnection === "function" &&
  e2ee.supported;

/** Μικρόφωνο, και κάμερα αν ζητήθηκε. Αν η κάμερα δεν ανοίξει αλλά το
 *  μικρόφωνο ναι, η κλήση συνεχίζει μόνο με ήχο. */
async function getMedia(
  video: boolean,
  facing: "user" | "environment",
): Promise<{ stream: MediaStream; cameraFailed: boolean }> {
  if (!callsSupported) throw new Error(t("call.errUnsupported"));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO,
      video: video ? videoConstraints(facing) : false,
    });
    return { stream, cameraFailed: false };
  } catch (caught) {
    if (!video) throw mediaError(caught);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO,
      });
      return { stream, cameraFailed: true };
    } catch (again) {
      throw mediaError(again);
    }
  }
}

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

// ---------------------------------------------------------------------------
// Μία σύνδεση με μία άλλη συσκευή
// ---------------------------------------------------------------------------

type Signal =
  | { t: "description"; d: RTCSessionDescriptionInit }
  | { t: "candidate"; c: RTCIceCandidateInit }
  | { t: "media"; mic: boolean; camera: boolean; screen: boolean }
  | { t: "hello"; restart?: boolean }
  | { t: "bye" };

type Envelope = {
  from: string;
  fromUser: string;
  fromSid: string;
  to: string;
  toSid: string;
  seq: number;
  box: string;
};

class Peer {
  pc: RTCPeerConnection;
  stream = new MediaStream();
  audio: HTMLAudioElement;
  /** Πρώτη πρόταση: τη στέλνει η συσκευή με το μικρότερο id. Σε σύγκρουση
   *  (και οι δύο έστειλαν μαζί) υποχωρεί η «ευγενική», η άλλη. */
  polite: boolean;
  makingOffer = false;
  ignoreOffer = false;
  /** Τα τοπικά κομμάτια έχουν μπει στη σύνδεση. */
  attached = false;
  pending: RTCIceCandidateInit[] = [];
  lastRemoteOffer = "";
  lastAnswer: RTCSessionDescriptionInit | null = null;
  offerAt = 0;
  offerTries = 0;
  outbox: Promise<void> = Promise.resolve();
  mic = true;
  camera = false;
  screen = false;
  /** Έχει έρθει τουλάχιστον ένα «media» από την άλλη συσκευή. */
  mediaKnown = false;
  everConnected = false;
  troubleSince = 0;
  restartedAt = 0;
  createdAt = Date.now();

  constructor(
    public device: MemberDevice,
    public remoteSid: string,
    ice: RTCIceServer[],
    myDeviceId: string,
  ) {
    this.polite = myDeviceId > device.deviceId;
    this.pc = new RTCPeerConnection({
      iceServers: ice,
      bundlePolicy: "max-bundle",
    });
    // Ο ήχος παίζει από στοιχείο έξω από το React: μένει ίδιο όσο κρατάει η
    // κλήση, ακόμα κι όταν η οθόνη της κλήσης μικραίνει ή ξαναζωγραφίζεται.
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    this.audio.setAttribute("playsinline", "");
    this.audio.hidden = true;
    this.audio.srcObject = this.stream;
    document.body.appendChild(this.audio);
  }

  get deviceId() {
    return this.device.deviceId;
  }

  videoTrack(): MediaStreamTrack | null {
    return this.stream.getVideoTracks()[0] || null;
  }

  connected(): boolean {
    return this.pc.connectionState === "connected";
  }

  close(): void {
    try {
      this.pc.close();
    } catch {
      // ήδη κλειστό
    }
    this.audio.srcObject = null;
    this.audio.remove();
  }
}

// ---------------------------------------------------------------------------
// Η κλήση που τρέχει σε αυτή τη συσκευή
// ---------------------------------------------------------------------------

class Session {
  phase: Phase = "starting";
  endReason: EndReason | null = null;
  notice = "";
  local: MediaStream | null = null;
  mic = true;
  camera: boolean;
  screen = false;
  facing: "user" | "environment" = "user";
  canFlip = false;
  canShare = Boolean(navigator.mediaDevices?.getDisplayMedia) && !isMobile;
  connectedAt: number | null = null;
  minimized = false;
  audioBlocked = false;
  /** Η οθόνη «τέλος κλήσης» έχει ήδη προγραμματίσει να κλείσει. */
  closing = false;
  connectingSince = Date.now();

  private device: DeviceKeys | null = null;
  private channel: RealtimeChannel | null = null;
  private sid = crypto.randomUUID();
  private seq = 0;
  private seen = new Map<string, number>();
  private inbox = new Map<string, Promise<void>>();
  private peers = new Map<string, Peer>();
  private present = new Map<
    string,
    { userId: string; sid: string; since: number; helloAt: number }
  >();
  private directory: MemberDevice[] = [];
  private directoryAt = 0;
  private ice: RTCIceServer[] = [];
  private timers: number[] = [];
  private stopTone: (() => void) | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private aloneSince = 0;

  constructor(
    public call: Call,
    public me: User,
    video: boolean,
  ) {
    this.camera = video;
  }

  get myDeviceId(): string {
    return this.device?.deviceId || "";
  }

  /** Μέθοδος και όχι σύγκριση: το TypeScript «θυμάται» την τιμή του phase και
   *  μετά από ένα await, ενώ στο μεταξύ μπορεί να έχει κλείσει η κλήση. */
  ended(): boolean {
    return this.phase === "ended";
  }

  view(): CallView {
    const peers = [...this.peers.values()].map((p) => {
      const track = p.videoTrack();
      const flowing = Boolean(
        track && track.readyState === "live" && !track.muted,
      );
      return {
        deviceId: p.deviceId,
        userId: p.device.userId,
        stream: p.stream,
        videoKey: track?.id || "",
        videoLive: flowing && (!p.mediaKnown || p.camera || p.screen),
        mic: p.mic,
        camera: p.camera,
        screen: p.screen,
        connected: p.connected(),
      };
    });
    return {
      call: this.call,
      phase: this.phase,
      endReason: this.endReason,
      notice: this.notice,
      localVideo: this.screenTrack || this.cameraTrack,
      mic: this.mic,
      camera: this.camera,
      screen: this.screen,
      facing: this.facing,
      canFlip: this.canFlip,
      canShare: this.canShare,
      peers,
      connectedAt: this.connectedAt,
      reconnecting:
        this.phase === "active" &&
        [...this.peers.values()].some((p) => p.everConnected && !p.connected()),
      audioBlocked: this.audioBlocked,
      minimized: this.minimized,
    };
  }

  // --- Ξεκίνημα -------------------------------------------------------------

  async acquireMedia(): Promise<void> {
    const { stream, cameraFailed } = await getMedia(this.camera, this.facing);
    this.local = stream;
    this.cameraTrack = stream.getVideoTracks()[0] || null;
    if (cameraFailed) {
      this.camera = false;
      this.notice = t("call.cameraFailed");
    }
    await this.checkFlip();
    this.watchTrack(this.local.getAudioTracks()[0]);
  }

  /** «Αλλαγή κάμερας» όταν υπάρχουν τουλάχιστον δύο κάμερες, μπροστινή και
   *  πίσω: κινητό, tablet (και iPad, που λέει ότι είναι Mac), ή όποια
   *  συσκευή δηλώνει από ποια πλευρά κοιτάει η κάμερά της. Πόσες κάμερες
   *  υπάρχουν ο browser το λέει μόνο αφού δοθεί άδεια για την κάμερα, γι'
   *  αυτό ξαναρωτάμε και όταν ανοίγει η κάμερα μέσα στην κλήση. */
  private async checkFlip() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === "videoinput").length;
      const sides = this.cameraTrack?.getCapabilities?.().facingMode?.length || 0;
      this.canFlip = cameras > 1 && (isMobile || sides > 0);
    } catch {
      this.canFlip = false;
    }
  }

  /** Αν το σύστημα κλείσει το μικρόφωνο (π.χ. ήρθε κλήση GSM), να το ξέρουμε. */
  private watchTrack(track?: MediaStreamTrack) {
    if (!track) return;
    track.onended = () => {
      if (this.phase !== "ended") {
        this.notice = t("call.micLost");
        emit();
      }
    };
  }

  async connect(ice: RTCIceServer[]): Promise<void> {
    this.ice = ice;
    this.device = await backend.ensureDevice();
    if (!accessToken)
      accessToken =
        (await supabase?.auth.getSession())?.data.session?.access_token || "";
    this.directory = await backend.conversationDevices(
      this.call.conversationId,
      true,
    );
    this.directoryAt = Date.now();

    const channel = supabase!.channel(`call:${this.call.id}`, {
      config: {
        broadcast: { self: false },
        presence: { key: this.myDeviceId },
      },
    });
    this.channel = channel;
    channel
      .on("broadcast", { event: "signal" }, ({ payload }) =>
        this.receive(payload as Envelope),
      )
      .on("presence", { event: "sync" }, () => void this.onPresence());

    await new Promise<void>((resolve) => {
      const giveUp = window.setTimeout(resolve, 8000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(giveUp);
          // Και μετά από κάθε επανασύνδεση του καναλιού: ξαναδηλωνόμαστε.
          void channel.track({
            userId: this.me.id,
            deviceId: this.myDeviceId,
            sid: this.sid,
          });
          resolve();
        }
      });
    });

    this.every(HEARTBEAT, () => void this.heartbeat());
    this.every(2000, () => this.watchdog());
    void this.keepAwake();
  }

  private every(ms: number, run: () => void) {
    this.timers.push(window.setInterval(run, ms));
  }

  private after(ms: number, run: () => void) {
    this.timers.push(window.setTimeout(run, ms));
  }

  startRinging(): void {
    this.phase = "ringing";
    this.stopTone?.();
    this.stopTone = startTone("ringback", RING_TIMEOUT + 5000);
    this.after(RING_TIMEOUT, () => {
      if (this.phase === "ringing") void this.end("noAnswer");
    });
  }

  private stopSound() {
    this.stopTone?.();
    this.stopTone = null;
  }

  private async keepAwake() {
    try {
      this.wakeLock =
        "wakeLock" in navigator
          ? await navigator.wakeLock.request("screen")
          : null;
    } catch {
      // Δεν το υποστηρίζουν όλοι οι browsers· η κλήση δουλεύει κανονικά.
    }
  }

  onVisible(): void {
    if (
      this.phase !== "ended" &&
      document.visibilityState === "visible" &&
      !this.wakeLock
    )
      void this.keepAwake();
  }

  // --- Αλλαγές από τη βάση --------------------------------------------------

  update(call: Call): void {
    if (!call || call.id !== this.call.id) return;
    this.call = call;
    if (this.phase === "ended") return;

    const mine = call.participants.find((p) => p.userId === this.me.id);
    if (
      mine?.state === "joined" &&
      mine.deviceId &&
      this.myDeviceId &&
      mine.deviceId !== this.myDeviceId
    ) {
      void this.end("elsewhere", { leave: false });
      return;
    }

    if (call.status === "ended") {
      const iAmCaller = call.callerId === this.me.id;
      const reason: EndReason =
        call.endReason === "declined"
          ? iAmCaller
            ? "declined"
            : "ended"
          : call.endReason === "busy"
            ? "busy"
            : call.endReason === "missed" && iAmCaller
              ? "noAnswer"
              : call.endReason === "failed"
                ? "failed"
                : "ended";
      void this.end(reason, { leave: false });
      return;
    }

    const othersIn = call.participants.some(
      (p) => p.userId !== this.me.id && p.state === "joined",
    );
    if (this.phase === "ringing" && othersIn) {
      this.phase = "connecting";
      this.connectingSince = Date.now();
      this.stopSound();
    }

    // Όσοι βγήκαν από την κλήση: κλείνει και η σύνδεση μαζί τους.
    for (const p of call.participants) {
      if (p.state === "left" || p.state === "declined")
        for (const peer of this.peers.values())
          if (peer.device.userId === p.userId) this.dropPeer(peer.deviceId);
    }
    emit();
  }

  private async heartbeat() {
    if (this.phase === "ended") return;
    try {
      this.update(await backend.callHeartbeat(this.call.id));
    } catch {
      // Χωρίς δίκτυο για λίγο· η επόμενη προσπάθεια θα το δείξει.
    }
  }

  // --- Ποιοι είναι στο κανάλι ----------------------------------------------

  private async lookup(
    deviceId: string,
    userId: string,
  ): Promise<MemberDevice | null> {
    let found = this.directory.find((d) => d.deviceId === deviceId);
    if (!found && Date.now() - this.directoryAt > 3000) {
      this.directoryAt = Date.now();
      try {
        this.directory = await backend.conversationDevices(
          this.call.conversationId,
          true,
        );
      } catch {
        return null;
      }
      found = this.directory.find((d) => d.deviceId === deviceId);
    }
    return found && found.userId === userId && userId !== this.me.id
      ? found
      : null;
  }

  private async onPresence() {
    if (!this.channel || this.phase === "ended") return;
    const presence = this.channel.presenceState<{
      userId: string;
      deviceId: string;
      sid: string;
    }>();
    const now = Date.now();
    const seenNow = new Set<string>();
    for (const metas of Object.values(presence)) {
      const meta = metas[metas.length - 1];
      if (!meta?.deviceId || meta.deviceId === this.myDeviceId) continue;
      seenNow.add(meta.deviceId);
      const before = this.present.get(meta.deviceId);
      this.present.set(meta.deviceId, {
        userId: meta.userId,
        sid: meta.sid,
        since: before && before.sid === meta.sid ? before.since : now,
        helloAt: before?.helloAt || 0,
      });
    }
    for (const id of [...this.present.keys()])
      if (!seenNow.has(id)) this.present.delete(id);

    for (const [deviceId, meta] of this.present) {
      const device = await this.lookup(deviceId, meta.userId);
      if (!device || this.ended()) continue;
      let peer = this.peers.get(deviceId);
      // Η άλλη συσκευή ξεκίνησε από την αρχή (π.χ. ανανέωσε τη σελίδα).
      if (peer && peer.remoteSid && peer.remoteSid !== meta.sid) {
        this.dropPeer(deviceId);
        peer = undefined;
      }
      if (!peer && this.myDeviceId < deviceId)
        this.createPeer(device, meta.sid, true);
    }
  }

  // --- Συνδέσεις ------------------------------------------------------------

  private createPeer(
    device: MemberDevice,
    remoteSid: string,
    initiator: boolean,
  ): Peer {
    const peer = new Peer(device, remoteSid, this.ice, this.myDeviceId);
    const pc = peer.pc;
    this.peers.set(device.deviceId, peer);

    pc.ontrack = ({ track }) => {
      if (!peer.stream.getTracks().includes(track)) peer.stream.addTrack(track);
      track.onunmute = () => emit();
      track.onmute = () => emit();
      this.playAudio(peer);
      emit();
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send(peer, { t: "candidate", c: candidate.toJSON() });
    };
    pc.onnegotiationneeded = () => void this.negotiate(peer);
    pc.onconnectionstatechange = () => this.onPeerState(peer);
    pc.oniceconnectionstatechange = () => this.onPeerState(peer);

    if (initiator && this.local) {
      const audio = this.local.getAudioTracks()[0];
      const video = this.screenTrack || this.cameraTrack;
      pc.addTransceiver(audio || "audio", {
        direction: "sendrecv",
        streams: [this.local],
      });
      pc.addTransceiver(video || "video", {
        direction: "sendrecv",
        streams: [this.local],
      });
      peer.attached = true;
    }
    emit();
    return peer;
  }

  /** Ο απαντών βάζει τα δικά του κομμάτια στις θέσεις που πρότεινε ο άλλος. */
  private async attachLocal(peer: Peer) {
    for (const transceiver of peer.pc.getTransceivers()) {
      const kind = transceiver.receiver.track?.kind;
      const track =
        kind === "audio"
          ? this.local?.getAudioTracks()[0] || null
          : kind === "video"
            ? this.screenTrack || this.cameraTrack
            : null;
      transceiver.direction = "sendrecv";
      await transceiver.sender.replaceTrack(track);
      if (this.local) transceiver.sender.setStreams?.(this.local);
    }
    peer.attached = true;
  }

  private async negotiate(peer: Peer) {
    if (this.phase === "ended") return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      const d = peer.pc.localDescription;
      if (d) {
        peer.offerAt = Date.now();
        peer.offerTries = 1;
        this.send(peer, { t: "description", d: d.toJSON() });
      }
    } catch (error) {
      console.warn("negotiation failed:", error);
    } finally {
      peer.makingOffer = false;
    }
  }

  private async onDescription(peer: Peer, d: RTCSessionDescriptionInit) {
    const pc = peer.pc;
    const collision =
      d.type === "offer" &&
      (peer.makingOffer || pc.signalingState !== "stable");
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return;
    // Η ίδια πρόταση ξανά (χάθηκε η απάντησή μας): ξαναστέλνουμε την απάντηση.
    if (
      d.type === "offer" &&
      d.sdp === peer.lastRemoteOffer &&
      peer.lastAnswer &&
      pc.signalingState === "stable"
    ) {
      this.send(peer, { t: "description", d: peer.lastAnswer });
      return;
    }
    if (d.type === "answer" && pc.signalingState === "stable") return;

    await pc.setRemoteDescription(d);
    if (d.type === "offer") {
      if (!peer.attached) await this.attachLocal(peer);
      await pc.setLocalDescription();
      peer.lastRemoteOffer = d.sdp || "";
      peer.lastAnswer = pc.localDescription!.toJSON();
      this.send(peer, { t: "description", d: peer.lastAnswer });
    } else {
      peer.offerTries = 0;
    }
    for (const c of peer.pending.splice(0))
      await pc.addIceCandidate(c).catch(() => undefined);
  }

  private async onCandidate(peer: Peer, c: RTCIceCandidateInit) {
    if (!peer.pc.remoteDescription) {
      peer.pending.push(c);
      return;
    }
    try {
      await peer.pc.addIceCandidate(c);
    } catch (error) {
      if (!peer.ignoreOffer) console.warn("bad candidate:", error);
    }
  }

  private onPeerState(peer: Peer) {
    if (this.peers.get(peer.deviceId) !== peer) return;
    const pcState = peer.pc.connectionState;
    if (pcState === "connected") {
      peer.troubleSince = 0;
      if (!peer.everConnected) {
        peer.everConnected = true;
        if (this.connectedAt) blip("join");
        this.sendMedia(peer);
      }
      if (!this.connectedAt) this.connectedAt = Date.now();
      if (this.phase !== "ended") this.phase = "active";
      this.stopSound();
      this.tuneBitrates();
    } else if (pcState === "disconnected" || pcState === "failed") {
      if (!peer.troubleSince) peer.troubleSince = Date.now();
    }
    emit();
  }

  private playAudio(peer: Peer) {
    void peer.audio.play().then(
      () => {
        if (this.audioBlocked) {
          this.audioBlocked = false;
          emit();
        }
      },
      () => {
        this.audioBlocked = true;
        emit();
      },
    );
  }

  resumeAudio(): void {
    for (const peer of this.peers.values()) this.playAudio(peer);
  }

  /** Σε ομαδική κλήση κάθε συσκευή στέλνει βίντεο σε όλους: όσο περισσότεροι,
   *  τόσο χαμηλότερη ποιότητα ανά σύνδεση, για να αντέξει το δίκτυο. */
  private tuneBitrates() {
    const count = Math.max(1, this.peers.size);
    const max =
      count === 1
        ? 1_500_000
        : Math.max(250_000, Math.round(1_200_000 / count));
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track?.kind !== "video") continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = max;
        void sender.setParameters(params).catch(() => undefined);
      }
    }
  }

  private dropPeer(deviceId: string) {
    const peer = this.peers.get(deviceId);
    if (!peer) return;
    this.peers.delete(deviceId);
    peer.close();
    if (peer.everConnected && this.phase !== "ended") blip("leave");
    emit();
  }

  /** Κάθε 2 δευτερόλεπτα: ό,τι χάθηκε στον δρόμο ξαναστέλνεται, ό,τι κόλλησε
   *  ξαναπροσπαθεί, ό,τι πέθανε κλείνει. */
  private watchdog() {
    if (this.phase === "ended") return;
    const now = Date.now();

    for (const peer of [...this.peers.values()]) {
      const pc = peer.pc;
      if (
        pc.signalingState === "have-local-offer" &&
        peer.offerTries &&
        peer.offerTries < 5 &&
        now - peer.offerAt > 4000
      ) {
        peer.offerAt = now;
        peer.offerTries++;
        if (pc.localDescription)
          this.send(peer, {
            t: "description",
            d: pc.localDescription.toJSON(),
          });
      }
      if (
        peer.troubleSince &&
        now - peer.troubleSince > 3500 &&
        now - peer.restartedAt > 8000
      ) {
        peer.restartedAt = now;
        if (!peer.polite) pc.restartIce();
        else this.send(peer, { t: "hello", restart: true });
      }
      const gone = !this.present.has(peer.deviceId);
      if (
        (peer.troubleSince && now - peer.troubleSince > 30_000) ||
        (gone && !peer.connected() && now - peer.createdAt > 20_000)
      )
        this.dropPeer(peer.deviceId);
    }

    // Είμαι ο «ευγενικός» και η άλλη συσκευή δεν μου έστειλε ακόμα πρόταση:
    // της θυμίζω ότι είμαι εδώ (μπορεί να χάθηκε στον δρόμο).
    for (const [deviceId, meta] of this.present) {
      if (this.peers.has(deviceId) || this.myDeviceId < deviceId) continue;
      if (now - meta.since > 4000 && now - meta.helloAt > 4000) {
        meta.helloAt = now;
        void this.lookup(deviceId, meta.userId).then((device) => {
          if (device) this.sendTo(device, meta.sid, { t: "hello" });
        });
      }
    }

    const isGroup = chatOfCall(this.call)?.type === "group";
    const anyoneConnected = [...this.peers.values()].some((p) => p.connected());
    // Σήκωσε, αλλά η σύνδεση δεν στήθηκε ποτέ (π.χ. δίκτυο που δεν αφήνει).
    if (
      !this.connectedAt &&
      this.phase === "connecting" &&
      now - this.connectingSince > 40_000
    ) {
      this.notice = t("call.errConnect");
      void this.end("failed");
      return;
    }
    if (this.connectedAt && !anyoneConnected) {
      if (!this.aloneSince) this.aloneSince = now;
      // Ατομική: ο άλλος χάθηκε και δεν γύρισε. Ομαδική: έμεινα μόνος.
      if (now - this.aloneSince > (isGroup ? 60_000 : 25_000))
        void this.end(isGroup ? "ended" : "failed");
    } else {
      this.aloneSince = 0;
    }
    emit();
  }

  // --- Μηνύματα χειραψίας ----------------------------------------------------

  private aad(
    from: string,
    fromSid: string,
    to: string,
    toSid: string,
    seq: number,
  ) {
    return `mila/v1/call|${this.call.id}|${from}|${fromSid}|${to}|${toSid}|${seq}`;
  }

  private send(peer: Peer, data: Signal) {
    // Με τη σειρά: μια περιγραφή δεν πρέπει να φτάσει μετά τις υποψήφιες
    // διαδρομές της, επειδή η κρυπτογράφηση της πρώτης άργησε λίγο.
    peer.outbox = peer.outbox.then(() =>
      this.sendTo(peer.device, peer.remoteSid, data),
    );
  }

  private async sendTo(device: MemberDevice, remoteSid: string, data: Signal) {
    // Το κανάλι κρατιέται από ΤΩΡΑ: η κρυπτογράφηση παίρνει λίγο, και στο
    // μεταξύ η κλήση μπορεί να κλείνει.
    const channel = this.channel;
    if (!this.device || !channel) return;
    const seq = ++this.seq;
    try {
      const box = await e2ee.sealSignal(
        this.device,
        device.publicKey,
        this.aad(this.myDeviceId, this.sid, device.deviceId, remoteSid, seq),
        data,
      );
      await channel.send({
        type: "broadcast",
        event: "signal",
        payload: {
          from: this.myDeviceId,
          fromUser: this.me.id,
          fromSid: this.sid,
          to: device.deviceId,
          toSid: remoteSid,
          seq,
          box,
        } satisfies Envelope,
      });
    } catch (error) {
      console.warn("signal not sent:", error);
    }
  }

  private receive(envelope: Envelope) {
    if (
      !envelope ||
      this.phase === "ended" ||
      envelope.to !== this.myDeviceId ||
      envelope.toSid !== this.sid ||
      typeof envelope.box !== "string" ||
      !Number.isSafeInteger(envelope.seq)
    )
      return;
    const queue = this.inbox.get(envelope.from) || Promise.resolve();
    const next = queue
      .then(() => this.handle(envelope))
      .catch((error) => console.warn("signal failed:", error));
    this.inbox.set(envelope.from, next);
  }

  private async handle(envelope: Envelope) {
    const device = await this.lookup(envelope.from, envelope.fromUser);
    if (!device || !this.device) return;
    const data = await e2ee.openSignal<Signal>(
      this.device,
      device.publicKey,
      this.aad(
        envelope.from,
        envelope.fromSid,
        envelope.to,
        envelope.toSid,
        envelope.seq,
      ),
      envelope.box,
    );
    if (!data || this.ended()) return;
    // Ό,τι έχει ήδη έρθει δεν ξαναπαίζεται.
    const key = `${envelope.from}|${envelope.fromSid}`;
    if ((this.seen.get(key) ?? 0) >= envelope.seq) return;
    this.seen.set(key, envelope.seq);

    let peer = this.peers.get(envelope.from);
    if (peer && peer.remoteSid !== envelope.fromSid) {
      this.dropPeer(envelope.from);
      peer = undefined;
    }

    if (data.t === "bye") {
      this.dropPeer(envelope.from);
      return;
    }
    if (data.t === "hello") {
      if (this.myDeviceId > envelope.from) return;
      if (!peer) this.createPeer(device, envelope.fromSid, true);
      else if (
        peer.pc.signalingState === "have-local-offer" &&
        peer.pc.localDescription
      )
        this.send(peer, {
          t: "description",
          d: peer.pc.localDescription.toJSON(),
        });
      else if (data.restart && !peer.connected()) {
        peer.restartedAt = Date.now();
        peer.pc.restartIce();
      }
      return;
    }
    if (!peer) {
      if (data.t !== "description" || data.d.type !== "offer") return;
      peer = this.createPeer(device, envelope.fromSid, false);
    }
    if (data.t === "description") await this.onDescription(peer, data.d);
    else if (data.t === "candidate") await this.onCandidate(peer, data.c);
    else if (data.t === "media") {
      peer.mic = Boolean(data.mic);
      peer.camera = Boolean(data.camera);
      peer.screen = Boolean(data.screen);
      peer.mediaKnown = true;
      emit();
    }
  }

  private sendMedia(peer?: Peer) {
    const data: Signal = {
      t: "media",
      mic: this.mic,
      camera: this.camera || this.screen,
      screen: this.screen,
    };
    for (const p of peer ? [peer] : this.peers.values()) this.send(p, data);
  }

  // --- Μικρόφωνο, κάμερα, οθόνη ----------------------------------------------

  toggleMic(): void {
    const track = this.local?.getAudioTracks()[0];
    if (!track) return;
    this.mic = !this.mic;
    track.enabled = this.mic;
    this.sendMedia();
    emit();
  }

  private async replaceVideo(track: MediaStreamTrack | null) {
    for (const peer of this.peers.values()) {
      const transceiver = peer.pc
        .getTransceivers()
        .find((x) => x.receiver.track?.kind === "video");
      if (transceiver)
        await transceiver.sender.replaceTrack(track).catch(() => undefined);
    }
    this.tuneBitrates();
  }

  async toggleCamera(): Promise<void> {
    if (!this.local) return;
    if (this.camera) {
      const old = this.cameraTrack;
      this.cameraTrack = null;
      this.camera = false;
      if (old) {
        this.local.removeTrack(old);
        old.stop();
      }
      if (!this.screen) await this.replaceVideo(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(this.facing),
        });
        const track = stream.getVideoTracks()[0];
        this.local.addTrack(track);
        this.cameraTrack = track;
        this.camera = true;
        if (!this.screen) await this.replaceVideo(track);
        if (!this.canFlip) await this.checkFlip();
      } catch (caught) {
        this.notice = mediaError(caught).message;
      }
    }
    this.sendMedia();
    emit();
  }

  async flipCamera(): Promise<void> {
    if (!this.local || !this.camera) return;
    const next = this.facing === "user" ? "environment" : "user";
    const old = this.cameraTrack;
    // Πολλά κινητά δεν ανοίγουν δύο κάμερες μαζί: πρώτα κλείνει η παλιά.
    old?.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(next),
      });
      const track = stream.getVideoTracks()[0];
      if (old) this.local.removeTrack(old);
      this.local.addTrack(track);
      this.cameraTrack = track;
      this.facing = next;
      if (!this.screen) await this.replaceVideo(track);
    } catch (caught) {
      this.notice = mediaError(caught).message;
      this.camera = false;
      this.cameraTrack = null;
      if (old) this.local.removeTrack(old);
      await this.replaceVideo(null);
      this.sendMedia();
    }
    emit();
  }

  async toggleScreen(): Promise<void> {
    if (this.screen) {
      this.screenTrack?.stop();
      this.screenTrack = null;
      this.screen = false;
      await this.replaceVideo(this.cameraTrack);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        const track = stream.getVideoTracks()[0];
        track.onended = () => {
          if (this.screenTrack === track) void this.toggleScreen();
        };
        this.screenTrack = track;
        this.screen = true;
        await this.replaceVideo(track);
      } catch {
        // Ο χρήστης πάτησε «Άκυρο» στο παράθυρο του browser.
        return;
      }
    }
    this.sendMedia();
    emit();
  }

  // --- Τέλος ----------------------------------------------------------------

  async end(
    reason: EndReason,
    options: { leave?: boolean } = {},
  ): Promise<void> {
    if (this.phase === "ended") return;
    const wasRinging = this.phase === "ringing" || this.phase === "starting";
    this.phase = "ended";
    this.endReason = reason;
    this.stopSound();
    for (const timer of this.timers) {
      window.clearInterval(timer);
      window.clearTimeout(timer);
    }
    this.timers = [];

    // Κάμερα και μικρόφωνο σβήνουν αμέσως, και η βάση το μαθαίνει αμέσως.
    for (const track of this.local?.getTracks() || []) track.stop();
    this.screenTrack?.stop();
    this.cameraTrack = null;
    this.screenTrack = null;
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    if (options.leave !== false && this.call.id) {
      // Σήκωσαν, αλλά η σύνδεση δεν στήθηκε ποτέ: να μη μείνει στο ιστορικό
      // ως κλήση που κράτησε 40''. (Μια κλήση που κόπηκε αργότερα κράτησε
      // κανονικά, και κλείνει κανονικά.)
      const id = this.call.id;
      const leave =
        reason === "failed" && !this.connectedAt
          ? backend.failCall(id).catch(() => backend.leaveCall(id))
          : backend.leaveCall(id);
      void leave.catch(() => undefined);
    }
    if (reason === "busy") {
      const stop = startTone("busy", 3000);
      window.setTimeout(stop, 3000);
    } else if (!wasRinging || reason !== "hangup") {
      blip("end");
    }
    const peers = [...this.peers.values()];
    this.peers.clear();
    emit();

    // Αποχαιρετισμός: ο άλλος κλείνει αμέσως, δεν περιμένει να χαθεί η σύνδεση.
    // Το πολύ μισό δευτερόλεπτο αναμονή· μετά κλείνουν όλα έτσι κι αλλιώς.
    await Promise.race([
      Promise.all(
        peers.map((peer) => this.sendTo(peer.device, peer.remoteSid, { t: "bye" })),
      ),
      new Promise((resolve) => window.setTimeout(resolve, 500)),
    ]);
    for (const peer of peers) peer.close();
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      void channel.untrack().catch(() => undefined);
      void supabase?.removeChannel(channel);
    }
  }

  /** Κλείνει το παράθυρο ή η καρτέλα: η βάση πρέπει να το μάθει χωρίς να
   *  περιμένουμε απάντηση (keepalive). Αλλιώς ο άλλος θα έβλεπε την κλήση να
   *  «κρέμεται» μέχρι να λήξει μόνη της. */
  leaveOnUnload(): void {
    if (this.phase === "ended" || !this.call.id || !accessToken || !supabaseUrl)
      return;
    try {
      void fetch(`${supabaseUrl}/rest/v1/rpc/leave_call`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: supabaseAnonKey || "",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_call: this.call.id }),
      });
    } catch {
      // Το χειρίζεται η βάση μόνη της σε λίγα δευτερόλεπτα.
    }
  }
}

// ---------------------------------------------------------------------------
// Ο διαχειριστής: εισερχόμενες, εξερχόμενες, μία κλήση τη φορά
// ---------------------------------------------------------------------------

let me: User | null = null;
let session: Session | null = null;
const incoming = new Map<string, Call>();
let callsChannel: RealtimeChannel | null = null;
let stopRing: (() => void) | null = null;
let sweepTimer: number | undefined;
const fetching = new Map<string, boolean>();
/** Κλήσεις που απάντησα ή απέρριψα: να μην ξαναχτυπήσουν αν φτάσει αργά κάποιο γεγονός. */
const handled = new Set<string>();
/** Το access token, πάντα το τελευταίο: η Supabase το ανανεώνει κάθε ~1 ώρα.
 *  Όταν κλείνει η σελίδα δεν προλαβαίνουμε να το ζητήσουμε (δες leaveOnUnload),
 *  και ένα κρατημένο από την αρχή της κλήσης θα είχε λήξει σε μια μεγάλη κλήση. */
let accessToken = "";
/** Ο έλεγχος «τι χτυπάει τώρα» που τρέχει ήδη, αν τρέχει. */
let checking: Promise<void> | null = null;

/** Η κλήση που τρέχει τώρα σε αυτή τη συσκευή ("" όσο ξεκινάει), ή null. Τιμή
 *  και όχι αντικείμενο: όποιος τη διαβάζει ξαναζωγραφίζεται μόνο όταν αλλάξει. */
export const activeCallId = (): string | null =>
  session && session.phase !== "ended" ? session.call.id : null;

function chatFor(conversationId: string, chats: Chat[]): Chat | undefined {
  return chats.find((c) => c.id === conversationId);
}

let knownChats: Chat[] = [];
/** Η λίστα συνομιλιών, για να ξέρουμε ονόματα όταν κάποιος καλεί. */
export function setChats(chats: Chat[]): void {
  knownChats = chats;
}

export function chatOfCall(call: Call): Chat | undefined {
  return chatFor(call.conversationId, knownChats);
}

export function startCalls(user: User): () => void {
  me = user;
  // Ό,τι χτυπάει ΤΩΡΑ (π.χ. άνοιξα το app από την ειδοποίηση, ή το ανανέωσα),
  // και ξανά κάθε φορά που το κανάλι (ξανα)συνδέεται: μια κλήση που ξεκίνησε
  // ενώ συνδεόταν δεν θα ερχόταν ποτέ ως γεγονός.
  callsChannel = backend.subscribeToCalls((id) => void refresh(id), checkRinging);
  checkRinging();
  sweepTimer = window.setInterval(() => {
    for (const call of incoming.values())
      if (Date.now() - Date.parse(call.createdAt) > INCOMING_MAX_AGE)
        dropIncoming(call.id);
  }, 3000);
  const auth = supabase?.auth.onAuthStateChange((_event, current) => {
    accessToken = current?.access_token || "";
  });
  const onUnload = () => session?.leaveOnUnload();
  // Πίσω μπροστά, ή πίσω στο δίκτυο: όσο έλειπε, το Realtime μπορεί να είχε
  // κοπεί, και ό,τι έγινε τότε (π.χ. μια κλήση που χτυπάει) δεν ξανάρχεται.
  const onVisible = () => {
    session?.onVisible();
    if (document.visibilityState === "visible") checkRinging();
  };
  const onBack = () => checkRinging();
  // Έφτασε push για κλήση: ο service worker το λέει και στα ανοιχτά παράθυρα,
  // για την περίπτωση που το Realtime δεν το έφερε.
  const onWorker = (event: MessageEvent) => {
    if (event.data?.type === "call-push" && typeof event.data.callId === "string")
      void refresh(event.data.callId);
  };
  window.addEventListener("pagehide", onUnload);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onBack);
  window.addEventListener("online", onBack);
  navigator.serviceWorker?.addEventListener("message", onWorker);
  return () => {
    window.removeEventListener("pagehide", onUnload);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onBack);
    window.removeEventListener("online", onBack);
    navigator.serviceWorker?.removeEventListener("message", onWorker);
    auth?.data.subscription.unsubscribe();
    accessToken = "";
    window.clearInterval(sweepTimer);
    backend.unsubscribe(callsChannel);
    callsChannel = null;
    void session?.end("hangup");
    session = null;
    for (const id of [...incoming.keys()]) dropIncoming(id);
    me = null;
    emit();
  };
}

/** Όλες οι κλήσεις των τελευταίων 75'' από τη βάση: όποια χτυπάει για μένα
 *  φαίνεται (μία φορά: το `incoming` και το `handled` κρατάνε τις υπόλοιπες
 *  ήσυχες), όποια σταμάτησε φεύγει. Αν τρέχει ήδη ένας έλεγχος (το focus και
 *  το visibilitychange έρχονται μαζί), δεύτερος δεν χρειάζεται. */
function checkRinging(): void {
  if (!me || checking) return;
  checking = backend
    .listCalls(undefined, new Date(Date.now() - INCOMING_MAX_AGE).toISOString())
    .then((list) => list.forEach(seen))
    .catch(() => undefined)
    .finally(() => {
      checking = null;
    });
}

/** Πολλά γεγονότα για την ίδια κλήση (κλήση + κάθε συμμετέχων) γίνονται ένα
 *  φρέσκο διάβασμα, και ένα ακόμα στο τέλος αν ήρθε κάτι στο μεταξύ. */
async function refresh(callId: string) {
  if (fetching.has(callId)) {
    fetching.set(callId, true);
    return;
  }
  fetching.set(callId, false);
  try {
    do {
      fetching.set(callId, false);
      const call = await backend.getCall(callId);
      if (call) seen(call);
    } while (fetching.get(callId));
  } finally {
    fetching.delete(callId);
  }
}

function seen(call: Call) {
  if (!me) return;
  if (session && session.call.id === call.id) {
    session.update(call);
    return;
  }
  const mine = call.participants.find((p) => p.userId === me!.id);
  const ringingForMe =
    call.status !== "ended" &&
    call.callerId !== me.id &&
    mine?.state === "ringing" &&
    !handled.has(call.id) &&
    Date.now() - Date.parse(call.createdAt) < INCOMING_MAX_AGE;
  if (ringingForMe) addIncoming(call);
  else dropIncoming(call.id);
}

function addIncoming(call: Call) {
  const fresh = !incoming.has(call.id);
  incoming.set(call.id, call);
  if (fresh) {
    if (!session) {
      stopRing?.();
      stopRing = startTone("ring", INCOMING_MAX_AGE);
    } else {
      // Είμαι ήδη σε κλήση: ένα διακριτικό «μπιπ», όχι κουδούνισμα.
      blip("join");
    }
    void systemNotification(call);
  }
  emit();
}

function dropIncoming(callId: string) {
  if (!incoming.delete(callId)) return;
  if (!incoming.size) {
    stopRing?.();
    stopRing = null;
  }
  void closeNotification(callId);
  emit();
}

/** Το app είναι ανοιχτό αλλά όχι μπροστά: ειδοποίηση του συστήματος, με το
 *  ίδιο tag που θα έβαζε ο service worker (δεν βγαίνει δεύτερη). */
async function systemNotification(call: Call) {
  if (document.visibilityState === "visible" || !("Notification" in window))
    return;
  if (Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const chat = chatOfCall(call);
    const caller =
      chat?.others.find((u) => u.id === call.callerId)?.name || "Mila";
    const title = chat?.type === "group" ? chat.name || caller : caller;
    const text = call.video ? t("call.incomingVideo") : t("call.incomingVoice");
    await reg?.showNotification(title, {
      body: chat?.type === "group" ? `${caller.split(" ")[0]}: ${text}` : text,
      icon: "/icons/icon-192.png",
      tag: `call:${call.id}`,
      requireInteraction: true,
      data: {
        kind: "call",
        callId: call.id,
        conversationId: call.conversationId,
        ring: true,
      },
    } as NotificationOptions);
  } catch {
    // Οι ειδοποιήσεις είναι βοήθεια, όχι προϋπόθεση.
  }
}

async function closeNotification(callId: string) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    // Μόνο το «σε καλεί»· το «αναπάντητη» που μόλις έδειξε ο worker μένει.
    for (const n of (await reg?.getNotifications({ tag: `call:${callId}` })) ||
      [])
      if ((n.data as { ring?: boolean } | null)?.ring === true) n.close();
  } catch {
    // όπως πάνω
  }
}

// --- Ενέργειες από την οθόνη ---------------------------------------------------

/** Καλώ σε μια συνομιλία. Αν υπάρχει ήδη κλήση εκεί (με πήρε ο άλλος την ίδια
 *  στιγμή, ή τρέχει ομαδική), μπαίνω σε εκείνη. */
export async function placeCall(chat: Chat, video: boolean): Promise<void> {
  if (!me) return;
  if (session && session.phase !== "ended")
    throw new Error(t("call.errAlreadyIn"));
  const provisional: Call = {
    id: "",
    conversationId: chat.id,
    callerId: me.id,
    video,
    status: "ringing",
    endReason: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    participants: [],
  };
  const s = new Session(provisional, me, video);
  session = s;
  emit();
  try {
    await s.acquireMedia();
    if (s.ended()) return;
    const [first, ice] = await Promise.all([
      backend.startCall(chat.id, video),
      backend.iceServers(),
    ]);
    let call = first;
    if (
      call.status !== "ended" &&
      (call.callerId !== me.id || call.status === "active")
    ) {
      handled.add(call.id);
      dropIncoming(call.id);
      call = await backend.joinCall(call.id);
    }
    s.call = call;
    if (s.ended()) {
      void backend.leaveCall(call.id).catch(() => undefined);
      return;
    }
    if (call.status === "ended") {
      s.update(call);
      return;
    }
    await s.connect(ice.servers);
    if (call.status === "ringing" && call.callerId === me.id) s.startRinging();
    else {
      s.phase = "connecting";
      s.connectingSince = Date.now();
    }
    emit();
  } catch (caught) {
    s.notice = messageOf(caught);
    await s.end("error", { leave: Boolean(s.call.id) });
  }
}

/** Σηκώνω. Αν μιλάω ήδη σε άλλη κλήση, εκείνη κλείνει πρώτα. */
export async function answer(callId: string, video: boolean): Promise<void> {
  if (!me) return;
  const call = incoming.get(callId) || (await backend.getCall(callId));
  handled.add(callId);
  dropIncoming(callId);
  if (!call) return;
  if (session && session.phase !== "ended") await session.end("hangup");
  const s = new Session(call, me, video);
  s.phase = "connecting";
  session = s;
  emit();
  let joined = false;
  try {
    await s.acquireMedia();
    if (s.ended()) return;
    const [answered, ice] = await Promise.all([
      backend.joinCall(callId),
      backend.iceServers(),
    ]);
    joined = true;
    s.call = answered;
    if (s.ended()) {
      void backend.leaveCall(callId).catch(() => undefined);
      return;
    }
    await s.connect(ice.servers);
    s.connectingSince = Date.now();
    emit();
  } catch (caught) {
    // Η κλήση έκλεισε στο μεταξύ (την έκλεισα, ή ο άλλος): το τέλος της έχει
    // ήδη γίνει, όπως έπρεπε.
    if (s.ended()) return;
    const text = caught instanceof Error ? caught.message : "";
    const elsewhere = /another device/i.test(text);
    const over = /has ended/i.test(text);
    s.notice = elsewhere
      ? t("call.answeredElsewhere")
      : over
        ? t("call.alreadyEnded")
        : caught instanceof MediaError
          ? t(ANSWER_TEXT[caught.problem])
          : messageOf(caught);
    // Δεν μπήκα τελικά (π.χ. δεν δόθηκε άδεια για το μικρόφωνο): απορρίπτω
    // αμέσως. Αλλιώς ο άλλος θα άκουγε να χτυπάει 45'' και μετά θα έβλεπε
    // «Δεν απάντησε», και οι άλλες συσκευές μου θα συνέχιζαν να χτυπάνε. Αν
    // πρόλαβα να μπω, βγαίνω κανονικά.
    if (!joined && !elsewhere && !over)
      void backend.declineCall(callId).catch(() => undefined);
    await s.end(elsewhere ? "elsewhere" : "error", { leave: joined });
  }
}

/** Μπαίνω σε ομαδική κλήση που τρέχει ήδη. */
export const joinOngoing = (call: Call) => answer(call.id, call.video);

export async function decline(callId: string): Promise<void> {
  handled.add(callId);
  dropIncoming(callId);
  await backend.declineCall(callId).catch(() => undefined);
}

export function hangUp(): void {
  void session?.end("hangup");
}

/** Κλείνει την οθόνη μιας κλήσης που έχει ήδη τελειώσει. */
export function dismiss(): void {
  if (session?.phase === "ended") {
    session = null;
    emit();
  }
}

// Η οθόνη του «τέλος κλήσης» μένει λίγο για να φανεί το γιατί, και φεύγει μόνη.
subscribe(() => {
  const current = session;
  if (current?.phase === "ended" && !current.closing) {
    current.closing = true;
    // Ένα σφάλμα με οδηγίες (π.χ. «δώσε άδεια για το μικρόφωνο») θέλει χρόνο
    // για να διαβαστεί.
    const wait =
      current.endReason === "hangup"
        ? 900
        : current.notice
          ? current.endReason === "error"
            ? 8000
            : 4000
          : 2400;
    window.setTimeout(() => {
      if (session === current) {
        session = null;
        emit();
      }
    }, wait);
  }
});

export const toggleMic = () => session?.toggleMic();
export const toggleCamera = () => void session?.toggleCamera();
export const flipCamera = () => void session?.flipCamera();
export const toggleScreen = () => void session?.toggleScreen();
export const resumeAudio = () => session?.resumeAudio();

export function setMinimized(minimized: boolean): void {
  if (!session) return;
  session.minimized = minimized;
  emit();
}

/** Πάτημα σε ειδοποίηση κλήσης (ή άνοιγμα του app από αυτήν). */
export async function fromNotification(
  callId: string,
  action: "answer" | "decline" | "show",
): Promise<Call | null> {
  if (action === "decline") {
    await decline(callId);
    return null;
  }
  const call = await backend.getCall(callId);
  if (!call || !me) return call;
  const mine = call.participants.find((p) => p.userId === me!.id);
  if (call.status !== "ended" && mine?.state === "ringing") {
    if (action === "answer") await answer(callId, call.video);
    else seen(call);
  }
  return call;
}

/** Ποιος είναι ποιος σε μια κλήση, για τα ονόματα στην οθόνη. */
export function participantName(
  chat: Chat | undefined,
  userId: string,
): string {
  return (
    chat?.others.find((u) => u.id === userId)?.name || t("chat.unknownUser")
  );
}

export type { CallParticipant };
