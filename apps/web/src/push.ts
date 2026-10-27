// Ειδοποιήσεις όταν έρχεται μήνυμα και το Mila είναι κλειστό (Web Push).
//
// Πώς δουλεύει, με απλά λόγια: ο browser δίνει στο Mila μια «διεύθυνση
// παράδοσης» για αυτή τη συσκευή (subscription). Τη σώζουμε στη βάση. Όταν
// έρθει μήνυμα, ο server στέλνει εκεί την ειδοποίηση και ο browser την
// εμφανίζει — ακόμα κι αν το app δεν είναι ανοιχτό. Το περιεχόμενο ταξιδεύει
// κρυπτογραφημένο: οι ενδιάμεσοι (Google/Apple/Mozilla) δεν το διαβάζουν.
//
// Δουλεύει σε: Chrome/Edge/Firefox (Android, υπολογιστή) και σε iPhone ΜΟΝΟ
// αν το Mila έχει μπει στην αρχική οθόνη (iOS 16.4+). Μέσα στα native κελύφη
// (Capacitor/Tauri) δεν υπάρχει Web Push· εκεί θα χρειαστεί άλλος δρόμος.

import * as backend from "./data";
import { isNative, isTauri } from "./platform";
import { t } from "./i18n";

export type PushState = "checking" | "unsupported" | "denied" | "off" | "on";

const supported =
  !isNative &&
  !isTauri &&
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** Μπορεί αυτή η συσκευή να πάρει ειδοποιήσεις; (Χωρίς να ρωτήσει τον χρήστη.) */
export const pushSupported = supported;

/** Ο service worker, ή null αν δεν υπάρχει (π.χ. dev build, όπου δεν δηλώνεται).
 *  Το navigator.serviceWorker.ready δεν τελειώνει ΠΟΤΕ αν δεν υπάρχει worker,
 *  γι' αυτό μπαίνει όριο χρόνου. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported) return null;
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), 4000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function pushState(): Promise<PushState> {
  if (!supported) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "unsupported";
  const subscription = await reg.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/** Πρέπει να καλείται από πάτημα του χρήστη: το iOS δεν δείχνει αλλιώς το
 *  παράθυρο άδειας. */
export async function enablePush(): Promise<void> {
  if (!supported) throw new Error(t("push.unsupported"));
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(t("push.blocked"));

  const reg = await registration();
  if (!reg) throw new Error(t("push.unsupported"));

  const key = decodeKey(await backend.pushPublicKey());
  let subscription = await reg.pushManager.getSubscription();
  // Συνδρομή φτιαγμένη με άλλο κλειδί δεν θα λάβει ποτέ τίποτα από εμάς.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription =
    subscription ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
    throw new Error(t("err.pushSave"));
  await backend.savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
  setPushOfferAgain(false);
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await backend.removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

// Μετά από αποσύνδεση ο browser κρατά την άδεια («granted»), άρα η κάρτα στη
// λίστα συνομιλιών (που ρωτά μόνο όσους δεν έχουν απαντήσει) δεν θα ξαναφαινόταν
// ποτέ, και οι ειδοποιήσεις θα έμεναν κλειστές χωρίς να το ξέρει κανείς.
const OFFER_AGAIN_KEY = "mila:push-offer-again";

/** Να ξαναπροταθούν οι ειδοποιήσεις, παρότι ο browser έχει ήδη δώσει άδεια; */
export function pushOfferAgain(): boolean {
  try {
    return localStorage.getItem(OFFER_AGAIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPushOfferAgain(on: boolean): void {
  try {
    if (on) localStorage.setItem(OFFER_AGAIN_KEY, "1");
    else localStorage.removeItem(OFFER_AGAIN_KEY);
  } catch {
    // Ιδιωτική περιήγηση: απλώς δεν θα ξαναπροταθούν.
  }
}

/** Αποσύνδεση (ή διαγραφή λογαριασμού): η συσκευή σταματά να παίρνει
 *  ειδοποιήσεις, και αν τις είχε, η επόμενη σύνδεση τις ξαναπροτείνει. Όχι
 *  όταν τις κλείνει ο ίδιος ο χρήστης από τις Ρυθμίσεις (εκεί disablePush). */
export async function disablePushOnSignOut(): Promise<void> {
  const reg = await registration();
  if (!(await reg?.pushManager.getSubscription())) return;
  setPushOfferAgain(true);
  await disablePush();
}

/**
 * Αν η συσκευή έχει ήδη συνδρομή, τη δένει με τον χρήστη που μόλις μπήκε.
 * Χωρίς αυτό, αν αλλάξει λογαριασμός στην ίδια συσκευή, οι ειδοποιήσεις θα
 * συνέχιζαν να έρχονται για τον προηγούμενο.
 */
export async function refreshPushOwner(): Promise<void> {
  try {
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    const json = subscription?.toJSON();
    if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
    if (Notification.permission !== "granted") return;
    await backend.savePushSubscription({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
  } catch (error) {
    console.warn("Push subscription refresh skipped:", error);
  }
}
