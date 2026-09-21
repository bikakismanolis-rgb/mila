// Ομαδικές συνομιλίες: δημιουργία, και το παράθυρο «Πληροφορίες ομάδας»
// (μέλη, προσθήκη, αφαίρεση, μετονομασία, αποχώρηση).
//
// Σε ομάδα μπαίνουν ΜΟΝΟ άνθρωποι με τους οποίους μιλάς ήδη (αποδεκτή ατομική
// συνομιλία). Το επιβάλλει η βάση· εδώ απλώς δείχνουμε μόνο αυτούς.

import React, { useState } from "react";
import { LogOut, Pencil, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import * as backend from "../data";
import type { Chat, User } from "../data";
import { t, translateError } from "../i18n";
import { ConfirmDialog, Modal, PromptDialog } from "./common";

const messageOf = (caught: unknown) =>
  translateError(caught instanceof Error ? caught.message : String(caught)) ||
  (caught instanceof Error ? caught.message : t("err.generic"));

function PeoplePicker({
  people,
  selected,
  toggle,
}: {
  people: User[];
  selected: Set<string>;
  toggle: (id: string) => void;
}) {
  if (!people.length) return <p className="hint">{t("group.noContacts")}</p>;
  return (
    <div className="people-picker">
      {people.map((person) => (
        <label key={person.id}>
          <input
            type="checkbox"
            checked={selected.has(person.id)}
            onChange={() => toggle(person.id)}
          />
          <img src={person.avatar} alt="" />
          <span>
            <b>{person.name}</b>
            {person.username && <small>{backend.handleOf(person)}</small>}
          </span>
        </label>
      ))}
    </div>
  );
}

function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { selected, toggle };
}

export function NewGroupDialog({
  contacts,
  created,
  close,
}: {
  contacts: User[];
  created: (conversationId: string) => void;
  close: () => void;
}) {
  const [name, setName] = useState(""),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const { selected, toggle } = useSelection();
  const ready = name.trim().length > 0 && selected.size > 0;

  async function create() {
    if (!ready || working) return;
    setWorking(true);
    setError("");
    try {
      created(await backend.createGroup(name.trim(), [...selected]));
      close();
    } catch (caught) {
      setError(messageOf(caught));
      setWorking(false);
    }
  }

  return (
    <Modal
      title={t("group.new")}
      icon={<Users size={18} />}
      close={close}
      locked={working}
    >
      <label>
        {t("group.name")}
        <input
          className="modal-field"
          autoFocus
          maxLength={60}
          value={name}
          placeholder={t("group.namePlaceholder")}
          onChange={(e) => setName(e.target.value)}
          disabled={working}
        />
      </label>
      <p className="picker-title">{t("group.pickPeople")}</p>
      <PeoplePicker people={contacts} selected={selected} toggle={toggle} />
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="ghost" onClick={close} disabled={working}>
          {t("common.cancel")}
        </button>
        <button className="primary" onClick={create} disabled={!ready || working}>
          {working ? t("common.working") : t("group.create")}
        </button>
      </div>
    </Modal>
  );
}

export function GroupInfoDialog({
  me,
  chat,
  contacts,
  onChanged,
  onLeft,
  close,
}: {
  me: User;
  chat: Chat;
  contacts: User[];
  onChanged: () => void;
  onLeft: () => void;
  close: () => void;
}) {
  const [view, setView] = useState<"info" | "add" | "rename" | "leave">("info"),
    [removing, setRemoving] = useState<User | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const { selected, toggle } = useSelection();
  const admin = chat.myRole === "admin";
  const memberIds = new Set(chat.others.map((u) => u.id));
  const addable = contacts.filter((u) => !memberIds.has(u.id));

  async function add() {
    if (!selected.size || working) return;
    setWorking(true);
    setError("");
    try {
      await backend.addGroupMembers(chat.id, [...selected]);
      onChanged();
      close();
    } catch (caught) {
      setError(messageOf(caught));
      setWorking(false);
    }
  }

  if (view === "rename")
    return (
      <PromptDialog
        title={t("group.rename")}
        initial={chat.name || ""}
        maxLength={60}
        confirmLabel={t("settings.save")}
        onSubmit={async (value) => {
          await backend.renameGroup(chat.id, value);
          onChanged();
        }}
        close={close}
      />
    );

  if (view === "leave")
    return (
      <ConfirmDialog
        title={t("group.leaveTitle")}
        text={t("group.leaveText")}
        confirmLabel={t("group.leave")}
        danger
        onConfirm={async () => {
          await backend.removeGroupMember(chat.id, me.id);
          onLeft();
        }}
        close={close}
      />
    );

  if (removing)
    return (
      <ConfirmDialog
        title={t("group.removeTitle", { name: removing.name })}
        text={t("group.removeText")}
        confirmLabel={t("group.remove")}
        danger
        onConfirm={async () => {
          await backend.removeGroupMember(chat.id, removing.id);
          onChanged();
        }}
        close={close}
      />
    );

  if (view === "add")
    return (
      <Modal
        title={t("group.addPeople")}
        icon={<UserPlus size={18} />}
        close={close}
        locked={working}
      >
        <PeoplePicker people={addable} selected={selected} toggle={toggle} />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button
            className="ghost"
            onClick={() => setView("info")}
            disabled={working}
          >
            {t("common.back")}
          </button>
          <button
            className="primary"
            onClick={add}
            disabled={!selected.size || working}
          >
            {working ? t("common.working") : t("group.add")}
          </button>
        </div>
      </Modal>
    );

  return (
    <Modal
      title={chat.name || t("chat.group")}
      icon={<Users size={18} />}
      close={close}
    >
      <p>
        {chat.others.length + 1 === 1
          ? t("group.membersOne")
          : t("group.membersMany", { n: chat.others.length + 1 })}
      </p>
      <div className="member-list">
        <div>
          <img src={me.avatar} alt="" />
          <span>
            <b>
              {me.name} ({t("chat.you")})
            </b>
            <small>@{me.username}</small>
          </span>
          {admin && (
            <em>
              <ShieldCheck size={13} /> {t("group.admin")}
            </em>
          )}
        </div>
        {chat.others.map((member) => (
          <div key={member.id}>
            <img src={member.avatar} alt="" />
            <span>
              <b>{member.deleted ? t("chat.deletedUser") : member.name}</b>
              {!member.deleted && member.username && (
                <small>{backend.handleOf(member)}</small>
              )}
            </span>
            {member.role === "admin" && (
              <em>
                <ShieldCheck size={13} /> {t("group.admin")}
              </em>
            )}
            {admin && (
              <button
                className="icon-button"
                title={t("group.remove")}
                aria-label={t("group.remove")}
                onClick={() => setRemoving(member)}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="modal-actions stacked">
        {admin && (
          <button className="ghost" onClick={() => setView("add")}>
            <UserPlus size={16} /> {t("group.addPeople")}
          </button>
        )}
        {admin && (
          <button className="ghost" onClick={() => setView("rename")}>
            <Pencil size={16} /> {t("group.rename")}
          </button>
        )}
        <button className="danger" onClick={() => setView("leave")}>
          <LogOut size={16} /> {t("group.leave")}
        </button>
      </div>
    </Modal>
  );
}
