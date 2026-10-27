// Οθόνη σύνδεσης / εγγραφής / ορισμού νέου κωδικού.

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { hasSupabaseConfig, supabase } from "../supabase";
import * as backend from "../data";
import type { User } from "../data";
import {
  authRedirectUrl,
  passwordResetRedirectUrl,
  privacyPolicyUrl,
} from "../platform";
import { lang, setLang, t, translateError } from "../i18n";

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
              locale?: string;
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
    const failed = () => reject(new Error(t("login.googleLoadFailed")));
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", failed, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = failed;
    document.head.appendChild(script);
  });
}

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

/** Φαίνεται ΜΟΝΟ όταν κάτι δεν πάει καλά με τη σύνδεση στη βάση (π.χ. το
 *  project είναι σε παύση). Όταν όλα δουλεύουν, ο χρήστης δεν χρειάζεται να
 *  διαβάζει διαγνωστικά. */
function ConnectionProblem() {
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let alive = true;
    if (!hasSupabaseConfig || !supabase) {
      setProblem(t("err.notConfigured"));
      return;
    }
    supabase
      .from("profiles")
      .select("id")
      .limit(1)
      .then(({ error }) => {
        if (alive && error) setProblem(t("login.serverProblem"));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!problem) return null;
  return <div className="supabase-status">{problem}</div>;
}

function LanguageSwitch() {
  return (
    <div className="lang-switch">
      <button
        type="button"
        className={lang === "el" ? "on" : ""}
        onClick={() => setLang("el")}
      >
        Ελληνικά
      </button>
      <span>·</span>
      <button
        type="button"
        className={lang === "en" ? "on" : ""}
        onClick={() => setLang("en")}
      >
        English
      </button>
    </div>
  );
}

function Pitch() {
  return (
    <aside>
      <div className="orb"></div>
      <h2>{t("login.pitchTitle")}</h2>
      <p>{t("login.pitchText")}</p>
    </aside>
  );
}

export function Login({
  done,
  recoveringPassword,
  recoveryDone,
  initialMode = "signin",
  onBack,
}: {
  done: (u: User) => void;
  recoveringPassword: boolean;
  recoveryDone: () => void;
  initialMode?: "signin" | "signup";
  /** Επιστροφή στην αρχική σελίδα (μόνο όταν ήρθε από εκεί). */
  onBack?: () => void;
}) {
  const [email, setEmail] = useState(""),
    [name, setName] = useState(""),
    [authMode, setAuthMode] = useState<"signin" | "signup">(initialMode),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  // Το script της Google φορτώνει ΜΟΝΟ όταν πατήσεις «Συνέχεια με Google».
  // Πριν, φόρτωνε σε κάθε άνοιγμα της σελίδας εισόδου, άρα η Google μάθαινε
  // την IP όποιου έμπαινε στο Mila, ακόμα κι αν δεν τη χρησιμοποιούσε ποτέ.
  const [google, setGoogle] = useState<"idle" | "loading" | "ready">("idle");

  async function attempt(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const resetPassword = () =>
    attempt(async () => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!supabase) throw new Error(t("err.notConfigured"));
      if (!normalizedEmail) throw new Error(t("login.enterEmailFirst"));
      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: passwordResetRedirectUrl },
      );
      if (error) throw error;
      setNotice(t("login.resetSent"));
    });

  const updateRecoveredPassword = () =>
    attempt(async () => {
      if (!supabase) throw new Error(t("err.notConfigured"));
      if (newPassword.length < backend.MIN_PASSWORD) throw new Error(t("err.passwordShort"));
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      sessionStorage.removeItem("mila:password-recovery");
      window.history.replaceState({}, document.title, "/");
      recoveryDone();
      done(await backend.getMe());
    });

  const submit = () =>
    attempt(async () => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!supabase) throw new Error(t("err.notConfigured"));
      if (!normalizedEmail) throw new Error(t("login.enterValidEmail"));
      // Το όριο ισχύει για νέους κωδικούς. Όποιος έχει ήδη μικρότερο (από πριν
      // ανέβει το όριο) συνδέεται κανονικά.
      if (authMode === "signin" ? !password : password.length < backend.MIN_PASSWORD)
        throw new Error(t(authMode === "signin" ? "err.enterPassword" : "err.passwordShort"));

      if (authMode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        if (!data.session) throw new Error(t("login.noSession"));
        await backend.ensureProfile();
        done(await backend.getMe());
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { display_name: name.trim() || undefined },
          emailRedirectTo: authRedirectUrl,
        },
      });
      if (error) throw error;
      if (data.session) {
        await backend.ensureProfile(name);
        done(await backend.getMe());
        return;
      }
      setNotice(t("login.accountCreated"));
      setAuthMode("signin");
      setPassword("");
    });

  const finishGoogleSignIn = (credential?: string) =>
    attempt(async () => {
      if (!supabase) throw new Error(t("err.notConfigured"));
      if (!credential) throw new Error(t("login.googleNoToken"));
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credential,
      });
      if (error) throw error;
      if (!data.session) throw new Error(t("login.noSession"));
      await backend.ensureProfile();
      done(await backend.getMe());
    });

  async function startGoogle() {
    if (!supabase || !GOOGLE_CLIENT_ID || google !== "idle") return;
    setGoogle("loading");
    setError("");
    try {
      await loadGoogleIdentityScript();
      const target = googleButtonRef.current;
      if (!target) return;
      target.innerHTML = "";
      window.google!.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => void finishGoogleSignIn(response.credential),
      });
      // Το πραγματικό κουμπί της Google. Η σύνδεση γίνεται μόνο από δικό της
      // κουμπί (δικό της iframe), γι' αυτό χρειάζεται ένα δεύτερο πάτημα.
      window.google!.accounts.id.renderButton(target, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: 360,
        locale: lang,
      });
      setGoogle("ready");
    } catch (caught) {
      setGoogle("idle");
      setError(messageOf(caught));
    }
  }

  if (recoveringPassword) {
    return (
      <main className="login">
        <section className="login-card">
          <div className="brandmark">
            <LockKeyhole />
          </div>
          <h1>{t("login.newPasswordTitle")}</h1>
          <p className="lede">{t("login.newPasswordText")}</p>
          <label>
            {t("login.newPassword")}
            <input
              autoFocus
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("login.passwordHint")}
            />
          </label>
          <button onClick={updateRecoveredPassword} disabled={busy}>
            {t("login.updatePassword")}
          </button>
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
        </section>
        <Pitch />
      </main>
    );
  }

  return (
    <main className="login">
      <section className="login-card">
        {onBack && (
          <button type="button" className="login-back" onClick={onBack}>
            <ArrowLeft size={16} /> {t("login.backHome")}
          </button>
        )}
        <div className="brandmark">
          <MessageCircle />
        </div>
        <h1>
          {t("login.titleLine1")}
          <br />
          {t("login.titleLine2")}
        </h1>
        <p className="lede">{t("login.lede")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label>
            {t("login.email")}
            <input
              autoFocus
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            {t("login.password")}
            <input
              type="password"
              autoComplete={
                authMode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                authMode === "signin"
                  ? t("login.yourPassword")
                  : t("login.passwordHint")
              }
            />
          </label>
          {authMode === "signup" && (
            <label>
              {t("login.displayName")} <span>{t("login.displayNameNote")}</span>
              <input
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                placeholder={t("login.displayNameHint")}
              />
            </label>
          )}
          <button type="submit" disabled={busy}>
            {authMode === "signin" ? t("login.signIn") : t("login.createAccount")}
          </button>
        </form>
        {authMode === "signup" && (
          <p className="consent">
            {t("login.consentBefore")}{" "}
            <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
              {t("login.privacyPolicy")}
            </a>
            . {t("login.consentAfter")}
          </p>
        )}
        <div className="auth-choice">
          {authMode === "signin" ? (
            <>
              <span>{t("login.newHere")}</span>
              <button type="button" onClick={() => setAuthMode("signup")}>
                {t("login.createAccount")}
              </button>
              <span>·</span>
              <button type="button" onClick={resetPassword}>
                {t("login.forgot")}
              </button>
            </>
          ) : (
            <>
              <span>{t("login.haveAccount")}</span>
              <button type="button" onClick={() => setAuthMode("signin")}>
                {t("login.signIn")}
              </button>
            </>
          )}
        </div>
        {supabase && GOOGLE_CLIENT_ID && (
          <>
            <div className="auth-divider">
              <span>{t("login.or")}</span>
            </div>
            {google !== "ready" && (
              <button
                type="button"
                className="google-start"
                onClick={() => void startGoogle()}
                disabled={google === "loading"}
              >
                {google === "loading" ? t("common.loading") : t("login.googleContinue")}
              </button>
            )}
            <div className="google-button" ref={googleButtonRef} />
            {google === "ready" && <p className="hint">{t("login.googleHint")}</p>}
          </>
        )}
        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}
        <div className="trust">
          <ShieldCheck /> {t("login.trust")}
        </div>
        <ConnectionProblem />
        <a className="install-link" href="/install">
          {t("login.install")}
        </a>
        <LanguageSwitch />
      </section>
      <Pitch />
    </main>
  );
}
