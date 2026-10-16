// Ρυθμίσεις: προφίλ, γλώσσα, ειδοποιήσεις, ιδιωτικότητα, μπλοκαρισμένοι,
// λογαριασμός (κωδικός, εξαγωγή, διαγραφή), αποσύνδεση.

import React, { useEffect, useRef, useState } from "react";
import {
  Bell,
  Camera,
  Download,
  KeyRound,
  LockKeyhole,
  LogOut,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "../supabase";
import * as backend from "../data";
import type { Device, Privacy, User } from "../data";
import { privacyPolicyUrl } from "../platform";
import { lang, setLang, t, translateError } from "../i18n";
import type { Lang } from "../i18n";
import { disablePush, enablePush, pushState } from "../push";
import type { PushState } from "../push";
import { ConfirmDialog, Modal } from "./common";
import { listTime } from "../format";

const DEFAULT_PRIVACY: Privacy = {
  discover: "everyone",
  showEmail: "chat",
  receipts: true,
  online: true,
};

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

export function SettingsPanel({
  me,
  saved,
  signOut,
  blockedVersion,
  onUnblocked,
}: {
  me: User;
  saved: (u: User) => void;
  signOut: () => void;
  /** Αλλάζει όταν μπλοκάρω κάποιον από συνομιλία, για να ξαναφορτώσει η λίστα. */
  blockedVersion: number;
  onUnblocked: () => void;
}) {
  const [name, setName] = useState(me.name),
    [bio, setBio] = useState(me.bio),
    [privacy, setPrivacy] = useState<Privacy>(me.privacy ?? DEFAULT_PRIVACY),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");

  async function save() {
    if (saving) return;
    setError("");
    setNotice("");
    if (name.trim().length < 2) {
      setError(t("settings.nameTooShort"));
      return;
    }
    setSaving(true);
    try {
      saved(await backend.updateMe({ name, bio, privacy }));
      setNotice(t("settings.saved"));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings">
      <ProfilePhoto me={me} saved={saved} />

      <label>
        {t("settings.displayName")}
        <input
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        {t("settings.bio")}
        <textarea
          value={bio}
          maxLength={160}
          onChange={(e) => setBio(e.target.value)}
        />
      </label>

      <h3>{t("settings.privacy")}</h3>
      <label>
        {t("settings.discover")}
        <select
          value={privacy.discover}
          onChange={(e) =>
            setPrivacy({
              ...privacy,
              discover: e.target.value as Privacy["discover"],
            })
          }
        >
          <option value="everyone">{t("settings.discoverEveryone")}</option>
          <option value="contacts">{t("settings.discoverContacts")}</option>
          <option value="nobody">{t("settings.discoverNobody")}</option>
        </select>
        <small className="field-hint">{t("settings.discoverHint")}</small>
      </label>
      <label>
        {t("settings.showEmail")}
        <select
          // Στη βάση το 'chat' και το 'contacts' σημαίνουν πλέον το ίδιο.
          value={privacy.showEmail === "nobody" ? "nobody" : "chat"}
          onChange={(e) =>
            setPrivacy({
              ...privacy,
              showEmail: e.target.value as Privacy["showEmail"],
            })
          }
        >
          <option value="chat">{t("settings.showEmailContacts")}</option>
          <option value="nobody">{t("settings.showEmailNobody")}</option>
        </select>
        <small className="field-hint">{t("settings.showEmailHint")}</small>
      </label>
      <label className="toggle">
        <span>
          {t("settings.receipts")}
          <small>{t("settings.receiptsHint")}</small>
        </span>
        <input
          type="checkbox"
          checked={privacy.receipts}
          onChange={(e) =>
            setPrivacy({ ...privacy, receipts: e.target.checked })
          }
        />
      </label>
      <button onClick={save} disabled={saving}>
        {saving ? t("common.working") : t("settings.save")}
      </button>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <h3>{t("settings.language")}</h3>
      <label>
        <select
          value={lang}
          aria-label={t("settings.language")}
          onChange={(e) => setLang(e.target.value as Lang)}
        >
          <option value="el">Ελληνικά</option>
          <option value="en">English</option>
        </select>
      </label>

      <SecuritySection />

      <NotificationsSection />

      <BlockedSection version={blockedVersion} onUnblocked={onUnblocked} />

      <AccountSection email={me.email || ""} />

      <button className="signout" onClick={signOut}>
        <LogOut size={16} /> {t("nav.signOut")}
      </button>

      <p className="storage-note">
        <ShieldCheck size={14} /> {t("settings.storageNote")}
      </p>
    </div>
  );
}

function ProfilePhoto({ me, saved }: { me: User; saved: (u: User) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");

  async function run(action: () => Promise<User>) {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      saved(await action());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setWorking(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="profile">
      <button
        className="avatar-edit"
        onClick={() => input.current?.click()}
        disabled={working}
        aria-label={me.avatarPath ? t("settings.photoChange") : t("settings.photoAdd")}
      >
        <img src={me.avatar} alt="" />
        <span>
          <Camera size={16} />
        </span>
      </button>
      <b>{me.name}</b>
      <small>{me.email}</small>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run(() => backend.setAvatar(file));
        }}
      />
      <div className="photo-actions">
        <button
          className="ghost"
          onClick={() => input.current?.click()}
          disabled={working}
        >
          {working
            ? t("common.working")
            : me.avatarPath
              ? t("settings.photoChange")
              : t("settings.photoAdd")}
        </button>
        {me.avatarPath && (
          <button
            className="ghost"
            onClick={() => void run(backend.removeAvatar)}
            disabled={working}
          >
            {t("settings.photoRemove")}
          </button>
        )}
      </div>
      <small className="field-hint">{t("settings.photoHint")}</small>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function SecuritySection() {
  const [current, setCurrent] = useState<{ id: string | null; ephemeral: boolean } | null>(null),
    [devices, setDevices] = useState<Device[]>([]),
    [prints, setPrints] = useState<Record<string, string>>({}),
    [revoking, setRevoking] = useState<Device | null>(null),
    [legacy, setLegacy] = useState(0),
    [confirmLegacy, setConfirmLegacy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");

  async function load() {
    try {
      const device = await backend.ensureDevice();
      const list = await backend.listMyDevices();
      const entries = await Promise.all(
        list.map(async (d) => [d.id, await backend.fingerprint(d.publicKey)] as const),
      );
      setCurrent({ id: device.deviceId, ephemeral: device.ephemeral });
      setDevices(list);
      setPrints(Object.fromEntries(entries));
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  useEffect(() => {
    void load();
    backend.countMyUnencryptedMessages().then(setLegacy);
  }, []);

  const mine = devices.find((d) => d.id === current?.id);
  const others = devices.filter((d) => d.id !== current?.id);

  return (
    <section className="security-section">
      <h3>{t("settings.security")}</h3>
      <p className="hint">
        <ShieldCheck size={14} /> {t("settings.securityText")}
      </p>
      {current?.ephemeral ? (
        <p className="hint warning">{t("settings.ephemeral")}</p>
      ) : (
        <p className="hint">{t("settings.keyWarning")}</p>
      )}

      <div className="device-list">
        {mine && (
          <div>
            <Smartphone size={18} />
            <span>
              <b>
                {t("settings.thisDevice")}
                {mine.label ? ` · ${mine.label}` : ""}
              </b>
              <small>
                {t("settings.fingerprint")}: <code>{prints[mine.id]}</code>
              </small>
            </span>
          </div>
        )}
        {others.map((d) => (
          <div key={d.id}>
            <KeyRound size={18} />
            <span>
              <b>{d.label || "—"}</b>
              <small>
                {t("settings.lastSeen", { date: listTime(d.lastSeenAt) })} ·{" "}
                <code>{prints[d.id]}</code>
              </small>
            </span>
            <button onClick={() => setRevoking(d)}>{t("settings.revoke")}</button>
          </div>
        ))}
      </div>

      {legacy > 0 && (
        <>
          <h3>{t("settings.legacyTitle")}</h3>
          <p className="hint">{t("settings.legacyText", { n: legacy })}</p>
          <button className="secondary" onClick={() => setConfirmLegacy(true)}>
            <Trash2 size={15} /> {t("settings.legacyDelete")}
          </button>
        </>
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {revoking && (
        <ConfirmDialog
          title={t("settings.revokeTitle")}
          text={t("settings.revokeText")}
          confirmLabel={t("settings.revoke")}
          danger
          onConfirm={async () => {
            await backend.revokeDevice(revoking.id);
            await load();
          }}
          close={() => setRevoking(null)}
        />
      )}
      {confirmLegacy && (
        <ConfirmDialog
          title={t("settings.legacyDelete")}
          text={t("settings.legacyConfirm")}
          confirmLabel={t("settings.legacyDelete")}
          danger
          onConfirm={async () => {
            const n = await backend.deleteMyUnencryptedMessages();
            setLegacy(0);
            setNotice(t("settings.legacyDone", { n }));
          }}
          close={() => setConfirmLegacy(false)}
        />
      )}
    </section>
  );
}

function NotificationsSection() {
  const [state, setState] = useState<PushState>("checking"),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(on: boolean) {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      if (on) await enablePush();
      else await disablePush();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setState(await pushState());
      setWorking(false);
    }
  }

  return (
    <>
      <h3>{t("settings.notifications")}</h3>
      {state === "unsupported" ? (
        <p className="hint">{t("push.unsupported")}</p>
      ) : state === "denied" ? (
        <p className="hint">{t("push.blocked")}</p>
      ) : (
        <label className="toggle">
          <span>
            <span className="with-icon">
              <Bell size={15} /> {t("push.toggle")}
            </span>
            <small>{t("push.toggleHint")}</small>
          </span>
          <input
            type="checkbox"
            checked={state === "on"}
            disabled={working || state === "checking"}
            onChange={(e) => void toggle(e.target.checked)}
          />
        </label>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function BlockedSection({
  version,
  onUnblocked,
}: {
  version: number;
  onUnblocked: () => void;
}) {
  const [blocked, setBlocked] = useState<User[] | null>(null),
    [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    backend
      .listBlocked()
      .then((list) => alive && setBlocked(list))
      .catch((caught) => alive && setError(messageOf(caught)));
    return () => {
      alive = false;
    };
  }, [version]);

  async function unblock(user: User) {
    setError("");
    try {
      await backend.unblockUser(user.id);
      setBlocked((list) => (list || []).filter((u) => u.id !== user.id));
      onUnblocked();
    } catch (caught) {
      setError(messageOf(caught));
    }
  }

  return (
    <>
      <h3>{t("settings.blocked")}</h3>
      {blocked && !blocked.length && (
        <p className="hint">{t("settings.blockedNone")}</p>
      )}
      <div className="blocked-list">
        {(blocked || []).map((user) => (
          <div key={user.id}>
            <img src={user.avatar} alt="" />
            <span>
              <b>{user.name}</b>
              {user.username && <small>{backend.handleOf(user)}</small>}
            </span>
            <button onClick={() => void unblock(user)}>
              {t("chat.unblock")}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

// Ό,τι αφορά τον ίδιο τον λογαριασμό, χωριστά από τις ρυθμίσεις. Και τα δύο
// stores απαιτούν να είναι εδώ: χωρίς πραγματική διαγραφή λογαριασμού μέσα
// στην εφαρμογή, το app απορρίπτεται στον έλεγχο.
function AccountSection({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false),
    [exporting, setExporting] = useState(false),
    [passwordOpen, setPasswordOpen] = useState(false),
    [newPassword, setNewPassword] = useState(""),
    [savingPassword, setSavingPassword] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");

  async function changePassword() {
    setError("");
    setNotice("");
    if (newPassword.length < 6) {
      setError(t("err.passwordShort"));
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase!.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      setNewPassword("");
      setPasswordOpen(false);
      setNotice(t("account.passwordUpdated"));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSavingPassword(false);
    }
  }

  async function exportData() {
    setError("");
    setNotice("");
    setExporting(true);
    try {
      const payload = await backend.exportMyData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mila-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="account-section">
      <h3>{t("account.title")}</h3>
      <p className="hint">
        <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
          {t("account.readPolicy")}
        </a>{" "}
        {t("account.readPolicyAfter")}
      </p>
      <p className="hint">
        <a href="/install" target="_blank" rel="noopener noreferrer">
          {t("account.install")}
        </a>
      </p>
      <button
        className="secondary"
        type="button"
        onClick={() => setPasswordOpen((open) => !open)}
      >
        <LockKeyhole size={15} />
        {t("account.changePassword")}
      </button>
      {passwordOpen && (
        <div className="password-change">
          <label>
            {t("login.newPassword")}
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("login.passwordHint")}
            />
          </label>
          <button onClick={changePassword} disabled={savingPassword}>
            {savingPassword ? t("common.working") : t("account.savePassword")}
          </button>
        </div>
      )}
      <button className="secondary" onClick={exportData} disabled={exporting}>
        <Download size={15} />
        {exporting ? t("account.preparing") : t("account.download")}
      </button>
      <p className="hint">{t("account.downloadHint")}</p>

      <button className="danger" onClick={() => setConfirming(true)}>
        <Trash2 size={15} />
        {t("account.delete")}
      </button>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {confirming && (
        <DeleteAccountDialog email={email} close={() => setConfirming(false)} />
      )}
    </section>
  );
}

function DeleteAccountDialog({
  email,
  close,
}: {
  email: string;
  close: () => void;
}) {
  const [typed, setTyped] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  // Η λέξη επιβεβαίωσης μένει DELETE και στις δύο γλώσσες: γράφεται το ίδιο σε
  // κάθε πληκτρολόγιο και δεν εξαρτάται από τόνους ή κεφαλαία ελληνικά.
  const armed = typed.trim().toUpperCase() === "DELETE";

  async function confirm() {
    if (!armed || working) return;
    setError("");
    setWorking(true);
    try {
      // Πρώτα φεύγει η συνδρομή ειδοποιήσεων αυτής της συσκευής, όσο ακόμα
      // υπάρχει λογαριασμός για να το ζητήσει.
      await disablePush().catch(() => undefined);
      await backend.deleteMyAccount();
      // Ο λογαριασμός δεν υπάρχει πια, άρα ούτε το state. Καθαρό reload είναι
      // πιο ασφαλές από το να ξηλώνουμε το δέντρο του React με το χέρι.
      location.reload();
    } catch (caught) {
      setError(messageOf(caught));
      setWorking(false);
    }
  }

  return (
    <Modal
      title={t("account.deleteTitle")}
      icon={<TriangleAlert size={18} />}
      danger
      close={close}
      locked={working}
    >
      <p>
        {t("account.deleteIntroBefore")} <b>{email}</b>{" "}
        {t("account.deleteIntroAfter")}
      </p>
      <ul className="consequences">
        <li>{t("account.deleteItem1")}</li>
        <li>{t("account.deleteItem2")}</li>
        <li>{t("account.deleteItem3")}</li>
      </ul>
      <label>
        {t("account.typeDeleteBefore")} <b>DELETE</b>{" "}
        {t("account.typeDeleteAfter")}
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          disabled={working}
          placeholder="DELETE"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={close} disabled={working}>
          {t("account.keep")}
        </button>
        <button
          className="danger"
          onClick={confirm}
          disabled={!armed || working}
        >
          {working ? t("account.deleting") : t("account.deletePermanently")}
        </button>
      </div>
    </Modal>
  );
}
