import http from "node:http";
import { createHash, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import {
  id,
  publicUser,
  save,
  state,
  type Message,
  type User,
} from "./store.js";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
loadEnvFile(resolve(".env"));
loadEnvFile(resolve("../../.env"));
loadEnvFile(resolve("apps/web/.env.local"));
loadEnvFile(resolve("../../apps/web/.env.local"));
const PORT = Number(process.env.PORT || 8787),
  SECRET = process.env.JWT_SECRET || "dev-only-change-me",
  SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY =
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});
const uploadsDir = resolve("uploads");
mkdirSync(uploadsDir, { recursive: true });
const codes = new Map<string, { code: string; expires: number }>();
const attempts = new Map<string, { count: number; reset: number }>();
function limited(key: string, limit = 12) {
  const now = Date.now(),
    x = attempts.get(key);
  if (!x || x.reset < now) {
    attempts.set(key, { count: 1, reset: now + 60000 });
    return false;
  }
  x.count++;
  return x.count > limit;
}
function token(u: User) {
  return jwt.sign({ sub: u.id }, SECRET, { expiresIn: "7d" });
}
type SupabaseAuthUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

function cleanUsername(seed: string) {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/^[_.]+|[_.]+$/g, "")
    .slice(0, 20);
  return (base || "user").padEnd(3, "0");
}

function uniqueUsername(email: string) {
  const root = cleanUsername(email.split("@")[0]);
  let candidate = root;
  while (state.users.some((u) => u.username === candidate)) {
    candidate = `${root.slice(0, 20)}${randomInt(10, 99)}`.slice(0, 24);
  }
  return candidate;
}

async function verifySupabaseUser(accessToken: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
    throw new Error("Supabase is not configured on the local API.");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) throw new Error("Supabase session is invalid or expired.");
  const user = (await response.json()) as SupabaseAuthUser;
  if (!user.id || !user.email)
    throw new Error("Supabase did not return a verified email user.");
  return user;
}

function upsertLocalUserFromSupabase(
  user: SupabaseAuthUser,
  preferredName?: string,
) {
  const email = user.email!.toLowerCase();
  const metadataName =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : undefined;
  const name = (preferredName || metadataName || email.split("@")[0]).trim();
  let existing = state.users.find((u) => u.email === email || u.id === user.id);
  if (!existing) {
    existing = {
      id: user.id,
      email,
      name: name.length >= 2 ? name : email.split("@")[0],
      username: uniqueUsername(email),
      bio: "Hey there! I use Email Messenger.",
      avatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`,
      verified: true,
      privacy: {
        discover: "everyone",
        showEmail: "chat",
        receipts: true,
        online: true,
      },
    };
    state.users.push(existing);
  } else {
    existing.verified = true;
    existing.email = email;
    if (preferredName && preferredName.trim().length >= 2) {
      existing.name = preferredName.trim();
      existing.avatar = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(existing.name)}`;
    }
  }
  save();
  return existing;
}
function auth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  try {
    const raw = req.headers.authorization?.replace("Bearer ", "");
    const p = jwt.verify(raw || "", SECRET) as jwt.JwtPayload;
    (req as any).user = state.users.find((u) => u.id === p.sub);
    if (!(req as any).user) throw 0;
    next();
  } catch {
    res.status(401).json({ error: "Please sign in again." });
  }
}
const me = (req: express.Request) => (req as any).user as User;
const member = (cid: string, uid: string) =>
  state.conversations.find(
    (c) => c.id === cid && c.members.some((m) => m.userId === uid),
  );

app.post("/contacts/match", auth, (q, r) => {
  const parsed = z
    .object({ hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(500) })
    .safeParse(q.body);
  if (!parsed.success)
    return r.status(400).json({ error: "Invalid contact list." });
  const wanted = new Set(parsed.data.hashes);
  r.json(
    state.users
      .filter(
        (u) =>
          u.id !== me(q).id &&
          u.privacy.discover !== "nobody" &&
          wanted.has(createHash("sha256").update(u.email).digest("hex")),
      )
      .map((u) => publicUser(u, me(q).id)),
  );
});

app.post("/uploads", auth, upload.single("file"), (q, r) => {
  const conversationId = String(q.body.conversationId || "");
  if (!member(conversationId, me(q).id))
    return r.status(403).json({ error: "Not a conversation member." });
  if (!q.file) return r.status(400).json({ error: "Choose a file." });
  const allowed =
    q.file.mimetype.startsWith("image/") ||
    [
      "application/pdf",
      "text/plain",
      "application/zip",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(q.file.mimetype);
  if (!allowed)
    return r.status(415).json({ error: "This file type is not allowed." });
  const fileId = id("file");
  const extension = extname(q.file.originalname).slice(0, 10).toLowerCase();
  writeFileSync(resolve(uploadsDir, `${fileId}${extension}`), q.file.buffer);
  r.status(201).json({
    id: fileId,
    name: q.file.originalname.slice(0, 180),
    mime: q.file.mimetype,
    size: q.file.size,
    url: `/media/${fileId}`,
  });
});

app.get("/media/:id", (q, r) => {
  try {
    const payload = jwt.verify(
      String(q.query.token || ""),
      SECRET,
    ) as jwt.JwtPayload;
    const uid = String(payload.sub);
    const message = state.messages.find(
      (m) => m.attachment?.id === String(q.params.id),
    );
    if (!message || !member(message.conversationId, uid)) throw new Error();
    const extension = extname(message.attachment!.name)
      .slice(0, 10)
      .toLowerCase();
    r.type(message.attachment!.mime).sendFile(
      resolve(uploadsDir, `${message.attachment!.id}${extension}`),
    );
  } catch {
    r.status(403).json({ error: "Media unavailable." });
  }
});

app.get("/health", (_q, r) => r.json({ ok: true }));
app.post("/auth/supabase-session", async (req, res) => {
  const parsed = z
    .object({
      accessToken: z.string().min(20),
      name: z.string().min(2).max(60).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid Supabase session." });
  try {
    const supabaseUser = await verifySupabaseUser(parsed.data.accessToken);
    const u = upsertLocalUserFromSupabase(supabaseUser, parsed.data.name);
    res.json({ token: token(u), user: publicUser(u, u.id) });
  } catch (error) {
    res.status(401).json({
      error:
        error instanceof Error
          ? error.message
          : "Could not verify Supabase session.",
    });
  }
});
app.post("/auth/request", (req, res) => {
  const p = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Enter a valid email." });
  const email = p.data.email.toLowerCase();
  if (limited(email, 5))
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again shortly." });
  const code = String(randomInt(100000, 999999));
  codes.set(email, { code, expires: Date.now() + 600000 });
  console.log(`[DEV verification] ${email}: ${code}`);
  res.json({
    ok: true,
    devCode: process.env.NODE_ENV === "production" ? undefined : code,
  });
});
app.post("/auth/verify", (req, res) => {
  const p = z
    .object({
      email: z.string().email(),
      code: z.string().length(6),
      name: z.string().min(2).max(60).optional(),
    })
    .safeParse(req.body);
  if (!p.success)
    return res.status(400).json({ error: "Invalid verification details." });
  const email = p.data.email.toLowerCase(),
    found = codes.get(email);
  if (!found || found.code !== p.data.code || found.expires < Date.now())
    return res.status(401).json({ error: "That code is invalid or expired." });
  codes.delete(email);
  let u = state.users.find((x) => x.email === email);
  if (!u) {
    const name = p.data.name || email.split("@")[0];
    u = {
      id: id("u"),
      email,
      name,
      username: `${email.split("@")[0]}${randomInt(10, 99)}`,
      bio: "Hey there! I use Email Messenger.",
      avatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`,
      verified: true,
      privacy: {
        discover: "everyone",
        showEmail: "chat",
        receipts: true,
        online: true,
      },
    };
    state.users.push(u);
    save();
  }
  res.json({ token: token(u), user: publicUser(u, u.id) });
});
app.get("/me", auth, (q, r) => r.json(publicUser(me(q), me(q).id)));
app.patch("/me", auth, (q, r) => {
  const p = z
    .object({
      name: z.string().min(2).max(60).optional(),
      username: z
        .string()
        .regex(/^[a-z0-9_.]{3,24}$/)
        .optional(),
      bio: z.string().max(160).optional(),
      privacy: z
        .object({
          discover: z.enum(["everyone", "contacts", "nobody"]),
          showEmail: z.enum(["chat", "contacts", "nobody"]),
          receipts: z.boolean(),
          online: z.boolean(),
        })
        .optional(),
    })
    .safeParse(q.body);
  if (!p.success) return r.status(400).json({ error: "Invalid profile." });
  Object.assign(me(q), p.data);
  save();
  r.json(publicUser(me(q), me(q).id));
});
app.get("/users/search", auth, (q, r) => {
  const term = String(q.query.q || "")
    .toLowerCase()
    .trim();
  if (term.length < 2) return r.json([]);
  r.json(
    state.users
      .filter(
        (u) =>
          u.id !== me(q).id &&
          u.privacy.discover !== "nobody" &&
          !state.blocks.some((b) => b.by === u.id && b.target === me(q).id) &&
          (u.email.includes(term) ||
            u.username.includes(term) ||
            u.name.toLowerCase().includes(term)),
      )
      .slice(0, 20)
      .map((u) => publicUser(u, me(q).id)),
  );
});
app.get("/conversations", auth, (q, r) => {
  const uid = me(q).id;
  const rows = state.conversations
    .filter(
      (c) =>
        c.members.some((m) => m.userId === uid) &&
        c.requestStatus !== "rejected",
    )
    .map((c) => {
      const msgs = state.messages.filter((m) => m.conversationId === c.id),
        last = msgs.at(-1),
        others = c.members
          .filter((m) => m.userId !== uid)
          .map((m) =>
            publicUser(
              state.users.find((u) => u.id === m.userId)!,
              uid,
            ),
          );
      return {
        ...c,
        others,
        last,
        unread: msgs.filter(
          (m) => m.senderId !== uid && !m.readBy.includes(uid),
        ).length,
      };
    })
    .sort((a, b) =>
      (b.last?.createdAt || b.createdAt).localeCompare(
        a.last?.createdAt || a.createdAt,
      ),
    );
  r.json(rows);
});
app.post("/conversations", auth, (q, r) => {
  const p = z.object({ userId: z.string() }).safeParse(q.body);
  if (!p.success || !state.users.some((u) => u.id === p.data.userId))
    return r.status(404).json({ error: "User not found." });
  const uid = me(q).id;
  if (
    state.blocks.some(
      (b) =>
        (b.by === uid && b.target === p.data.userId) ||
        (b.by === p.data.userId && b.target === uid),
    )
  )
    return r.status(403).json({ error: "Conversation unavailable." });
  let c = state.conversations.find(
    (c) =>
      c.type === "direct" &&
      c.members.some((m) => m.userId === uid) &&
      c.members.some((m) => m.userId === p.data.userId),
  );
  if (!c) {
    c = {
      id: id("c"),
      type: "direct",
      members: [
        { userId: uid, role: "member" },
        { userId: p.data.userId, role: "member" },
      ],
      requestFrom: uid,
      requestStatus: "pending",
      createdAt: new Date().toISOString(),
    };
    state.conversations.push(c);
    save();
  }
  r.json(c);
});
app.post("/conversations/:id/decision", auth, (q, r) => {
  const c = member(String(q.params.id), me(q).id);
  const p = z
    .object({ decision: z.enum(["accepted", "rejected"]) })
    .safeParse(q.body);
  if (!c || !p.success)
    return r.status(404).json({ error: "Request not found." });
  if (c.requestFrom === me(q).id)
    return r.status(403).json({ error: "Only the recipient can decide." });
  c.requestStatus = p.data.decision;
  save();
  broadcast(
    c.members.map((m) => m.userId),
    { type: "conversation", conversationId: c.id },
  );
  r.json(c);
});
app.get("/conversations/:id/messages", auth, (q, r) => {
  const c = member(String(q.params.id), me(q).id);
  if (!c) return r.status(403).json({ error: "Not a member." });
  r.json(state.messages.filter((m) => m.conversationId === c.id).slice(-200));
});
app.post("/conversations/:id/messages", auth, (q, r) => {
  const c = member(String(q.params.id), me(q).id);
  const p = z
    .object({
      body: z.string().max(8000),
      encrypted: z.boolean().optional(),
      iv: z.string().optional(),
      attachment: z
        .object({
          id: z.string(),
          name: z.string().max(180),
          mime: z.string().max(120),
          size: z.number().max(15 * 1024 * 1024),
          url: z.string(),
        })
        .optional(),
    })
    .refine((value) => value.body.trim().length > 0 || value.attachment, {
      message: "A message or attachment is required.",
    })
    .safeParse(q.body);
  if (!c || !p.success)
    return r.status(400).json({ error: "Message cannot be sent." });
  if (c.requestStatus === "rejected")
    return r.status(403).json({ error: "Request rejected." });
  const m: Message = {
    id: id("m"),
    conversationId: c.id,
    senderId: me(q).id,
    body: p.data.body,
    encrypted: p.data.encrypted,
    iv: p.data.iv,
    attachment: p.data.attachment,
    kind: "text",
    createdAt: new Date().toISOString(),
    deliveredTo: [],
    readBy: [me(q).id],
  };
  state.messages.push(m);
  save();
  broadcast(
    c.members.map((x) => x.userId),
    { type: "message", message: m },
  );
  r.status(201).json(m);
});
app.post("/conversations/:id/read", auth, (q, r) => {
  const c = member(String(q.params.id), me(q).id);
  if (!c) return r.status(404).end();
  state.messages
    .filter((m) => m.conversationId === c.id)
    .forEach((m) => {
      if (!m.readBy.includes(me(q).id)) m.readBy.push(me(q).id);
    });
  save();
  broadcast(
    c.members.map((x) => x.userId),
    { type: "read", conversationId: c.id, userId: me(q).id },
  );
  r.json({ ok: true });
});
app.post("/users/:id/block", auth, (q, r) => {
  const target = String(q.params.id);
  if (!state.blocks.some((b) => b.by === me(q).id && b.target === target))
    state.blocks.push({ by: me(q).id, target });
  save();
  r.json({ ok: true });
});
app.post("/users/:id/report", auth, (q, r) => {
  const reason = String(q.body.reason || "unspecified").slice(0, 500);
  state.reports.push({
    id: id("report"),
    by: me(q).id,
    target: String(q.params.id),
    reason,
    createdAt: new Date().toISOString(),
  });
  save();
  r.json({ ok: true });
});

const server = http.createServer(app),
  wss = new WebSocketServer({ server, path: "/realtime" });
const sockets = new Map<string, Set<WebSocket>>();
function broadcast(users: string[], data: unknown) {
  const raw = JSON.stringify(data);
  users.forEach((uid) =>
    sockets
      .get(uid)
      ?.forEach((ws) => ws.readyState === WebSocket.OPEN && ws.send(raw)),
  );
}
wss.on("connection", (ws, req) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host}`),
      p = jwt.verify(
        url.searchParams.get("token") || "",
        SECRET,
      ) as jwt.JwtPayload,
      uid = String(p.sub);
    if (!state.users.some((u) => u.id === uid)) throw 0;
    if (!sockets.has(uid)) sockets.set(uid, new Set());
    sockets.get(uid)!.add(ws);
    ws.on("message", (buf) => {
      try {
        const x = JSON.parse(String(buf)),
          c = member(x.conversationId, uid);
        if (c && x.type === "typing")
          broadcast(
            c.members.filter((m) => m.userId !== uid).map((m) => m.userId),
            {
              type: "typing",
              conversationId: c.id,
              userId: uid,
              active: !!x.active,
            },
          );
      } catch {}
    });
    ws.on("close", () => sockets.get(uid)?.delete(ws));
  } catch {
    ws.close(1008, "Unauthorized");
  }
});
server.listen(PORT, () =>
  console.log(`Email Messenger API http://localhost:${PORT}`),
);
