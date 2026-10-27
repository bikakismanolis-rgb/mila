// Ουρά αποστολής: ό,τι δεν έφυγε (χωρίς δίκτυο, όριο, κάτι στραβό) μένει
// μέσα στη συνομιλία ως «δεν στάλθηκε — πάτα για επανάληψη», αντί να χαθεί.
//
// Ξαναδοκιμάζει μόνο του όταν γυρίσει το δίκτυο και όταν ο χρήστης ξανανοίξει
// τη συνομιλία (ή ξαναγυρίσει στο app). Ποτέ δεν στέλνει δύο φορές:
//   * κάθε μήνυμα έχει από την αρχή το δικό του client_id, ίδιο σε κάθε
//     προσπάθεια, και η βάση (send_message) γυρίζει το ίδιο μήνυμα αν το ξαναδεί·
//   * το αρχείο ανεβαίνει μία φορά· οι επαναλήψεις στέλνουν μόνο το μήνυμα.
// Η κρυπτογράφηση του μηνύματος γίνεται από την αρχή σε κάθε προσπάθεια
// (data.ts, sendMessage), για όσες συσκευές υπάρχουν ΕΚΕΙΝΗ τη στιγμή: αν στο
// μεταξύ μπήκε μέλος ή άλλαξε συσκευή, το νέο μήνυμα το ξέρει. Το κλειδί του
// αρχείου μπαίνει μέσα στο μήνυμα, άρα ξανατυλίγεται κι αυτό.
//
// Μόνο στη μνήμη, όχι στον δίσκο (IndexedDB): το app δεν γράφει πουθενά
// αποκρυπτογραφημένο περιεχόμενο, και ένα μήνυμα που περιμένει είναι ακριβώς
// αυτό — κείμενο, φωτογραφία, φωνή. Αν κλείσει η σελίδα, χάνεται· γι' αυτό ο
// browser ρωτάει πρώτα.

import * as backend from "./data";
import type { MediaInfo, Msg, NewAttachment, SendError } from "./data";
import { t } from "./i18n";

export type Pending = {
  /** Το client_id του μηνύματος. */
  id: string;
  conversationId: string;
  createdAt: string;
  body: string;
  replyTo: Msg | null;
  file: File | null;
  info: MediaInfo;
  /** blob: URL του αρχείου, για να φαίνεται (ή να ακούγεται) όσο περιμένει. */
  preview: string;
  /** "sent": έφυγε, και περιμένει να το αντικαταστήσει το κανονικό μήνυμα. */
  state: "sending" | "failed" | "sent";
  error: string;
  /** Αξίζει να ξαναδοκιμαστεί μόνο του; */
  retry: boolean;
  /** Δεν ξέρουμε αν η τελευταία προσπάθεια έφτασε στη βάση. */
  unsure: boolean;
  /** Το αρχείο ανέβηκε ήδη. */
  uploaded: NewAttachment | null;
};

let items: Pending[] = [];
const listeners = new Set<() => void>();
const running = new Map<string, Promise<boolean>>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Για useSyncExternalStore: νέος πίνακας μόνο όταν κάτι αλλάξει. */
export const snapshot = (): Pending[] => items;

export const find = (id: string): Pending | undefined => items.find((p) => p.id === id);

function set(next: Pending[]): void {
  items = next;
  for (const listener of listeners) listener();
}

function patch(id: string, change: Partial<Pending>): void {
  if (find(id)) set(items.map((p) => (p.id === id ? { ...p, ...change } : p)));
}

/** Μπαίνει στη συνομιλία αμέσως («στέλνεται…»). Φεύγει με το send(). */
export function add(
  conversationId: string,
  body: string,
  extra: { replyTo?: Msg | null; file?: File | null; info?: MediaInfo } = {},
): Pending {
  const file = extra.file || null;
  const item: Pending = {
    id: crypto.randomUUID(),
    conversationId,
    createdAt: new Date().toISOString(),
    body,
    replyTo: extra.replyTo || null,
    file,
    info: extra.info || {},
    preview: file ? URL.createObjectURL(file) : "",
    state: "sending",
    error: "",
    retry: true,
    unsure: false,
    uploaded: null,
  };
  set([...items, item]);
  return item;
}

/** Μία προσπάθεια. true αν έφυγε. Δεύτερη κλήση όσο τρέχει η πρώτη παίρνει
 *  την ίδια απάντηση, δεν ξεκινάει δεύτερη αποστολή. */
export function send(id: string): Promise<boolean> {
  const current = running.get(id);
  if (current) return current;
  const job = attempt(id).finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

async function attempt(id: string): Promise<boolean> {
  const item = find(id);
  if (!item) return false;
  if (item.state === "sent") return true;
  patch(id, { state: "sending", error: "" });
  try {
    // Χωρίς δίκτυο δεν αξίζει να κρυπτογραφηθεί ένα βίντεο 50 MB για να πέσει.
    if (navigator.onLine === false)
      throw Object.assign(new Error(t("err.network")), { retry: true, unsure: false });
    let uploaded = item.uploaded;
    if (item.file && !uploaded) {
      uploaded = await backend.uploadAttachment(item.file, item.conversationId, item.info);
      patch(id, { uploaded });
    }
    await backend.sendMessage(item.conversationId, item.body, {
      attachment: uploaded || undefined,
      replyTo: item.replyTo?.id,
      clientId: item.id,
      keepFile: true,
    });
    patch(id, { state: "sent", unsure: false });
    // Η ανοιχτή συνομιλία το αντικαθιστά με το κανονικό μήνυμα μόλις το
    // φέρει (forget). Αν δεν είναι ανοιχτή, φεύγει μόνο του λίγο μετά.
    window.setTimeout(() => forget(id), 30_000);
    return true;
  } catch (caught) {
    const failure = caught as Partial<SendError>;
    patch(id, {
      state: "failed",
      error: caught instanceof Error ? caught.message : t("err.send"),
      retry: failure.retry !== false,
      unsure: Boolean(failure.unsure),
    });
    return false;
  }
}

/** Ό,τι απέτυχε και αξίζει: ξανά, ένα-ένα με τη σειρά που γράφτηκαν. Χωρίς
 *  συνομιλία: σε όλες. */
export function retryFailed(conversationId?: string): void {
  const due = items.filter(
    (p) =>
      p.state === "failed" &&
      p.retry &&
      (!conversationId || p.conversationId === conversationId),
  );
  if (!due.length) return;
  void (async () => {
    for (const p of due) await send(p.id);
  })();
}

/** Έφτασε το κανονικό μήνυμα (ή πέρασε η ώρα του): φεύγει από την ουρά. */
export function forget(id: string): void {
  const item = find(id);
  if (!item) return;
  if (item.preview) URL.revokeObjectURL(item.preview);
  set(items.filter((p) => p.id !== id));
}

/** Ο χρήστης το σβήνει. Το αρχείο που είχε ήδη ανέβει σβήνεται κι αυτό, εκτός
 *  αν δεν ξέρουμε αν το μήνυμα γράφτηκε: τότε μπορεί να το δείχνει, και ένα
 *  ορφανό αρχείο είναι μικρότερο κακό από ένα χαλασμένο μήνυμα. */
export function remove(id: string): void {
  const item = find(id);
  if (!item || running.has(id)) return;
  if (item.uploaded && !item.unsure) void backend.discardUpload(item.uploaded);
  forget(id);
}

/** Αποσύνδεση: ό,τι περίμενε ήταν του λογαριασμού που φεύγει. */
export function clear(): void {
  for (const p of items) if (p.preview) URL.revokeObjectURL(p.preview);
  set([]);
}

// Γύρισε το δίκτυο. Μία φορά αμέσως, και μία λίγο μετά: η σύνδεση συχνά
// δηλώνεται «πίσω» πριν δουλέψει πραγματικά.
window.addEventListener("online", () => {
  retryFailed();
  window.setTimeout(() => retryFailed(), 4000);
});

// Μηνύματα που δεν έφυγαν χάνονται αν κλείσει η σελίδα: ο browser ρωτάει πρώτα.
window.addEventListener("beforeunload", (event) => {
  if (items.some((p) => p.state !== "sent")) {
    event.preventDefault();
    event.returnValue = "";
  }
});
