// Το κέλυφος του app: σύνδεση, πλοήγηση, λίστα συνομιλιών, αναζήτηση.
// Η ανοιχτή συνομιλία είναι στο components/Conversation.tsx, οι ρυθμίσεις στο
// components/Settings.tsx, η είσοδος στο components/Login.tsx.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LogOut,
  MessageCircle,
  Search,
  Settings,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "./styles.css";
import { supabase } from "./supabase";
// Ονομάζεται backend και όχι data, γιατί το `data` χρησιμοποιείται ήδη
// παντού ως destructured μεταβλητή από τις απαντήσεις του Supabase.
import * as backend from "./data";
import type { Chat, Msg, User } from "./data";
import { registerServiceWorker } from "./platform";
import { bootstrapNative } from "./native";
import { t, translateError } from "./i18n";
import { listTime } from "./format";
import { disablePush, refreshPushOwner } from "./push";
import { Empty } from "./components/common";
import { Login } from "./components/Login";
import { SettingsPanel } from "./components/Settings";
import {
  Conversation,
  chatAvatar,
  chatTitle,
  messageSnippet,
} from "./components/Conversation";
import { NewGroupDialog } from "./components/Groups";

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
    [mode, setMode] = useState<"chat" | "search" | "settings">("chat"),
    [newGroup, setNewGroup] = useState(false),
    [blockedVersion, setBlockedVersion] = useState(0),
    [toast, setToast] = useState("");
  const contactInput = useRef<HTMLInputElement>(null),
    loading = useRef(false),
    loadAgain = useRef(false),
    activeIdRef = useRef<string | null>(null),
    pendingOpen = useRef<string | null>(null);

  activeIdRef.current = activeId;

  const notify = useCallback((message: string) => setToast(message), []);
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
  }, [notify]);

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
        if (alive) setMe(user);
      } catch (error) {
        console.warn("Could not restore session:", error);
        await supabase.auth.signOut();
      }
    }
    void restoreSession();
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
          // Το onAuthStateChange πυροδοτείται και σε TOKEN_REFRESHED και όταν
          // η καρτέλα ξαναπαίρνει focus. Χωρίς αυτόν τον έλεγχο, κάθε φορά
          // έμπαινε νέο αντικείμενο στο state, άλλαζε η ταυτότητα του `me`
          // και ξαναστηνόταν από την αρχή η σύνδεση realtime.
          if (alive) setMe((prev) => (prev?.id === user.id ? prev : user));
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
    void loadChats();
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

  // Πάτημα σε ειδοποίηση ενώ το app είναι ήδη ανοιχτό: ο service worker
  // στέλνει εδώ ποια συνομιλία να ανοίξει.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "open-conversation" && event.data.id) {
        setMode("chat");
        setActiveId(String(event.data.id));
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Αναζήτηση ανθρώπων (καρτέλα «Βρες άτομα»).
  useEffect(() => {
    if (mode !== "search" || imported) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      backend
        .searchUsers(term)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, mode, imported]);

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
    await supabase?.auth.signOut();
    location.reload();
  }

  if (!me)
    return (
      <Login
        done={setMe}
        recoveringPassword={recoveringPassword}
        recoveryDone={() => setRecoveringPassword(false)}
      />
    );

  const term = query.trim().toLowerCase();
  const visibleChats = chats.filter(
    (c) => !term || chatTitle(c).toLowerCase().includes(term),
  );

  function chatSubtitle(c: Chat): string {
    if (c.requestStatus === "pending")
      return c.requestFrom === me!.id
        ? t("list.requestSent")
        : t("list.request");
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
          <div>
            <small>MILA</small>
            <h2>
              {mode === "search"
                ? t("nav.find")
                : mode === "settings"
                  ? t("nav.settings")
                  : t("nav.chats")}
            </h2>
          </div>
          {mode === "chat" && (
            <div className="header-actions">
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

        {mode !== "settings" && (
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
            {!imported && term.length >= 2 && !results.length && (
              <Empty
                icon={<Search />}
                title={t("people.noneTitle")}
                text={t("people.noneText")}
              />
            )}
          </div>
        ) : mode === "settings" ? (
          <SettingsPanel
            me={me}
            saved={setMe}
            signOut={() => void signOut()}
            blockedVersion={blockedVersion}
            onUnblocked={() => void loadChats()}
          />
        ) : (
          <div className="chatlist">
            {visibleChats.map((c) => (
              <button
                className={activeId === c.id ? "active" : ""}
                key={c.id}
                onClick={() => setActiveId(c.id)}
              >
                <div className="avatar">
                  <img src={chatAvatar(c)} alt="" />
                </div>
                <span>
                  <strong>
                    <span className="title">{chatTitle(c)}</span>
                    <time>{c.last && listTime(c.last.createdAt)}</time>
                  </strong>
                  <small className={c.last?.deleted ? "muted-italic" : ""}>
                    {chatSubtitle(c)}
                  </small>
                </span>
                {c.unread > 0 && <em>{c.unread}</em>}
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

registerServiceWorker();
void bootstrapNative();
