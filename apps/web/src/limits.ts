// Πόσο μεγάλο αρχείο χωράει, και πώς συμπιέζεται ένα βίντεο ώστε να χωρέσει.
// Μόνο αριθμοί, χωρίς browser: το ελέγχει και το scripts/test-media-limits.mjs.
//
// Η Supabase (δωρεάν πλάνο) δέχεται έως 50 MB ανά αρχείο. Αυτό που ανεβαίνει
// είναι κρυπτογραφημένο (e2ee.encryptFile, AES-GCM): όσο το αρχικό + 16 bytes,
// το tag. Το iv δεν μπαίνει στο αρχείο· ταξιδεύει μέσα στο μήνυμα. Άρα το
// αρχικό αρχείο φτάνει τα 50 MB μείον 16 bytes, και ο bucket (0016) έχει όριο
// ακριβώς 50 MB — όσο και το όριο ολόκληρου του project.

/** Το όριο του bucket message-media (0016) και του project: 50 MB. */
export const MAX_SEALED = 50 * 1024 * 1024;
/** Ό,τι προσθέτει η κρυπτογράφηση σε κάθε αρχείο: το tag του AES-GCM. */
export const SEAL_OVERHEAD = 16;
/** Το μεγαλύτερο αρχείο που δέχεται το app, πριν την κρυπτογράφηση. */
export const MAX_FILE = MAX_SEALED - SEAL_OVERHEAD;
/** Για τα κείμενα της οθόνης («έως 50 MB»). */
export const MAX_FILE_MB = Math.floor(MAX_SEALED / (1024 * 1024));

export const sealedSize = (plain: number): number => plain + SEAL_OVERHEAD;

export const fitsUpload = (plain: number): boolean =>
  plain >= 0 && sealedSize(plain) <= MAX_SEALED;

// ---------------------------------------------------------------------------
// Βίντεο
// ---------------------------------------------------------------------------
// Η συμπίεση γίνεται στον browser και σε πραγματικό χρόνο (ένα λεπτό βίντεο
// θέλει ένα λεπτό). Γι' αυτό γίνεται μόνο όταν αξίζει: όταν το αρχείο δεν
// χωράει, ή όταν είναι μεγάλο ΚΑΙ βαρύ (π.χ. 1080p/4K κινητού, 10-50 Mbps).

/** Κάτω από αυτό, ένα βίντεο φεύγει όπως είναι. */
export const SQUEEZE_ABOVE = 25 * 1024 * 1024;
/** Ο στόχος: ~720p στα 2 Mbps, καθαρό σε κινητό και ~15 MB το λεπτό. */
export const TARGET_VIDEO_BPS = 2_000_000;
/** Πιο κάτω η εικόνα χαλάει πολύ· τότε το βίντεο είναι απλώς πολύ μεγάλο. */
export const MIN_VIDEO_BPS = 400_000;
export const AUDIO_BPS = 96_000;
/** Το MediaRecorder δεν πετυχαίνει ακριβώς το bitrate που του ζητάς, και το
 *  container θέλει κι αυτό λίγο χώρο: αφήνουμε 15% περιθώριο. */
export const HEADROOM = 0.85;
const LONG_SIDE = 1280;
const SHORT_SIDE = 720;

export type VideoPlan = {
  width: number;
  height: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
};

/** Αξίζει να συμπιεστεί; (duration σε δευτερόλεπτα, αν την ξέρουμε). */
export function shouldSqueeze(size: number, duration?: number): boolean {
  if (!fitsUpload(size)) return true;
  if (size <= SQUEEZE_ABOVE || !duration || !(duration > 0)) return false;
  return (size * 8) / duration > 2 * TARGET_VIDEO_BPS;
}

/** Νέες διαστάσεις (έως 1280x720, ίδια αναλογία, ζυγοί αριθμοί) και bitrate
 *  ώστε να χωράει με περιθώριο. null αν δεν γίνεται: άγνωστη διάρκεια ή
 *  διαστάσεις, ή τόσο μεγάλη διάρκεια που δεν χωράει ούτε με το ελάχιστο. */
export function videoPlan(duration: number, width: number, height: number): VideoPlan | null {
  if (!(duration > 0) || !Number.isFinite(duration) || !(width > 0) || !(height > 0))
    return null;
  const budget = (MAX_FILE * HEADROOM * 8) / duration - AUDIO_BPS;
  if (budget < MIN_VIDEO_BPS) return null;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, LONG_SIDE / long, SHORT_SIDE / short);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return {
    width: even(width),
    height: even(height),
    videoBitsPerSecond: Math.floor(Math.min(TARGET_VIDEO_BPS, budget)),
    audioBitsPerSecond: AUDIO_BPS,
  };
}

/** Πόσο θα βγει περίπου (bytes), αν το MediaRecorder κρατήσει το bitrate. */
export function plannedSize(plan: VideoPlan, duration: number): number {
  return Math.ceil(((plan.videoBitsPerSecond + plan.audioBitsPerSecond) * duration) / 8);
}
