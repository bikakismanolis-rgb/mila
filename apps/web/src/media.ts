// Προετοιμασία αρχείων πριν φύγουν: φωτογραφίες σε λογικό μέγεθος (και χωρίς
// EXIF), μικρογραφία και διάρκεια για τα βίντεο, συμπίεση των μεγάλων βίντεο,
// ηχογράφηση φωνητικών. Ό,τι βγαίνει εδώ (διάρκεια, μικρογραφία, κυματομορφή)
// ταξιδεύει μέσα στο κρυπτογραφημένο μήνυμα, όχι δίπλα του.

import type { MediaInfo } from "./data";
import { fitsUpload, videoPlan } from "./limits";

// ---------------------------------------------------------------------------
// Φωτογραφίες
// ---------------------------------------------------------------------------

const MAX_SIDE = 2048;

/**
 * Μεγάλες φωτογραφίες (κάμερας κινητού) ξαναζωγραφίζονται σε 2048 px στη
 * μεγάλη πλευρά, ως JPEG. Έτσι ανεβαίνουν γρήγορα, και φεύγουν τα EXIF
 * (τοποθεσία, ώρα, μοντέλο κινητού). PNG/GIF/WebP με διαφάνεια ή κίνηση,
 * και μικρές εικόνες, μένουν όπως είναι.
 */
export async function preparePhoto(file: File): Promise<{ file: File; info: MediaInfo }> {
  if (!/^image\/(jpeg|jpg|heic|heif|webp)$/i.test(file.type)) {
    return { file, info: await imageSize(file) };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    // Π.χ. HEIC σε browser που δεν το ανοίγει: φεύγει όπως είναι.
    return { file, info: {} };
  }
  try {
    // Ξαναζωγραφίζεται πάντα, και όταν είναι ήδη μικρή: μόνο έτσι φεύγουν τα EXIF.
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, info: { width: bitmap.width, height: bitmap.height } };
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return { file, info: { width, height } };
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return { file: new File([blob], name, { type: "image/jpeg" }), info: { width, height } };
  } finally {
    bitmap.close();
  }
}

async function imageSize(file: File): Promise<MediaInfo> {
  try {
    const bitmap = await createImageBitmap(file);
    const info = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return info;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Βίντεο
// ---------------------------------------------------------------------------

/** Διάρκεια, διαστάσεις, και ένα καρέ για μικρογραφία (μικρό JPEG). */
export async function prepareVideo(file: File): Promise<MediaInfo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("video"));
      }),
      5000,
    );
    const duration = await knownDuration(video);
    const info: MediaInfo = {
      duration: duration || undefined,
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
    };
    try {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
      await withTimeout(
        new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        }),
        4000,
      );
      info.poster = snapshot(video, video.videoWidth, video.videoHeight);
    } catch {
      // Χωρίς μικρογραφία: θα φανεί ένα γκρι πλαίσιο με το ▶.
    }
    return info;
  } catch {
    return {};
  } finally {
    // Πρώτα σταματά το στοιχείο, μετά σβήνει η διεύθυνση: αλλιώς ο browser
    // ψάχνει ακόμα το αρχείο (π.χ. μετά το άλμα στο τέλος για τη διάρκεια).
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Η διάρκεια σε δευτερόλεπτα, ή 0. Τα αρχεία του MediaRecorder (βίντεο από
 *  άλλον browser ή app) συχνά δεν τη γράφουν (Infinity): ένα άλμα στο τέλος
 *  αναγκάζει τον browser να τη βρει. */
async function knownDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return video.duration;
  try {
    await withTimeout(
      new Promise<void>((resolve) => {
        video.ondurationchange = () => {
          if (Number.isFinite(video.duration)) resolve();
        };
        video.currentTime = 1e101;
      }),
      3000,
    );
  } catch {
    // Δεν βρέθηκε: μένει άγνωστη.
  } finally {
    video.ondurationchange = null;
  }
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (video.currentTime) {
    video.currentTime = 0;
    await withTimeout(
      new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      }),
      3000,
    ).catch(() => undefined);
    video.onseeked = null;
  }
  return duration;
}

/** Μικρογραφία έως 320 px και ~14 KB, για να χωράει άνετα στο μήνυμα. */
function snapshot(source: CanvasImageSource, width: number, height: number): string | undefined {
  if (!width || !height) return undefined;
  for (const side of [320, 240, 160]) {
    const scale = Math.min(1, side / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.6);
    if (url.length < 19_000) return url;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Συμπίεση βίντεο
// ---------------------------------------------------------------------------
// Το βίντεο παίζει κρυφά (ούτε φαίνεται ούτε ακούγεται) και ξαναγράφεται:
// κάθε καρέ ζωγραφίζεται σε canvas ~720p, ο ήχος περνάει από το Web Audio, και
// το MediaRecorder τα γράφει με χαμηλότερο bitrate (limits.ts, videoPlan). Σε
// πραγματικό χρόνο: ένα λεπτό βίντεο θέλει ένα λεπτό. Όπου κάτι από αυτά λείπει
// ή πάει στραβά, δεν γίνεται τίποτα: το βίντεο φεύγει όπως είναι, ή, αν δεν
// χωράει, βγαίνει το γνωστό «πολύ μεγάλο».

const AudioCtor: typeof AudioContext | undefined =
  typeof window === "undefined"
    ? undefined
    : window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export const canSqueezeVideo =
  typeof MediaRecorder !== "undefined" &&
  typeof HTMLCanvasElement !== "undefined" &&
  typeof HTMLCanvasElement.prototype.captureStream === "function" &&
  Boolean(AudioCtor);

/** MP4 (H.264) όπου γίνεται: παίζει παντού, και στο iPhone. Αλλιώς WebM. */
function videoRecorderType(): string {
  const options = [
    "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01F,opus",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export type Squeezed = { file: File; width: number; height: number };

export type SqueezeBatch = {
  /** Ένα-ένα, με τη σειρά. null αν δεν μίκρυνε (ή ακυρώθηκε). */
  run: (
    index: number,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ) => Promise<Squeezed | null>;
  /** Τέλος: ελευθερώνει ό,τι κρατήθηκε. */
  dispose: () => void;
};

/**
 * Ετοιμάζει τη συμπίεση. ΠΡΕΠΕΙ να καλείται μέσα στο πάτημα του χρήστη (στο
 * click του «Αποστολή»), πριν από κάθε await: το Safari, και κάθε browser στο
 * iPhone, αφήνουν ένα βίντεο να παίξει με ήχο μόνο αν ξεκίνησε από πάτημα.
 * Γι' αυτό εδώ γίνονται ΜΟΝΟ τα σύγχρονα: τα στοιχεία <video>, το Web Audio,
 * και ένα play/pause σε καθένα που τα «ξεκλειδώνει». null αν δεν γίνεται.
 */
export function prepareSqueeze(files: File[]): SqueezeBatch | null {
  if (!canSqueezeVideo || !AudioCtor) return null;
  let audio: AudioContext;
  try {
    audio = new AudioCtor();
  } catch {
    return null;
  }
  void audio.resume().catch(() => undefined);
  const urls: string[] = [];
  const videos = files.map((file) => {
    const url = URL.createObjectURL(file);
    urls.push(url);
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    video.play().catch(() => undefined);
    video.pause();
    return video;
  });
  return {
    run: (index, onProgress, signal) =>
      squeeze(files[index], videos[index], audio, onProgress, signal).catch(() => null),
    dispose: () => {
      for (const video of videos) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      for (const url of urls) URL.revokeObjectURL(url);
      void audio.close().catch(() => undefined);
    },
  };
}

/** Έχει το βίντεο ήχο; null αν ο browser δεν το λέει. */
function hasAudio(video: HTMLVideoElement): boolean | null {
  const v = video as HTMLVideoElement & {
    mozHasAudio?: boolean;
    audioTracks?: { length: number };
    webkitAudioDecodedByteCount?: number;
  };
  if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
  if (v.audioTracks) return v.audioTracks.length > 0;
  if (typeof v.webkitAudioDecodedByteCount === "number") return v.webkitAudioDecodedByteCount > 0;
  return null;
}

async function squeeze(
  file: File,
  video: HTMLVideoElement,
  audio: AudioContext,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Squeezed | null> {
  if (signal.aborted) return null;
  if (video.readyState < 1)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("video"));
      }),
      10_000,
    );
  const duration = await knownDuration(video);
  const plan = videoPlan(duration, video.videoWidth, video.videoHeight);
  if (!plan || signal.aborted) return null;

  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Ο ήχος πάει ΜΟΝΟ στην εγγραφή (όχι στα ηχεία), και σε έναν «μετρητή»: αν
  // ο browser δώσει σιωπή αντί για τον ήχο, δεν στέλνουμε βουβό βίντεο.
  const source = audio.createMediaElementSource(video);
  const sink = audio.createMediaStreamDestination();
  const meter = audio.createAnalyser();
  meter.fftSize = 512;
  source.connect(sink);
  source.connect(meter);
  const samples = new Float32Array(meter.fftSize);
  let heard = false;

  const frames = canvas.captureStream(30);
  const stream = new MediaStream([
    ...frames.getVideoTracks(),
    ...sink.stream.getAudioTracks(),
  ]);
  const type = videoRecorderType();
  const recorder = new MediaRecorder(stream, {
    ...(type ? { mimeType: type } : {}),
    videoBitsPerSecond: plan.videoBitsPerSecond,
    audioBitsPerSecond: plan.audioBitsPerSecond,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  let watchdog: number | undefined;
  let onVisibility: (() => void) | undefined;
  try {
    const outcome = await new Promise<"done" | "failed" | "aborted">((resolve) => {
      let finished = false;
      const finish = (how: "done" | "failed" | "aborted") => {
        if (finished) return;
        finished = true;
        resolve(how);
      };
      const withFrames = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      const draw = () => {
        if (finished) return;
        ctx.drawImage(video, 0, 0, plan.width, plan.height);
        onProgress(Math.min(1, video.currentTime / duration));
        if (withFrames.requestVideoFrameCallback) withFrames.requestVideoFrameCallback(draw);
        else requestAnimationFrame(draw);
      };
      video.onended = () => finish("done");
      video.onerror = () => finish("failed");
      signal.addEventListener("abort", () => finish("aborted"), { once: true });

      // Στο παρασκήνιο ο browser σταματά να ζωγραφίζει: παύση, αλλιώς το
      // βίντεο θα έβγαινε «παγωμένο». Και αν κολλήσει (π.χ. δεν ξέρει να το
      // αποκωδικοποιήσει), τα παρατάμε.
      onVisibility = () => {
        if (document.visibilityState === "hidden") {
          video.pause();
          if (recorder.state === "recording") recorder.pause();
        } else if (!finished) {
          if (recorder.state === "paused") recorder.resume();
          video.play().catch(() => finish("failed"));
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      let last = -1;
      let still = 0;
      watchdog = window.setInterval(() => {
        meter.getFloatTimeDomainData(samples);
        if (!heard && samples.some((x) => Math.abs(x) > 1e-6)) heard = true;
        if (document.visibilityState === "hidden") return;
        if (video.currentTime !== last) {
          last = video.currentTime;
          still = 0;
        } else if (++still > 60) finish("failed");
      }, 250);

      // Η εγγραφή αρχίζει μόλις παίξει, για να μη γραφτεί μαύρο καρέ στην αρχή.
      video.play().then(
        () => {
          if (finished) return;
          recorder.start(1000);
          draw();
        },
        () => finish("failed"),
      );
    });

    video.pause();
    if (recorder.state !== "inactive")
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    if (outcome !== "done") return null;
    if (hasAudio(video) && !heard) return null;

    const mime = (recorder.mimeType || type || "video/webm").split(";")[0];
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size || !fitsUpload(blob.size)) return null;
    const name = `${file.name.replace(/\.[^.]+$/, "") || "video"}.${mime.includes("mp4") ? "mp4" : "webm"}`;
    onProgress(1);
    return { file: new File([blob], name, { type: mime }), width: plan.width, height: plan.height };
  } finally {
    window.clearInterval(watchdog);
    if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    for (const track of stream.getTracks()) track.stop();
    source.disconnect();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// Φωνητικά μηνύματα
// ---------------------------------------------------------------------------

/** Μορφή που παίζει παντού: AAC σε MP4 όπου γίνεται (Safari, νέοι Chrome),
 *  αλλιώς Opus. */
function recorderType(): string {
  const options = [
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return options.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

export const canRecord =
  typeof MediaRecorder !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";

export const MAX_VOICE_SECONDS = 15 * 60;
const BARS = 48;

export type Recording = {
  /** Ζωντανή στάθμη 0-1, για το κινούμενο κυματάκι. */
  level: () => number;
  elapsed: () => number;
  paused: () => boolean;
  pause: () => void;
  resume: () => void;
  /** Τελειώνει και δίνει το αρχείο, ή null αν ήταν πολύ σύντομο. */
  finish: () => Promise<{ file: File; info: MediaInfo } | null>;
  cancel: () => void;
};

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const type = recorderType();
  const recorder = new MediaRecorder(stream, {
    ...(type ? { mimeType: type } : {}),
    audioBitsPerSecond: 48_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  // Στάθμη ήχου για την κυματομορφή: ένα δείγμα κάθε 50 ms.
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Uint8Array(analyser.fftSize);
  const samples: number[] = [];
  let current = 0;
  const sampler = window.setInterval(() => {
    if (recorder.state !== "recording") return;
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const v of buffer) sum += ((v - 128) / 128) ** 2;
    current = Math.min(1, Math.sqrt(sum / buffer.length) * 3.2);
    samples.push(current);
  }, 50);

  let startedAt = performance.now();
  let pausedTotal = 0;
  let pausedAt = 0;
  const elapsed = () =>
    ((pausedAt || performance.now()) - startedAt - pausedTotal) / 1000;

  const cleanup = () => {
    window.clearInterval(sampler);
    for (const track of stream.getTracks()) track.stop();
    void ctx.close().catch(() => undefined);
  };

  recorder.start(250);
  startedAt = performance.now();

  return {
    level: () => current,
    elapsed,
    paused: () => recorder.state === "paused",
    pause: () => {
      if (recorder.state === "recording") {
        recorder.pause();
        pausedAt = performance.now();
      }
    },
    resume: () => {
      if (recorder.state === "paused") {
        recorder.resume();
        pausedTotal += performance.now() - pausedAt;
        pausedAt = 0;
      }
    },
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
    },
    finish: () =>
      new Promise((resolve) => {
        const duration = elapsed();
        recorder.onstop = () => {
          cleanup();
          if (duration < 0.7 || !chunks.length) {
            resolve(null);
            return;
          }
          const mime = (recorder.mimeType || type || "audio/webm").split(";")[0];
          const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
          const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
          const file = new File(chunks, `voice-${stamp}.${ext}`, { type: mime });
          resolve({ file, info: { voice: true, duration, waveform: bars(samples) } });
        };
        if (recorder.state !== "inactive") recorder.stop();
        else recorder.onstop?.(new Event("stop"));
      }),
  };
}

/** Τα δείγματα σε 48 στήλες, 0-31, κανονικοποιημένες στη δυνατότερη. */
function bars(samples: number[]): number[] {
  if (!samples.length) return new Array(BARS).fill(4);
  const out: number[] = [];
  for (let i = 0; i < BARS; i++) {
    const from = Math.floor((i * samples.length) / BARS);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / BARS));
    let peak = 0;
    for (let j = from; j < to && j < samples.length; j++) peak = Math.max(peak, samples[j]);
    out.push(peak);
  }
  const top = Math.max(...out, 0.05);
  return out.map((v) => Math.max(2, Math.round((v / top) * 31)));
}
