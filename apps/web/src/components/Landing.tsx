// Η αρχική σελίδα για όποιον δεν έχει μπει ακόμα: τι είναι το Mila, γιατί
// είναι ιδιωτικό, και πώς ξεκινάς. Όσοι ανοίγουν το εγκατεστημένο app (PWA,
// native) δεν τη βλέπουν ποτέ· πάνε κατευθείαν στην είσοδο.

import React from "react";
import {
  EyeOff,
  LockKeyhole,
  Mail,
  MessageCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { lang, setLang, t } from "../i18n";

export function Landing({
  start,
}: {
  start: (mode: "signin" | "signup") => void;
}) {
  const features = [
    { icon: <Mail />, title: t("landing.f1Title"), text: t("landing.f1Text") },
    { icon: <LockKeyhole />, title: t("landing.f2Title"), text: t("landing.f2Text") },
    { icon: <EyeOff />, title: t("landing.f3Title"), text: t("landing.f3Text") },
    { icon: <ShieldCheck />, title: t("landing.f4Title"), text: t("landing.f4Text") },
  ];
  const steps = [t("landing.step1"), t("landing.step2"), t("landing.step3")];

  return (
    <div className="landing">
      <nav className="landing-nav">
        <span className="landing-logo">
          <span className="brandmark small">
            <MessageCircle />
          </span>
          Mila
        </span>
        <span className="landing-nav-actions">
          <button
            type="button"
            className="landing-lang"
            onClick={() => setLang(lang === "el" ? "en" : "el")}
          >
            {lang === "el" ? "English" : "Ελληνικά"}
          </button>
          <button
            type="button"
            className="landing-signin"
            onClick={() => start("signin")}
          >
            {t("login.signIn")}
          </button>
        </span>
      </nav>

      <header className="landing-hero">
        <div>
          <h1>
            {t("login.titleLine1")}
            <br />
            <span>{t("login.titleLine2")}</span>
          </h1>
          <p className="landing-lede">{t("landing.lede")}</p>
          <div className="landing-cta">
            <button type="button" onClick={() => start("signup")}>
              {t("landing.create")}
            </button>
            <a href="/install">
              <Smartphone size={18} /> {t("landing.install")}
            </a>
          </div>
          <p className="landing-small">{t("landing.small")}</p>
        </div>

        {/* Ένα «κινητό» με μια κουβέντα, φτιαγμένο με CSS: καμία εικόνα από
            τρίτους, τίποτα να φορτώσει. */}
        <div className="landing-phone" aria-hidden="true">
          <div className="landing-phone-head">
            <i>ΕΚ</i>
            <span>
              <b>{t("landing.demoName")}</b>
              <small>{t("chat.typing")}</small>
            </span>
          </div>
          <p className="landing-phone-note">
            <LockKeyhole size={11} /> {t("landing.demoNote")}
          </p>
          <p className="bubble-demo">{t("landing.demo1")}</p>
          <p className="bubble-demo own">{t("landing.demo2")}</p>
          <p className="bubble-demo">{t("landing.demo3")}</p>
        </div>
      </header>

      <section className="landing-features">
        {features.map((f) => (
          <article key={f.title}>
            <span>{f.icon}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </article>
        ))}
      </section>

      <section className="landing-steps">
        <h2>{t("landing.stepsTitle")}</h2>
        <ol>
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <div className="landing-qr">
          <img src="/qr-install.svg" alt="" width="132" height="132" />
          <p>
            <b>{t("landing.qrTitle")}</b>
            <br />
            {t("landing.qrText")}
          </p>
        </div>
      </section>

      <section className="landing-honest">
        <p>{t("landing.honest")}</p>
        <button type="button" onClick={() => start("signup")}>
          {t("landing.create")}
        </button>
      </section>

      <footer className="landing-footer">
        <a href="/install">{t("landing.footerInstall")}</a>
        <a href="/privacy">{t("landing.footerPrivacy")}</a>
        <span>© Mila</span>
      </footer>
    </div>
  );
}
