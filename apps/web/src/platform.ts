// Ένα σημείο αλήθειας για το "πού τρέχω τώρα".
//
// Ο ίδιος κώδικας τρέχει σε τέσσερα περιβάλλοντα: browser, εγκατεστημένο PWA,
// native app μέσα σε Capacitor (Android/iOS), και desktop μέσα σε Tauri.
// Οι διαφορές είναι λίγες αλλά κρίσιμες — κυρίως το origin, που στα native
// δεν είναι το domain μας και χαλάει τα auth redirects.

import { lang } from "./i18n";

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

export const isTauri = typeof window.__TAURI_INTERNALS__ !== "undefined";

export const nativePlatform = window.Capacitor?.getPlatform?.() ?? "web";

/** Κινητό ή tablet (αφή, πληκτρολόγιο οθόνης). Αλλάζει μικρά πράγματα, π.χ.
 *  το Enter αλλάζει γραμμή αντί να στέλνει. */
export const isMobile =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** iPhone ή iPad (το iPad δηλώνεται κι αυτό «Macintosh», αλλά έχει αφή).
 *  Εκεί οι ειδοποιήσεις δουλεύουν μόνο αν το Mila ανοίξει από την αρχική οθόνη. */
export const isIOS =
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** Εγκατεστημένο PWA (προστέθηκε στην αρχική οθόνη), όχι απλό tab. */
export const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  // iOS Safari, που δεν υποστηρίζει το display-mode query
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Το δημόσιο domain του app, όπως το βλέπει ο έξω κόσμος. */
export const publicSiteUrl: string =
  (import.meta.env.VITE_PUBLIC_SITE_URL as string) ||
  "https://mila-web-ivory.vercel.app";

/**
 * Πού πρέπει να γυρίσει ο χρήστης μετά από επιβεβαίωση email ή OAuth.
 *
 * Στον browser είναι απλά το origin. Στα native το origin είναι
 * `capacitor://localhost` — άχρηστο ως redirect target, γιατί η Supabase δεν
 * μπορεί να στείλει εκεί και το mail client δεν ξέρει να το ανοίξει. Γι' αυτό
 * δείχνουμε στο public site, που έχει καταχωρηθεί ως Redirect URL στη Supabase.
 */
export const authRedirectUrl: string =
  isNative || isTauri ? publicSiteUrl : window.location.origin;

export const passwordResetRedirectUrl = `${authRedirectUrl}/?resetPassword=1`;

/**
 * Η πολιτική απορρήτου και οι όροι χρήσης. Πάντα απόλυτο URL: μέσα σε
 * Capacitor ένα σκέτο "/privacy" θα έψαχνε αρχείο μέσα στο bundle του app, που
 * δεν υπάρχει εκεί. Κάθε σελίδα έχει και τις δύο γλώσσες· το #en ανοίγει
 * κατευθείαν τα Αγγλικά.
 */
const legalSection = lang === "en" ? "#en" : "";
export const privacyPolicyUrl = `${publicSiteUrl}/privacy${legalSection}`;
export const termsUrl = `${publicSiteUrl}/terms${legalSection}`;

/** Πότε ΔΕΝ κάνει να ξαναφορτώσει η σελίδα (π.χ. στη μέση μιας κλήσης), και
 *  πώς μαθαίνουμε ότι αυτό άλλαξε. */
export type ReloadGuard = {
  busy: () => boolean;
  watch: (listener: () => void) => () => void;
};

/** Δηλώνει τον service worker. Μόνο σε browser production build.
 *
 *  Νέα έκδοση: ο νέος worker αναλαμβάνει αμέσως (skipWaiting), αλλά ένα
 *  ανοιχτό παράθυρο τρέχει ακόμα τον παλιό κώδικα μέχρι να ξαναφορτώσει.
 *  Το ξαναφορτώνουμε μόνοι μας όταν είναι ακίνδυνο: όταν δεν φαίνεται (ο
 *  χρήστης δεν χάνει κάτι που βλέπει) και ΠΟΤΕ όσο τρέχει ή χτυπάει κλήση.
 *  Αν εκείνη τη στιγμή δεν γίνεται, ξαναρωτάμε όταν αλλάξει κάτι από τα δύο. */
export function registerServiceWorker(guard?: ReloadGuard): void {
  if (isNative || isTauri) return; // τα native έχουν ήδη τα assets τοπικά
  if (!import.meta.env.PROD) return; // στο dev μόνο μπερδεύει
  if (!("serviceWorker" in navigator)) return;

  // Πρώτη επίσκεψη: ο worker «παίρνει» μια σελίδα που δεν είχε κανέναν. Δεν
  // είναι νέα έκδοση, δεν χρειάζεται τίποτα.
  let controlled = Boolean(navigator.serviceWorker.controller);
  let updated = false;
  let reloading = false;
  const reloadIfSafe = () => {
    if (!updated || reloading || document.visibilityState !== "hidden") return;
    if (guard?.busy()) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (controlled) updated = true;
    controlled = true;
    reloadIfSafe();
  });
  document.addEventListener("visibilitychange", reloadIfSafe);
  guard?.watch(reloadIfSafe);

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Ένα app που μένει ανοιχτό μέρες δεν «πλοηγείται» ποτέ, άρα ο browser
        // δεν ελέγχει μόνος του για νέα έκδοση. Ελέγχουμε όταν ξαναέρχεται
        // μπροστά, το πολύ μία φορά την ώρα.
        let checkedAt = Date.now();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState !== "visible" || Date.now() - checkedAt < 3_600_000)
            return;
          checkedAt = Date.now();
          void registration.update().catch(() => undefined);
        });
      })
      .catch((error) => console.error("Service worker registration failed:", error));
  });
}
