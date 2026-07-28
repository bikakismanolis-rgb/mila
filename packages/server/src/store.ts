import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type User = {
  id: string;
  email: string;
  name: string;
  username: string;
  bio: string;
  avatar: string;
  verified: boolean;
  privacy: {
    discover: "everyone" | "contacts" | "nobody";
    showEmail: "chat" | "contacts" | "nobody";
    receipts: boolean;
    online: boolean;
  };
};
export type Member = {
  userId: string;
  role: "member" | "admin";
  lastReadAt?: string;
};
export type Conversation = {
  id: string;
  type: "direct" | "group";
  name?: string;
  avatar?: string;
  members: Member[];
  requestFrom?: string;
  requestStatus?: "pending" | "accepted" | "rejected";
  createdAt: string;
};
export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  encrypted?: boolean;
  iv?: string;
  attachment?: {
    id: string;
    name: string;
    mime: string;
    size: number;
    url: string;
  };
  kind: "text" | "system";
  createdAt: string;
  deliveredTo: string[];
  readBy: string[];
};
type State = {
  users: User[];
  conversations: Conversation[];
  messages: Message[];
  blocks: { by: string; target: string }[];
  reports: {
    id: string;
    by: string;
    target: string;
    reason: string;
    createdAt: string;
  }[];
};

const file = resolve(process.env.DATA_FILE || "data/state.json");
const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=6d5dfc`;
const seed = (): State => {
  const maria: User = {
    id: "u-maria",
    email: "maria@example.com",
    name: "Maria Costa",
    username: "maria",
    bio: "Designing kinder software.",
    avatar: avatar("Maria Costa"),
    verified: true,
    privacy: {
      discover: "everyone",
      showEmail: "chat",
      receipts: true,
      online: true,
    },
  };
  const nikos: User = {
    id: "u-nikos",
    email: "nikos@example.com",
    name: "Nikos Pappas",
    username: "nikos",
    bio: "Available",
    avatar: avatar("Nikos Pappas"),
    verified: true,
    privacy: {
      discover: "everyone",
      showEmail: "chat",
      receipts: true,
      online: true,
    },
  };
  const c: Conversation = {
    id: "c-demo",
    type: "direct",
    members: [
      { userId: maria.id, role: "member" },
      { userId: nikos.id, role: "member" },
    ],
    requestStatus: "accepted",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  };
  return {
    users: [maria, nikos],
    conversations: [c],
    messages: [
      {
        id: "m-welcome",
        conversationId: c.id,
        senderId: nikos.id,
        body: "Welcome to Email Messenger 👋",
        kind: "text",
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        deliveredTo: [maria.id],
        readBy: [],
      },
    ],
    blocks: [],
    reports: [],
  };
};
function load(): State {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return seed();
  }
}
export const state = load();
export function save() {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2));
}
export const id = (prefix: string) => `${prefix}-${randomUUID()}`;
export function publicUser(u: User, viewer?: string) {
  const hidden =
    u.privacy.showEmail === "nobody" ||
    (u.privacy.showEmail === "contacts" && viewer !== u.id);
  return { ...u, email: hidden ? null : u.email };
}
