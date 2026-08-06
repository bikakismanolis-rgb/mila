// Ένα σημείο αλήθειας για το "πού τρέχω τώρα".
//
// Ο ίδιος κώδικας τρέχει σε τέσσερα περιβάλλοντα: browser, εγκατεστημένο PWA,
// native app μέσα σε Capacitor (Android/iOS), και desktop μέσα σε Tauri.
// Οι διαφορές είναι λίγες αλλά κρίσιμες — κυρίως το origin, που στα native
// δεν είναι το domain μας και χαλάει τα auth redirects.

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

export const isTauri = typeof window.__TAURI_INTERNALS__ !== "undefined";

export const nativePlatform = window.Capacitor?.getPlatform?.() ?? "web";

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
 * Το privacy policy. Πάντα απόλυτο URL: μέσα σε Capacitor ένα σκέτο "/privacy"
 * θα έψαχνε αρχείο μέσα στο bundle του app, που δεν υπάρχει εκεί.
 */
export const privacyPolicyUrl = `${publicSiteUrl}/privacy`;

/** Δηλώνει τον service worker. Μόνο σε browser production build. */
export function registerServiceWorker(): void {
  if (isNative || isTauri) return; // τα native έχουν ήδη τα assets τοπικά
  if (!import.meta.env.PROD) return; // στο dev μόνο μπερδεύει
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => console.error("Service worker registration failed:", error));
  });
}
