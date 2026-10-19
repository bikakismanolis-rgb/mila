// Ήχοι κλήσεων: κουδούνισμα, «τουτ… τουτ…» όσο χτυπάει στον άλλον, κατειλημμένο,
// κλείσιμο. Παράγονται εδώ με WebAudio· δεν υπάρχουν αρχεία ήχου να φορτώσουν.
//
// Οι browsers δεν αφήνουν μια σελίδα να βγάλει ήχο πριν την αγγίξει ο χρήστης.
// Το unlockAudio() «ξεκλειδώνει» τον ήχο στο πρώτο πάτημα οπουδήποτε, ώστε μια
// κλήση που θα έρθει αργότερα να μπορεί να κουδουνίσει.

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === "suspended")
      void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

export function unlockAudio(): void {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/** Ένας τόνος: συχνότητες (μαζί), από πότε, για πόσο, πόσο δυνατά. */
function tone(
  ctx: AudioContext,
  frequencies: number[],
  start: number,
  duration: number,
  volume: number,
  shape: "flat" | "bell" = "flat",
): void {
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const at = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, at);
  if (shape === "bell") {
    gain.gain.linearRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  } else {
    gain.gain.linearRampToValueAtTime(volume, at + 0.02);
    gain.gain.setValueAtTime(volume, at + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, at + duration);
  }
  for (const f of frequencies) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }
}

type Pattern = {
  every: number;
  play: (ctx: AudioContext) => void;
  vibrate?: number[];
};

const PATTERNS: Record<"ring" | "ringback" | "busy", Pattern> = {
  // Εισερχόμενη: δύο «καμπανάκια» που ανεβαίνουν, δύο φορές, κάθε 3 δευτερόλεπτα.
  ring: {
    every: 3000,
    vibrate: [700, 300, 700],
    play: (ctx) => {
      const notes = [659.25, 987.77, 659.25, 987.77];
      notes.forEach((f, i) =>
        tone(ctx, [f, f * 2], i * 0.22 + (i > 1 ? 0.35 : 0), 0.9, 0.16, "bell"),
      );
    },
  },
  // Τόνος κλήσης όπως στην Ευρώπη: 425 Hz, 1 δευτερόλεπτο, 4 σιωπή.
  ringback: {
    every: 5000,
    play: (ctx) => tone(ctx, [425], 0, 1, 0.07),
  },
  // Κατειλημμένο: 425 Hz, μισό δευτερόλεπτο πάνω, μισό κάτω.
  busy: {
    every: 1000,
    play: (ctx) => tone(ctx, [425], 0, 0.5, 0.08),
  },
};

/** Ξεκινάει έναν επαναλαμβανόμενο ήχο. Επιστρέφει τη συνάρτηση που τον σταματά. */
export function startTone(
  kind: keyof typeof PATTERNS,
  limitMs = 60_000,
): () => void {
  const pattern = PATTERNS[kind];
  const started = Date.now();
  let stopped = false;
  const beat = () => {
    if (stopped || Date.now() - started > limitMs) return;
    const ctx = audio();
    if (ctx) pattern.play(ctx);
    if (pattern.vibrate && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern.vibrate);
      } catch {
        // Κάποιοι browsers πετάνε σφάλμα χωρίς πάτημα χρήστη· δεν πειράζει.
      }
    }
  };
  beat();
  const timer = window.setInterval(beat, pattern.every);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    if (pattern.vibrate && "vibrate" in navigator) {
      try {
        navigator.vibrate(0);
      } catch {
        // όπως πάνω
      }
    }
  };
}

/** Σύντομος ήχος: κάποιος μπήκε, η κλήση έκλεισε. */
export function blip(kind: "join" | "leave" | "end"): void {
  const ctx = audio();
  if (!ctx) return;
  if (kind === "join") {
    tone(ctx, [523.25], 0, 0.12, 0.08);
    tone(ctx, [783.99], 0.13, 0.16, 0.08);
  } else if (kind === "leave") {
    tone(ctx, [783.99], 0, 0.12, 0.08);
    tone(ctx, [523.25], 0.13, 0.16, 0.08);
  } else {
    tone(ctx, [480, 620], 0, 0.18, 0.07);
    tone(ctx, [480, 620], 0.26, 0.18, 0.07);
  }
}

/** Ήχος μηνύματος, όταν έρχεται σε άλλη συνομιλία από αυτή που κοιτάζεις. */
export function messageSound(): void {
  const ctx = audio();
  if (!ctx) return;
  tone(ctx, [880], 0, 0.18, 0.05, "bell");
  tone(ctx, [1318.5], 0.09, 0.3, 0.05, "bell");
}
