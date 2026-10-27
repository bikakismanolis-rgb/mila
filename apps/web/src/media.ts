// Προετοιμασία αρχείων πριν φύγουν: φωτογραφίες σε λογικό μέγεθος (και χωρίς
// EXIF), μικρογραφία και διάρκεια για τα βίντεο, ηχογράφηση φωνητικών.
// Ό,τι βγαίνει εδώ (διάρκεια, μικρογραφία, κυματομορφή) ταξιδεύει μέσα στο
// κρυπτογραφημένο μήνυμα, όχι δίπλα του.

import type { MediaInfo } from "./data";

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
    const info: MediaInfo = {
      duration: Number.isFinite(video.duration) ? video.duration : undefined,
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
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
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
