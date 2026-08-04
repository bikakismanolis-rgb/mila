import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  FileText,
  Flag,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import "./styles.css";
import { hasSupabaseConfig, supabase } from "./supabase";
import type {
  RealtimeChannel,
  User as SupabaseAuthUser,
} from "@supabase/supabase-js";
// Ονομάζεται backend και όχι data, γιατί το `data` χρησιμοποιείται ήδη
// παντού ως destructured μεταβλητή από τις απαντήσεις του Supabase.
import * as backend from "./data";
import type { Chat, Msg, Privacy, User } from "./data";
import { authRedirectUrl, registerServiceWorker } from "./platform";
import { bootstrapNative } from "./native";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  | string
  | undefined;
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              size?: "large" | "medium" | "small";
              text?: "continue_with" | "signin_with" | "signup_with";
              theme?: "outline" | "filled_blue" | "filled_black";
              width?: string | number;
            },
          ) => void;
          prompt: (listener?: (notification: unknown) => void) => void;
        };
      };
    };
  }
}
function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Google Sign-In.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google Sign-In."));
    document.head.appendChild(script);
  });
}

async function ensureSupabaseProfile(
  user: SupabaseAuthUser,
  displayName?: string,
) {
  if (!supabase || !user.email) return;
  const email = user.email.toLowerCase();
  const name =
    displayName?.trim() ||
    (typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : email.split("@")[0]);
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email,
      display_name: name.length >= 2 ? name : email.split("@")[0],
      bio: "",
      discover_by_email: "everyone",
      show_email: "chat",
      read_receipts: true,
      show_online: true,
    },
    { onConflict: "id" },
  );
  if (error) console.warn("Supabase profile sync skipped:", error.message);
}
const time = (d: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));

function SupabaseStatus() {
  const [status, setStatus] = useState("Checking Supabase connection…"),
    [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!hasSupabaseConfig || !supabase) {
      setStatus("Supabase not configured yet");
      return;
    }
    supabase
      .from("profiles")
      .select("id")
      .limit(1)
      .then(({ error }) => {
        if (!alive) return;
        if (error) {
          setStatus(`Supabase check failed: ${error.message}`);
          setOk(false);
          return;
        }
        setStatus("Supabase connected · schema reachable");
        setOk(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return <div className={`supabase-status ${ok ? "ok" : ""}`}>{status}</div>;
}
function Login({ done }: { done: (u: User) => void }) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [authMode, setAuthMode] = useState<"signin" | "signup">("signin"),
    [password, setPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const googleButtonRef = useRef<HTMLDivElement>(null);
  async function request() {
    try {
      setError("");
      setNotice("");
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) throw new Error("Enter a valid email.");

      if (supabase) {
        if (password.length < 6)
          throw new Error("Password must be at least 6 characters.");

        if (authMode === "signin") {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          });
          if (error) throw error;
          if (!data.session)
            throw new Error("Supabase did not return a signed-in session.");
          done(await backend.getMe());
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { display_name: name || undefined },
            emailRedirectTo: authRedirectUrl,
          },
        });
        if (error) throw error;
        if (data.session) {
          if (data.user)
            await ensureSupabaseProfile(data.user, name || undefined);
          done(await backend.getMe());
          return;
        }
        setNotice(
          "Account created. Check your email to confirm your account, then sign in here with your password.",
        );
        setAuthMode("signin");
        setPassword("");
        return;
      }

      // Δεν υπάρχει πια εναλλακτική διαδρομή σύνδεσης. Ο παλιός κωδικός
      // 6 ψηφίων τυπωνόταν στο response του Express — έφυγε μαζί του.
      throw new Error("Supabase is not configured. Check your environment.");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function finishGoogleSignIn(credential?: string) {
    try {
      setError("");
      setNotice("");
      if (!supabase) throw new Error("Supabase is not configured yet.");
      if (!credential) throw new Error("Google did not return an ID token.");
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credential,
      });
      if (error) throw error;
      if (!data.session)
        throw new Error("Supabase did not return a signed-in session.");
      if (data.user) await ensureSupabaseProfile(data.user);
      done(await backend.getMe());
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    if (!supabase || !GOOGLE_CLIENT_ID || !googleButtonRef.current) return;
    let cancelled = false;
    loadGoogleIdentityScript()
      .then(() => {
        if (cancelled || !googleButtonRef.current) return;
        googleButtonRef.current.innerHTML = "";
        window.google!.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => void finishGoogleSignIn(response.credential),
        });
        window.google!.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          width: 360,
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <main className="login">
      <section className="login-card">
        <div className="brandmark">
          <MessageCircle />
        </div>
        <h1>
          Talk freely.
          <br />
          Keep your number private.
        </h1>
        <p className="lede">
          A familiar messenger, built around your email — not your phone number.
        </p>
        <>
            <label>
              Email address
              <input
                autoFocus
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            {supabase && (
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    authMode === "signin"
                      ? "Your password"
                      : "At least 6 characters"
                  }
                />
              </label>
            )}
            {authMode === "signup" && (
              <label>
                Display name <span>(new accounts)</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="How people know you"
                />
              </label>
            )}
            <button onClick={request}>
              {authMode === "signin" ? "Sign in" : "Create account"}
            </button>
            <div className="auth-choice">
              {authMode === "signin" ? (
                <>
                  <span>New here?</span>
                  <button type="button" onClick={() => setAuthMode("signup")}>
                    Create account
                  </button>
                </>
              ) : (
                <>
                  <span>Already have an account?</span>
                  <button type="button" onClick={() => setAuthMode("signin")}>
                    Sign in
                  </button>
                </>
              )}
            </div>
            {supabase && (
              <>
                <div className="auth-divider">
                  <span>or</span>
                </div>
                <div className="google-button" ref={googleButtonRef} />
                {!GOOGLE_CLIENT_ID && (
                  <p className="error">Google Client ID is missing.</p>
                )}
              </>
            )}
        </>
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <div className="trust">
          <ShieldCheck /> Email verified · No phone required
        </div>
        <SupabaseStatus />
      </section>
      <aside>
        <div className="orb"></div>
        <h2>Your conversations belong in a messenger, not an inbox.</h2>
        <p>Realtime chat, requests and privacy controls in one calm place.</p>
      </aside>
    </main>
  );
}

function App() {
  const [me, setMe] = useState<User | null>(null),
    [chats, setChats] = useState<Chat[]>([]),
    [active, setActive] = useState<Chat | null>(null),
    [messages, setMessages] = useState<Msg[]>([]),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<User[]>([]),
    [mode, setMode] = useState<"chat" | "search" | "settings">("chat"),
    [text, setText] = useState(""),
    [typing, setTyping] = useState(false),
    [menuOpen, setMenuOpen] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const typingChannel = useRef<RealtimeChannel | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    contactInput = useRef<HTMLInputElement>(null);
  const loadChats = () =>
    backend
      .listChats()
      .then(setChats)
      .catch((e) => setError(e.message));
  useEffect(() => {
    let alive = true;
    async function restoreSession() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      try {
        const user = await backend.getMe();
        if (alive) setMe(user);
      } catch (error) {
        console.warn("Could not restore Supabase session:", error);
        await supabase.auth.signOut();
      }
    }
    restoreSession();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let alive = true;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!session) return;
      window.setTimeout(async () => {
        try {
          const { data: userData } = await client.auth.getUser();
          if (userData.user) await ensureSupabaseProfile(userData.user);
          const user = await backend.getMe();
          // Το onAuthStateChange πυροδοτείται και σε TOKEN_REFRESHED και όταν
          // η καρτέλα ξαναπαίρνει focus. Χωρίς αυτόν τον έλεγχο, κάθε φορά
          // έμπαινε νέο αντικείμενο στο state, άλλαζε η ταυτότητα του `me`
          // και ξαναστηνόταν από την αρχή η σύνδεση realtime.
          if (alive) setMe((prev) => (prev?.id === user.id ? prev : user));
        } catch (error) {
          console.warn("Could not complete magic-link sign in:", error);
        }
      }, 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  // Το subscribeToChanges δεν πρέπει να ξαναστήνεται σε κάθε αλλαγή
  // συνομιλίας, οπότε το ενεργό id περνάει από ref.
  const activeId = useRef<string | null>(null);
  useEffect(() => {
    if (!me) return;
    loadChats();
    // Το RLS φιλτράρει ήδη τι φτάνει εδώ, οπότε ξαναφορτώνουμε αντί να
    // μπαλώνουμε το state από το payload του event.
    const channel = backend.subscribeToChanges({
      onMessage: () => {
        loadChats();
        if (activeId.current)
          backend.listMessages(activeId.current).then(setMessages).catch(() => {});
      },
      onConversation: loadChats,
    });
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [me?.id]);
  useEffect(() => {
    activeId.current = active?.id || null;
    if (typingChannel.current) void supabase?.removeChannel(typingChannel.current);
    typingChannel.current = null;
    setTyping(false);
    if (!active) return;
    backend.listMessages(active.id).then(setMessages).catch(() => {});
    backend.markRead(active.id).then(loadChats);
    typingChannel.current = backend.subscribeToTyping(active.id, (on) =>
      setTyping(on),
    );
    return () => {
      if (typingChannel.current)
        void supabase?.removeChannel(typingChannel.current);
      typingChannel.current = null;
    };
  }, [active?.id]);
  useEffect(
    () => bottom.current?.scrollIntoView({ behavior: "smooth" }),
    [messages, typing],
  );
  useEffect(() => {
    const t = setTimeout(() => {
      if (
        mode === "search" &&
        query.length > 1 &&
        query !== "Imported contacts"
      )
        backend
          .searchUsers(query)
          .then(setResults)
          .catch(() => setResults([]));
      else if (query !== "Imported contacts") setResults([]);
    }, 250);
    return () => clearTimeout(t);
  }, [query, mode]);
  async function openUser(u: User) {
    try {
      const id = await backend.startChat(u.id);
      const fresh = await backend.listChats();
      setChats(fresh);
      setActive(
        fresh.find((c) => c.id === id) || {
          id,
          type: "direct",
          others: [u],
          unread: 0,
          requestStatus: "pending",
          createdAt: new Date().toISOString(),
        },
      );
      setMode("chat");
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function send() {
    if (!text.trim() || !active) return;
    const body = text.trim();
    setText("");
    try {
      await backend.sendMessage(active.id, body);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function sendAttachment(file?: File) {
    if (!file || !active) return;
    setUploading(true);
    try {
      const attachment = await backend.uploadAttachment(file, active.id);
      await backend.sendMessage(active.id, "", attachment);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
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
      setMode("search");
      setQuery("Imported contacts");
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (contactInput.current) contactInput.current.value = "";
    }
  }
  async function blockUser() {
    if (!other || !confirm(`Block ${other.name}?`)) return;
    try {
      await backend.blockUser(other.id);
      setMenuOpen(false);
      setActive(null);
      loadChats();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function reportUser() {
    if (!other) return;
    const reason = prompt("Briefly describe the problem:");
    if (!reason) return;
    try {
      await backend.reportUser(other.id, reason);
      setMenuOpen(false);
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function decide(decision: "accepted" | "rejected") {
    if (!active) return;
    try {
      await backend.respondToRequest(active.id, decision === "accepted");
      setActive({ ...active, requestStatus: decision });
      loadChats();
    } catch (e: any) {
      setError(e.message);
    }
  }
  if (!me) return <Login done={setMe} />;
  const other = active?.others?.[0];
  return (
    <div className="shell">
      <nav>
        <div className="brandmark small">
          <MessageCircle />
        </div>
        <button
          className={mode === "chat" ? "on" : ""}
          onClick={() => setMode("chat")}
          title="Chats"
        >
          <MessageCircle />
        </button>
        <button
          className={mode === "search" ? "on" : ""}
          onClick={() => setMode("search")}
          title="Find people"
        >
          <UserPlus />
        </button>
        <button
          className={mode === "settings" ? "on" : ""}
          onClick={() => setMode("settings")}
          title="Settings"
        >
          <Settings />
        </button>
        <span />
        <img src={me.avatar} />
        <button
          onClick={async () => {
            await supabase?.auth.signOut();
            location.reload();
          }}
          title="Sign out"
        >
          <LogOut />
        </button>
      </nav>
      <aside className={`sidebar ${active ? "mobile-hide" : ""}`}>
        <header>
          <div>
            <small>EMAIL MESSENGER</small>
            <h2>
              {mode === "search"
                ? "Find people"
                : mode === "settings"
                  ? "Settings"
                  : "Messages"}
            </h2>
          </div>
          {mode === "chat" && (
            <button className="icon" onClick={() => setMode("search")}>
              <UserPlus />
            </button>
          )}
        </header>
        {mode !== "settings" && (
          <div className="search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === "search"
                  ? "Email, username or name"
                  : "Search conversations"
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
              onChange={(e) => importContacts(e.target.files?.[0])}
            />
            <button onClick={() => contactInput.current?.click()}>
              <UserRound /> Import email contacts
            </button>
            <small>
              Matching uses SHA-256 email hashes, not the full address book.
            </small>
          </div>
        )}
        {mode === "search" ? (
          <div className="people">
            {results.map((u) => (
              <button key={u.id} onClick={() => openUser(u)}>
                <img src={u.avatar} />
                <span>
                  <b>{u.name}</b>
                  <small>
                    @{u.username} · {u.email || "private email"}
                  </small>
                </span>
                <UserPlus />
              </button>
            ))}
            {query.length < 2 && !results.length && (
              <Empty
                icon={<Search />}
                title="Find someone"
                text="Search by email address, username or name."
              />
            )}
          </div>
        ) : mode === "settings" ? (
          <SettingsPanel me={me} saved={setMe} />
        ) : (
          <div className="chatlist">
            {chats
              .filter(
                (c) =>
                  !query ||
                  c.others[0]?.name.toLowerCase().includes(query.toLowerCase()),
              )
              .map((c) => {
                const u = c.others[0];
                return (
                  <button
                    className={active?.id === c.id ? "active" : ""}
                    key={c.id}
                    onClick={() => setActive(c)}
                  >
                    <div className="avatar">
                      <img src={u?.avatar} />
                      {u?.privacy.online && <i />}
                    </div>
                    <span>
                      <strong>
                        {u?.name || "Group"}
                        <time>{c.last && time(c.last.createdAt)}</time>
                      </strong>
                      <small>
                        {c.requestStatus === "pending"
                          ? "Message request"
                          : c.last?.body || "Start the conversation"}
                      </small>
                    </span>
                    {c.unread > 0 && <em>{c.unread}</em>}
                  </button>
                );
              })}
            {!chats.length && (
              <Empty
                icon={<MessageCircle />}
                title="No conversations yet"
                text="Find someone by email and say hello."
              />
            )}
          </div>
        )}
      </aside>
      <section className={`conversation ${!active ? "mobile-hide" : ""}`}>
        {active && other ? (
          <>
            <header>
              <button className="icon back" onClick={() => setActive(null)}>
                <ArrowLeft />
              </button>
              <img src={other.avatar} />
              <div>
                <b>{other.name}</b>
                <small>{typing ? "typing…" : `@${other.username}`}</small>
              </div>
              <span />
              <span title="Encryption architecture ready">
                <LockKeyhole />
              </span>
              <div className="conversation-menu">
                <button
                  className="icon"
                  aria-label="Conversation options"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <MoreVertical />
                </button>
                {menuOpen && (
                  <div className="menu-popover">
                    <button
                      onClick={() =>
                        alert(`${other.name}\n@${other.username}\n${other.bio}`)
                      }
                    >
                      <UserRound /> Contact details
                    </button>
                    <button onClick={blockUser}>
                      <Ban /> Block user
                    </button>
                    <button className="danger" onClick={reportUser}>
                      <Flag /> Report user
                    </button>
                  </div>
                )}
              </div>
            </header>
            <div className="messages">
              {active.requestStatus === "pending" &&
                active.requestFrom !== me.id && (
                  <div className="request">
                    <ShieldCheck />
                    <h3>{other.name} wants to chat</h3>
                    <p>
                      Accept to move this conversation into your regular inbox.
                    </p>
                    <div>
                      <button
                        className="secondary"
                        onClick={() => decide("rejected")}
                      >
                        Decline
                      </button>
                      <button onClick={() => decide("accepted")}>Accept</button>
                    </div>
                  </div>
                )}
              <div className="day">Today</div>
              {messages.map((m) => (
                <Bubble key={m.id} m={m} own={m.senderId === me.id} />
              ))}
              {typing && (
                <div className="bubble typing">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              <div ref={bottom} />
            </div>
            {active.requestStatus !== "rejected" && (
              <footer>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept="image/*,.pdf,.txt,.zip,.docx,.xlsx"
                  onChange={(e) => sendAttachment(e.target.files?.[0])}
                />
                <button
                  className="plus"
                  title="Send photo or file"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip />
                </button>
                <textarea
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    void backend.sendTyping(
                      typingChannel.current,
                      !!e.target.value,
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={uploading ? "Uploading…" : "Write a message"}
                />
                <button className="send" disabled={!text.trim()} onClick={send}>
                  <Send />
                </button>
              </footer>
            )}
          </>
        ) : (
          <Empty
            icon={<MessageCircle />}
            title="Your messages, in one place"
            text="Choose a conversation or find someone using their email."
          />
        )}
      </section>
      {error && (
        <div className="toast" onClick={() => setError("")}>
          {error}
        </div>
      )}
    </div>
  );
}
function Bubble({ m, own }: { m: Msg; own: boolean }) {
  // Το url είναι πλέον βραχύβιο signed URL από το Supabase Storage,
  // φτιαγμένο στο data.ts — δεν χρειάζεται token εδώ.
  const mediaUrl = m.attachment?.url || "";
  return (
    <div className={`bubble ${own ? "own" : ""}`}>
      {m.encrypted && <LockKeyhole size={12} />}
      {m.attachment?.mime.startsWith("image/") ? (
        <a href={mediaUrl} target="_blank" rel="noreferrer">
          <img
            className="message-image"
            src={mediaUrl}
            alt={m.attachment.name}
          />
        </a>
      ) : m.attachment ? (
        <a
          className="file-card"
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
        >
          <FileText />
          <span>
            <b>{m.attachment.name}</b>
            <small>{(m.attachment.size / 1024).toFixed(1)} KB</small>
          </span>
        </a>
      ) : null}
      {m.body && <p>{m.encrypted ? "π”’ Encrypted message" : m.body}</p>}
      <small>
        {time(m.createdAt)}{" "}
        {own && (m.readBy.length > 1 ? <CheckCheck /> : <Check />)}
      </small>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function SettingsPanel({ me, saved }: { me: User; saved: (u: User) => void }) {
  const [name, setName] = useState(me.name),
    [bio, setBio] = useState(me.bio),
    [privacy, setPrivacy] = useState(me.privacy);
  async function save() {
    saved(await backend.updateMe({ name, bio, privacy }));
  }
  return (
    <div className="settings">
      <div className="profile">
        <img src={me.avatar} />
        <b>{me.name}</b>
        <small>{me.email}</small>
      </div>
      <label>
        Display name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Bio
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>
      <h3>Privacy</h3>
      <label>
        Find me by email
        <select
          value={privacy.discover}
          onChange={(e) =>
            setPrivacy({
              ...privacy,
              discover: e.target.value as Privacy["discover"],
            })
          }
        >
          <option value="everyone">Everyone</option>
          <option value="contacts">Contacts</option>
          <option value="nobody">Nobody</option>
        </select>
      </label>
      <label className="toggle">
        <span>
          Read receipts<small>Let people know when you read messages</small>
        </span>
        <input
          type="checkbox"
          checked={privacy.receipts}
          onChange={(e) =>
            setPrivacy({ ...privacy, receipts: e.target.checked })
          }
        />
      </label>
      <label className="toggle">
        <span>
          Online status<small>Show when you are available</small>
        </span>
        <input
          type="checkbox"
          checked={privacy.online}
          onChange={(e) => setPrivacy({ ...privacy, online: e.target.checked })}
        />
      </label>
      <button onClick={save}>Save changes</button>
      <p className="storage-note">
        <ShieldCheck size={14} /> Messages are stored on our servers and are not
        end-to-end encrypted. Your email is never shared without your say-so,
        and we never ask for a phone number.
      </p>
      <p className="legal">Privacy · Terms · Export data · Delete account</p>
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
        <h2>Something broke while rendering.</h2>
        <p>
          Copy this and send it over — it says exactly what failed and where.
        </p>
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
        <button onClick={() => location.reload()}>Reload</button>
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
