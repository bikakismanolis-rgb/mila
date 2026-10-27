// Το κέλυφος του app: σύνδεση, πλοήγηση, λίστα συνομιλιών, αναζήτηση.
// Η ανοιχτή συνομιλία είναι στο components/Conversation.tsx, οι ρυθμίσεις στο
// components/Settings.tsx, η είσοδος στο components/Login.tsx.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  ArrowLeft,
  BellOff,
  LogOut,
  MessageCircle,
  Phone,
  Pin,
  Search,
  Settings,
  Share2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./styles.css";
import { supabase } from "./supabase";
// Ονομάζεται backend και όχι data, γιατί το `data` χρησιμοποιείται ήδη
// παντού ως destructured μεταβλητή από τις απαντήσεις του Supabase.
import * as backend from "./data";
import type { Chat, Msg, User } from "./data";
import * as calls from "./calls";
import { messageSound, unlockAudio } from "./tones";
import { isNative, isStandalone, isTauri, registerServiceWorker } from "./platform";
import { bootstrapNative } from "./native";
import { t, translateError } from "./i18n";
import { listTime } from "./format";
import { disablePush, refreshPushOwner } from "./push";
import { Empty } from "./components/common";
import { Login } from "./components/Login";
import { Landing } from "./components/Landing";
import { SettingsPanel } from "./components/Settings";
import {
  Conversation,
  chatAvatar,
  chatTitle,
  messageSnippet,
} from "./components/Conversation";
import { CallOverlay } from "./components/Call";
import { CallIcon, CallsList, describeCall, unseenMissed } from "./components/CallsTab";
import { NewGroupDialog } from "./components/Groups";
import { InviteDialog } from "./components/Invite";
import { SuspendedScreen } from "./components/Suspended";

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

function isPasswordRecoveryLink() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    search.get("resetPassword") === "1" ||
    window.location.pathname === "/reset-password" ||
    search.get("type") === "recovery" ||
    hash.get("type") === "recovery"
  );
}

/** Η αρχική σελίδα είναι για επισκέπτες στον browser. Το εγκατεστημένο app,
 *  τα native κελύφη, και όποιος έρχεται από link επιβεβαίωσης/επαναφοράς ή με
 *  ?login, πάνε κατευθείαν στην είσοδο. */
function wantsLanding(): boolean {
  if (isStandalone || isNative || isTauri || isPasswordRecoveryLink()) return false;
  const search = new URLSearchParams(window.location.search);
  if (search.has("login") || search.has("c") || search.has("call") || search.has("code"))
    return false;
  return !/access_token|error_description/.test(window.location.hash);
}

/** Ειδοποίηση κλήσης: το app ανοίγει στο /?call=<id>&action=answer|decline|show. */
function takeCallFromUrl(): { id: string; action: "answer" | "decline" | "show" } | null {
  const search = new URLSearchParams(window.location.search);
  const id = search.get("call");
  if (!id) return null;
  const raw = search.get("action");
  search.delete("call");
  search.delete("action");
  const rest = search.toString();
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname + (rest ? `?${rest}` : ""),
  );
  return { id, action: raw === "answer" || raw === "decline" ? raw : "show" };
}

/** Πότε έγινε το τελευταίο πράγμα σε μια συνομιλία: μήνυμα ή κλήση. */
function activityOf(c: Chat): number {
  return Math.max(
    c.last ? Date.parse(c.last.createdAt) : 0,
    c.lastCall ? Date.parse(c.lastCall.createdAt) : 0,
    Date.parse(c.createdAt) || 0,
  );
}

/** Η ειδοποίηση ανοίγει το app στο /?c=<id συνομιλίας>. Το διαβάζουμε μία
 *  φορά και καθαρίζουμε τη διεύθυνση. */
function takeConversationFromUrl(): string | null {
  const search = new URLSearchParams(window.location.search);
  const id = search.get("c");
  if (!id) return null;
  search.delete("c");
  const rest = search.toString();
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname + (rest ? `?${rest}` : ""),
  );
  return id;
}

function App() {
  const [me, setMe] = useState<User | null>(null),
    // Λογαριασμός σε αναστολή: δεν μπαίνει καν στο app (το me μένει null, άρα
    // δεν ξεκινάνε λίστα, κλήσεις, «σε σύνδεση»), βλέπει μόνο την οθόνη αναστολής.
    [suspended, setSuspended] = useState<User | null>(null),
    // Μέχρι να ξέρουμε αν υπάρχει ήδη συνεδρία, δεν δείχνουμε ούτε αρχική
    // σελίδα ούτε είσοδο: αλλιώς ένας συνδεδεμένος χρήστης τις βλέπει να
    // «αναβοσβήνουν» πριν ανοίξει η εφαρμογή.
    [sessionChecked, setSessionChecked] = useState(false),
    [entry, setEntry] = useState<"landing" | "signin" | "signup">(() =>
      wantsLanding() ? "landing" : "signin",
    ),
    [recoveringPassword, setRecoveringPassword] = useState(
      () =>
        isPasswordRecoveryLink() ||
        sessionStorage.getItem("mila:password-recovery") === "1",
    ),
    [chats, setChats] = useState<Chat[]>([]),
    [activeId, setActiveId] = useState<string | null>(() =>
      takeConversationFromUrl(),
    ),
    // Μόλις φτιάχτηκε και δεν έχει προλάβει να έρθει στη λίστα.
    [fallbackChat, setFallbackChat] = useState<Chat | null>(null),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<User[]>([]),
    [imported, setImported] = useState(false),
    [messageHits, setMessageHits] = useState<Msg[]>([]),
    [jumpTo, setJumpTo] = useState<string | null>(null),
    [mode, setMode] = useState<"chat" | "calls" | "search" | "settings">("chat"),
    [showArchived, setShowArchived] = useState(false),
    [callsVersion, setCallsVersion] = useState(0),
    [missedSeen, setMissedSeen] = useState(0),
    [newGroup, setNewGroup] = useState(false),
    // null = κλειστό· αλλιώς ό,τι να είναι ήδη γραμμένο στο πεδίο.
    [invite, setInvite] = useState<string | null>(null),
    [blockedVersion, setBlockedVersion] = useState(0),
    [toast, setToast] = useState("");
  const contactInput = useRef<HTMLInputElement>(null),
    loading = useRef(false),
    loadAgain = useRef(false),
    activeIdRef = useRef<string | null>(null),
    pendingOpen = useRef<string | null>(null),
    // Διαβάζεται ΜΙΑ φορά (το useRef θα το ξανάτρεχε σε κάθε render).
    [callFromUrl] = useState(() => takeCallFromUrl()),
    pendingCall = useRef(callFromUrl),
    lastSeenMessages = useRef<Map<string, string> | null>(null);

  activeIdRef.current = activeId;

  const notify = useCallback((message: string) => setToast(message), []);

  // Ο χρήστης που μόλις μάθαμε (σύνδεση, επαναφορά, έλεγχος). Το
  // onAuthStateChange πυροδοτείται και σε TOKEN_REFRESHED και όταν η καρτέλα
  // ξαναπαίρνει focus: ίδιος χρήστης = ίδιο αντικείμενο, αλλιώς θα ξαναστηνόταν
  // από την αρχή η σύνδεση realtime.
  const accept = useCallback((user: User) => {
    if (user.suspended) {
      setSuspended(user);
      setMe(null);
      return;
    }
    setSuspended(null);
    setMe((prev) => (prev?.id === user.id ? prev : user));
  }, []);

  // Η βάση αρνήθηκε κάτι γιατί ο λογαριασμός μπήκε σε αναστολή (δες
  // checkAccountOn στο data.ts): ξανακοιτάμε το προφίλ, και αν ισχύει, κλείνει
  // ό,τι τρέχει και φαίνεται η οθόνη αναστολής.
  useEffect(() => {
    let checking = false;
    const onCheck = () => {
      if (checking || !supabase) return;
      checking = true;
      backend
        .getMe()
        .then((user) => user.suspended && accept(user))
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    };
    window.addEventListener("mila:account-check", onCheck);
    return () => window.removeEventListener("mila:account-check", onCheck);
  }, [accept]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Ένα γεγονός στη βάση (π.χ. «διάβασα 30 μηνύματα») φτάνει εδώ ως 30 events.
  // Όσο τρέχει ένα φόρτωμα, τα υπόλοιπα μαζεύονται σε ΕΝΑ ακόμα στο τέλος.
  const loadChats = useCallback(async () => {
    if (loading.current) {
      loadAgain.current = true;
      return;
    }
    loading.current = true;
    try {
      do {
        loadAgain.current = false;
        const fresh = await backend.listChats();
        setChats(fresh);
        calls.setChats(fresh);
        setCallsVersion((v) => v + 1);
        // Ήχος για νέο μήνυμα σε ΑΛΛΗ συνομιλία από αυτή που κοιτάζω (όχι σε σίγαση).
        const previous = lastSeenMessages.current;
        const now = new Map(fresh.map((c) => [c.id, c.last?.id || ""]));
        if (previous)
          for (const c of fresh) {
            const last = c.last;
            if (
              last &&
              previous.get(c.id) !== last.id &&
              last.senderId !== me?.id &&
              !last.deleted &&
              Date.now() - Date.parse(last.createdAt) < 60_000 &&
              !(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now()) &&
              (c.id !== activeIdRef.current || document.visibilityState !== "visible")
            ) {
              messageSound();
              break;
            }
          }
        lastSeenMessages.current = now;
        // Όποιος δεν είχε κλειδί όταν του έγραψα και τώρα έχει, παίρνει τα
        // μηνύματά του. Στο παρασκήνιο, δεν καθυστερεί τη λίστα.
        void backend.deliverPendingKeys();
        // Η ανοιχτή συνομιλία δεν υπάρχει πια για μένα (με έβγαλαν από ομάδα,
        // απέρριψα το request): κλείνει.
        const open = activeIdRef.current;
        const found = Boolean(open && fresh.some((c) => c.id === open));
        if (open && found && pendingOpen.current === open) {
          pendingOpen.current = null;
          setFallbackChat(null);
        }
        // Εξαίρεση: συνομιλία που ΜΟΛΙΣ έφτιαξα. Ένα φόρτωμα που είχε ξεκινήσει
        // πριν τη δημιουργία της δεν την περιέχει, και δεν πρέπει να την κλείσει.
        if (open && !found && pendingOpen.current !== open) setActiveId(null);
      } while (loadAgain.current);
    } catch (caught) {
      notify(messageOf(caught));
    } finally {
      loading.current = false;
    }
    // Το me χρειάζεται μόνο για το «δικό μου μήνυμα δεν κάνει ήχο».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, me?.id]);

  // Επαναφορά συνεδρίας στο άνοιγμα.
  useEffect(() => {
    let alive = true;
    async function restoreSession() {
      if (!supabase) return;
      if (
        isPasswordRecoveryLink() ||
        sessionStorage.getItem("mila:password-recovery") === "1"
      ) {
        setRecoveringPassword(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      try {
        const user = await backend.getMe();
        if (alive) accept(user);
      } catch (error) {
        console.warn("Could not restore session:", error);
        // Μόνο αυτή η συσκευή: οι άλλες συνεδρίες του χρήστη δεν φταίνε.
        await supabase.auth.signOut({ scope: "local" });
      }
    }
    void restoreSession().finally(() => {
      if (alive) setSessionChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let alive = true;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (!session) return;
      if (event === "PASSWORD_RECOVERY") {
        sessionStorage.setItem("mila:password-recovery", "1");
        setRecoveringPassword(true);
        setMe(null);
        return;
      }
      // Το callback δεν επιτρέπεται να καλέσει το Supabase απευθείας (κλειδώνει)·
      // γι' αυτό το setTimeout.
      window.setTimeout(async () => {
        try {
          if (event === "SIGNED_IN") await backend.ensureProfile();
          const user = await backend.getMe();
          if (alive) accept(user);
        } catch (error) {
          console.warn("Could not complete sign in:", error);
        }
      }, 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Λίστα συνομιλιών + ζωντανή ενημέρωση, όσο υπάρχει συνδεδεμένος χρήστης.
  useEffect(() => {
    if (!me) return;
    // Τα κλειδιά κρυπτογράφησης αυτής της συσκευής: φτιάχνονται (την πρώτη
    // φορά) και δηλώνονται πριν φορτώσει η λίστα, που θέλει να τα χρησιμοποιήσει.
    backend
      .ensureDevice()
      .catch((caught) => notify(messageOf(caught)))
      .finally(() => void loadChats());
    void refreshPushOwner();
    const channel = backend.subscribeToChanges(() => void loadChats());
    // Μετά από ώρα στο παρασκήνιο το realtime μπορεί να έχει χάσει γεγονότα.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadChats();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      backend.unsubscribe(channel);
    };
  }, [me?.id, loadChats]);

  // Κλήσεις: όσο υπάρχει συνδεδεμένος χρήστης, το app «ακούει» για
  // εισερχόμενες. Αν άνοιξε από ειδοποίηση κλήσης, κάνει ό,τι ζητήθηκε.
  useEffect(() => {
    if (!me) return;
    const stop = calls.startCalls(me);
    const fromUrl = pendingCall.current;
    pendingCall.current = null;
    if (fromUrl)
      void backend
        .ensureDevice()
        .catch(() => undefined)
        .then(() => calls.fromNotification(fromUrl.id, fromUrl.action))
        .then((call) => {
          if (call && fromUrl.action === "show") {
            setMode("chat");
            setActiveId(call.conversationId);
          }
        })
        .catch((caught) => notify(messageOf(caught)));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // «Σε σύνδεση»: κάθε 30'' όσο το app είναι μπροστά, «έφυγα» όταν κρύβεται.
  useEffect(() => {
    if (!me) return;
    const beat = () => {
      if (document.visibilityState === "visible") void backend.touchPresence(true);
    };
    beat();
    const timer = window.setInterval(beat, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
      else void backend.touchPresence(false);
    };
    const onHide = () => void backend.touchPresence(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [me?.id]);

  useEffect(() => {
    unlockAudio();
    const onSeen = () => setMissedSeen((v) => v + 1);
    window.addEventListener("mila:calls-seen", onSeen);
    return () => window.removeEventListener("mila:calls-seen", onSeen);
  }, []);

  // Αδιάβαστα στον τίτλο της καρτέλας και στο εικονίδιο του εγκατεστημένου app.
  useEffect(() => {
    const unread = chats
      .filter((c) => !(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now()))
      .reduce((n, c) => n + (c.unread || 0), 0);
    document.title = unread ? `(${unread}) Mila` : "Mila";
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (unread) void nav.setAppBadge?.(unread)?.catch(() => undefined);
      else void nav.clearAppBadge?.()?.catch(() => undefined);
    } catch {
      // Δεν το υποστηρίζουν όλα τα συστήματα.
    }
  }, [chats]);

  // Πάτημα σε ειδοποίηση ενώ το app είναι ήδη ανοιχτό: ο service worker
  // στέλνει εδώ ποια συνομιλία να ανοίξει (ή τι να κάνει με μια κλήση).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "open-conversation" && event.data.id) {
        setMode("chat");
        setActiveId(String(event.data.id));
      }
      if (event.data?.type === "call-action" && event.data.callId) {
        const action = ["answer", "decline", "show"].includes(event.data.action)
          ? event.data.action
          : "show";
        void calls
          .fromNotification(String(event.data.callId), action)
          .then((call) => {
            if (call && action === "show") {
              setMode("chat");
              setActiveId(call.conversationId);
            }
          })
          .catch((caught) => notify(messageOf(caught)));
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [notify]);

  // Αναζήτηση ανθρώπων (καρτέλα «Βρες άτομα»).
  useEffect(() => {
    if (mode !== "search" || imported) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    // Αναζήτηση με ολόκληρο email μετράει στο όριο του server· περιμένουμε να
    // σταματήσει να γράφει, για να μη μετρήσει κάθε γράμμα του «.com».
    const timer = setTimeout(
      () => {
        backend
          .searchUsers(term)
          .then(setResults)
          .catch((caught) => {
            setResults([]);
            notify(messageOf(caught));
          });
      },
      backend.looksLikeEmail(term) ? 700 : 250,
    );
    return () => clearTimeout(timer);
  }, [query, mode, imported, notify]);

  // Αναζήτηση μέσα στα μηνύματα (καρτέλα «Μηνύματα»).
  useEffect(() => {
    const term = query.trim();
    if (mode !== "chat" || term.length < 2) {
      setMessageHits([]);
      return;
    }
    const timer = setTimeout(() => {
      backend
        .searchMessages(term)
        .then(setMessageHits)
        .catch(() => setMessageHits([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, mode]);

  const active = useMemo(
    () =>
      activeId
        ? chats.find((c) => c.id === activeId) ||
          (fallbackChat?.id === activeId ? fallbackChat : null)
        : null,
    [activeId, chats, fallbackChat],
  );

  // Ποιους μπορώ να βάλω σε ομάδα: αποδεκτές ατομικές συνομιλίες, όχι
  // διαγραμμένους, όχι μπλοκαρισμένους. Η βάση ελέγχει ξανά το ίδιο.
  const contacts = useMemo(
    () =>
      chats
        .filter(
          (c) =>
            c.type === "direct" &&
            c.requestStatus === "accepted" &&
            !c.blockedByMe &&
            c.others[0] &&
            !c.others[0].deleted,
        )
        .map((c) => c.others[0] as User)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [chats],
  );

  async function openUser(u: User) {
    try {
      const id = await backend.startChat(u.id);
      pendingOpen.current = id;
      setFallbackChat({
        id,
        type: "direct",
        others: [u],
        unread: 0,
        requestFrom: me?.id,
        requestStatus: "pending",
        createdAt: new Date().toISOString(),
      });
      setActiveId(id);
      setMode("chat");
      setQuery("");
      await loadChats();
    } catch (caught) {
      notify(messageOf(caught));
    }
  }

  async function importContacts(file?: File) {
    if (!file) return;
    try {
      const content = await file.text();
      const emails = [
        ...new Set(
          (content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(
            (email) => email.toLowerCase(),
          ),
        ),
      ].slice(0, 500);
      const hashes = await Promise.all(
        emails.map(async (email) => {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(email),
          );
          return [...new Uint8Array(digest)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        }),
      );
      setResults(await backend.matchContacts(hashes));
      setImported(true);
      setQuery("");
      setMode("search");
    } catch (caught) {
      notify(messageOf(caught));
    } finally {
      if (contactInput.current) contactInput.current.value = "";
    }
  }

  async function signOut() {
    // Η συσκευή σταματά να παίρνει ειδοποιήσεις για αυτόν τον λογαριασμό.
    // Με όριο χρόνου: η αποσύνδεση δεν περιμένει ένα αργό δίκτυο.
    await Promise.race([
      disablePush().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    // Μόνο από αυτή τη συσκευή, όπως στο WhatsApp. Το «παντού» (προεπιλογή του
    // Supabase) έβγαζε και το κινητό όταν έκανες αποσύνδεση στον υπολογιστή.
    await supabase?.auth.signOut({ scope: "local" });
    location.reload();
  }

  if (!me) {
    if (suspended?.suspended)
      return (
        <SuspendedScreen
          suspension={suspended.suspended}
          email={suspended.email || ""}
          signOut={() => void signOut()}
        />
      );
    if (!sessionChecked && !recoveringPassword) return null;
    if (entry === "landing" && !recoveringPassword)
      return <Landing start={setEntry} />;
    return (
      <Login
        // Νέο key = νέα φόρμα στη σωστή κατάσταση (εγγραφή ή σύνδεση).
        key={entry}
        done={accept}
        recoveringPassword={recoveringPassword}
        recoveryDone={() => setRecoveringPassword(false)}
        initialMode={entry === "signup" ? "signup" : "signin"}
        onBack={wantsLanding() ? () => setEntry("landing") : undefined}
      />
    );
  }

  const term = query.trim().toLowerCase();
  const muted = (c: Chat) => Boolean(c.mutedUntil && Date.parse(c.mutedUntil) > Date.now());
  // Καρφιτσωμένες πρώτα, μετά η πιο πρόσφατη δραστηριότητα (μήνυμα ή κλήση).
  const ordered = [...chats].sort((a, b) => {
    const pin = (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0);
    if (pin) return pin;
    if (a.pinnedAt && b.pinnedAt) return Date.parse(b.pinnedAt) - Date.parse(a.pinnedAt);
    return activityOf(b) - activityOf(a);
  });
  const archivedChats = ordered.filter((c) => c.archived);
  const visibleChats = ordered.filter(
    (c) =>
      (term ? true : showArchived ? c.archived : !c.archived) &&
      (!term || chatTitle(c).toLowerCase().includes(term)),
  );
  const archivedUnread = archivedChats.reduce((n, c) => n + (c.unread ? 1 : 0), 0);
  void missedSeen;
  const missedBadge = unseenMissed(chats, me.id);

  function chatSubtitle(c: Chat): React.ReactNode {
    if (c.requestStatus === "pending")
      return c.requestFrom === me!.id
        ? t("list.requestSent")
        : t("list.request");
    // Η τελευταία κλήση, αν είναι πιο πρόσφατη από το τελευταίο μήνυμα.
    const lastCall = c.lastCall;
    if (lastCall && (!c.last || Date.parse(lastCall.createdAt) >= Date.parse(c.last.createdAt))) {
      const summary = describeCall(lastCall, me!.id);
      return (
        <span className={`list-call ${summary.missed ? "call-icon-missed" : ""}`}>
          <CallIcon summary={summary} size={13} /> {summary.label}
        </span>
      );
    }
    if (!c.last) return t("list.start");
    const text = messageSnippet(c.last);
    if (c.last.deleted) return text;
    if (c.last.senderId === me!.id) return `${t("chat.you")}: ${text}`;
    if (c.type === "group") {
      const sender =
        c.others.find((u) => u.id === c.last!.senderId)?.name ||
        c.last.senderName ||
        "";
      return sender ? `${sender.split(" ")[0]}: ${text}` : text;
    }
    return text;
  }

  function placeCall(chat: Chat, video: boolean) {
    calls.placeCall(chat, video).catch((caught) => notify(messageOf(caught)));
  }

  const sidebarTitle =
    mode === "search"
      ? t("nav.find")
      : mode === "settings"
        ? t("nav.settings")
        : mode === "calls"
          ? t("nav.calls")
          : showArchived
            ? t("list.archivedTitle")
            : t("nav.chats");

  return (
    <div className="shell">
      <nav>
        <div className="brandmark small">
          <MessageCircle />
        </div>
        <button
          className={mode === "chat" ? "on" : ""}
          onClick={() => setMode("chat")}
          title={t("nav.chats")}
          aria-label={t("nav.chats")}
        >
          <MessageCircle />
        </button>
        <button
          className={`nav-calls ${mode === "calls" ? "on" : ""}`}
          onClick={() => setMode("calls")}
          title={t("nav.calls")}
          aria-label={t("nav.calls")}
        >
          <Phone />
          {missedBadge > 0 && mode !== "calls" && <em>{missedBadge}</em>}
        </button>
        <button
          className={mode === "search" ? "on" : ""}
          onClick={() => setMode("search")}
          title={t("nav.find")}
          aria-label={t("nav.find")}
        >
          <UserPlus />
        </button>
        <button
          className={mode === "settings" ? "on" : ""}
          onClick={() => setMode("settings")}
          title={t("nav.settings")}
          aria-label={t("nav.settings")}
        >
          <Settings />
        </button>
        <span />
        <img src={me.avatar} alt="" />
        <button
          onClick={() => void signOut()}
          title={t("nav.signOut")}
          aria-label={t("nav.signOut")}
        >
          <LogOut />
        </button>
      </nav>

      <aside className={`sidebar ${active ? "mobile-hide" : ""}`}>
        <header>
          <div className="sidebar-title">
            {mode === "chat" && showArchived && (
              <button
                className="icon"
                onClick={() => setShowArchived(false)}
                aria-label={t("common.back")}
              >
                <ArrowLeft />
              </button>
            )}
            <div>
              <small>MILA</small>
              <h2>{sidebarTitle}</h2>
            </div>
          </div>
          {mode === "chat" && !showArchived && (
            <div className="header-actions">
              <button
                className="icon"
                onClick={() => setInvite("")}
                title={t("invite.title")}
                aria-label={t("invite.title")}
              >
                <Share2 />
              </button>
              <button
                className="icon"
                onClick={() => setNewGroup(true)}
                title={t("group.new")}
                aria-label={t("group.new")}
              >
                <Users />
              </button>
              <button
                className="icon"
                onClick={() => setMode("search")}
                title={t("nav.find")}
                aria-label={t("nav.find")}
              >
                <UserPlus />
              </button>
            </div>
          )}
        </header>

        {(mode === "chat" || mode === "search") && (
          <div className="search">
            <Search />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setImported(false);
              }}
              placeholder={
                mode === "search"
                  ? t("people.searchPlaceholder")
                  : t("list.searchPlaceholder")
              }
            />
            {query && <X onClick={() => setQuery("")} />}
          </div>
        )}

        {mode === "search" && (
          <div className="contact-import">
            <input
              ref={contactInput}
              type="file"
              accept=".csv,.vcf,text/csv,text/vcard"
              hidden
              onChange={(e) => void importContacts(e.target.files?.[0])}
            />
            <button onClick={() => contactInput.current?.click()}>
              <UserRound /> {t("people.import")}
            </button>
            <small>{t("people.importHint")}</small>
          </div>
        )}

        {mode === "search" ? (
          <div className="people">
            {imported && (
              <p className="list-title">
                {t("people.imported", { n: results.length })}
              </p>
            )}
            {results.map((u) => (
              <button key={u.id} onClick={() => void openUser(u)}>
                <img src={u.avatar} alt="" />
                <span>
                  <b>{u.name}</b>
                  <small>
                    {[backend.handleOf(u), u.email || t("people.privateEmail")]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <UserPlus />
              </button>
            ))}
            {!imported && term.length < 2 && (
              <Empty
                icon={<Search />}
                title={t("people.emptyTitle")}
                text={t("people.emptyText")}
              />
            )}
            {!imported &&
              term.length >= 2 &&
              !results.length &&
              (backend.looksLikeEmail(term) ? (
                <Empty
                  icon={<Search />}
                  title={t("people.noneTitle")}
                  text={t("people.noneText")}
                  action={
                    <button className="empty-action" onClick={() => setInvite(term)}>
                      <Share2 size={16} /> {t("invite.notHere")}
                    </button>
                  }
                />
              ) : (
                <Empty
                  icon={<Search />}
                  title={t("people.keepTyping")}
                  text={t("people.keepTypingText")}
                />
              ))}
          </div>
        ) : mode === "settings" ? (
          <SettingsPanel
            me={me}
            saved={setMe}
            signOut={() => void signOut()}
            blockedVersion={blockedVersion}
            onUnblocked={() => void loadChats()}
          />
        ) : mode === "calls" ? (
          <CallsList
            me={me}
            chats={chats}
            version={callsVersion}
            onCall={placeCall}
            onOpenChat={(id) => {
              setMode("chat");
              setActiveId(id);
            }}
          />
        ) : (
          <div className="chatlist">
            {!term && !showArchived && archivedChats.length > 0 && (
              <button className="archived-row" onClick={() => setShowArchived(true)}>
                <div className="avatar archived-icon">
                  <Archive size={20} />
                </div>
                <span>
                  <strong>
                    <span className="title">{t("list.archived")}</span>
                  </strong>
                </span>
                {archivedUnread > 0 ? <em>{archivedUnread}</em> : <small>{archivedChats.length}</small>}
              </button>
            )}
            {visibleChats.map((c) => (
              <button
                className={activeId === c.id ? "active" : ""}
                key={c.id}
                onClick={() => setActiveId(c.id)}
              >
                <div className="avatar">
                  <img src={chatAvatar(c)} alt="" />
                  {c.type === "direct" && c.others[0]?.presence?.online && <i />}
                </div>
                <span>
                  <strong>
                    <span className="title">{chatTitle(c)}</span>
                    <time>{activityOf(c) > Date.parse(c.createdAt) && listTime(new Date(activityOf(c)).toISOString())}</time>
                  </strong>
                  <small className={c.last?.deleted ? "muted-italic" : ""}>
                    {chatSubtitle(c)}
                  </small>
                </span>
                <span className="list-flags">
                  {muted(c) && <BellOff size={14} aria-label={t("chat.muted")} />}
                  {c.pinnedAt && <Pin size={14} aria-label={t("chat.pinned")} />}
                  {c.unread > 0 && <em className={muted(c) ? "quiet" : ""}>{c.unread}</em>}
                </span>
              </button>
            ))}

            {messageHits.length > 0 && (
              <>
                <p className="list-title">{t("list.inMessages")}</p>
                {messageHits.map((hit) => {
                  const chat = chats.find((c) => c.id === hit.conversationId);
                  if (!chat) return null;
                  return (
                    <button
                      key={hit.id}
                      onClick={() => {
                        setActiveId(chat.id);
                        setJumpTo(hit.id);
                      }}
                    >
                      <div className="avatar">
                        <img src={chatAvatar(chat)} alt="" />
                      </div>
                      <span>
                        <strong>
                          <span className="title">{chatTitle(chat)}</span>
                          <time>{listTime(hit.createdAt)}</time>
                        </strong>
                        <small>{messageSnippet(hit)}</small>
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {!chats.length && (
              <Empty
                icon={<MessageCircle />}
                title={t("list.emptyTitle")}
                text={t("list.emptyText")}
                action={
                  <button className="empty-action" onClick={() => setInvite("")}>
                    <Share2 size={16} /> {t("invite.title")}
                  </button>
                }
              />
            )}
            {showArchived && !term && !archivedChats.length && (
              <Empty
                icon={<Archive />}
                title={t("list.archivedEmpty")}
                text={t("list.archivedHint")}
              />
            )}
            {chats.length > 0 &&
              term &&
              !visibleChats.length &&
              !messageHits.length && (
                <Empty
                  icon={<Search />}
                  title={t("list.noneTitle")}
                  text={t("list.noneText")}
                />
              )}
          </div>
        )}
      </aside>

      <section className={`conversation ${!active ? "mobile-hide" : ""}`}>
        {active ? (
          <Conversation
            me={me}
            chat={active}
            chats={chats}
            contacts={contacts}
            jumpTo={jumpTo}
            onJumped={() => setJumpTo(null)}
            onBack={() => setActiveId(null)}
            onChanged={() => void loadChats()}
            onGone={() => {
              setActiveId(null);
              void loadChats();
            }}
            onBlockChanged={() => {
              setBlockedVersion((v) => v + 1);
              void loadChats();
            }}
            notify={notify}
          />
        ) : (
          <Empty
            icon={<MessageCircle />}
            title={t("home.title")}
            text={t("home.text")}
          />
        )}
      </section>

      <CallOverlay me={me} chats={chats} />

      {invite !== null && (
        <InviteDialog me={me} initial={invite} close={() => setInvite(null)} />
      )}

      {newGroup && (
        <NewGroupDialog
          contacts={contacts}
          created={(id) => {
            pendingOpen.current = id;
            setActiveId(id);
            void loadChats();
          }}
          close={() => setNewGroup(false)}
        />
      )}

      {toast && (
        <div className="toast" onClick={() => setToast("")} role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// Χωρίς error boundary, ένα exception στο render ξηλώνει όλο το δέντρο και
// αφήνει λευκή σελίδα χωρίς κανένα ίχνος. Εδώ τουλάχιστον φαίνεται το τι.
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Render crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
        <h2>{t("crash.title")}</h2>
        <p>{t("crash.text")}</p>
        <pre
          style={{
            background: "#faf0f2",
            border: "1px solid #e7c3cc",
            borderRadius: 12,
            padding: 16,
            whiteSpace: "pre-wrap",
            fontSize: 13,
          }}
        >
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </pre>
        <button onClick={() => location.reload()}>{t("crash.reload")}</button>
      </div>
    );
  }
}

// Πιάνει και ό,τι σκάει εκτός React (realtime callbacks, promises που
// κανείς δεν περιμένει) και δεν θα φαινόταν αλλιώς.
window.addEventListener("unhandledrejection", (e) =>
  console.error("Unhandled promise rejection:", e.reason),
);

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Νέα έκδοση του site: η σελίδα ξαναφορτώνει μόνη της, αλλά ποτέ όσο τρέχει
// ή χτυπάει κλήση (δες registerServiceWorker).
registerServiceWorker({
  busy: () => calls.activeCallId() !== null || calls.snapshot().incoming.length > 0,
  watch: calls.subscribe,
});
void bootstrapNative();
