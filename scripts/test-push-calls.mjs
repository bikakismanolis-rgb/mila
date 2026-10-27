// Έλεγχος της function «push» για τις κλήσεις, χωρίς δίκτυο.
//
//   node scripts/test-push-calls.mjs        (Node 22.18+, διαβάζει απευθείας το .ts)
//
// Η βάση και η υπηρεσία push είναι ψεύτικες (fetch). Ελέγχεται ότι:
//   1. 'call' / 'call-ended' θέλουν το μυστικό του webhook.
//   2. 'call-ended' ρωτάει τη βάση για ΕΝΑΝ άνθρωπο (push_call_ended_targets).
//   3. «Σε καλεί» ζει 45'' στην υπηρεσία push, «τέλος» και «αναπάντητη» μία
//      μέρα, όλα με το ίδιο topic (το νεότερο παίρνει τη θέση του παλιότερου).
import assert from "node:assert/strict";

const vars = { SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "service-key" };
globalThis.Deno = { env: { get: (name) => vars[name] } };
const { b64urlEncode, generateVapid, handler } = await import("../supabase/functions/push/index.ts");

const vapid = await generateVapid();
const browserKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const subscription = {
  id: "sub-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
  p256dh: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", browserKeys.publicKey))),
  auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
};

let rpcs = [];
let sent = [];
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target.startsWith(`${vars.SUPABASE_URL}/rest/v1/rpc/`)) {
    const fn = target.split("/").pop();
    rpcs.push({ fn, args: JSON.parse(init.body || "{}") });
    if (fn === "push_config_get")
      return Response.json({
        vapid_public: vapid.publicKey,
        vapid_private: vapid.privateJwk,
        webhook_secret: "hook-secret",
        subject: "mailto:test@example.test",
      });
    if (fn === "push_call_targets" || fn === "push_call_ended_targets")
      return Response.json({ payload: { type: "call", callId: "call-1" }, subscriptions: [subscription] });
    return new Response("", { status: 404 });
  }
  if (target === subscription.endpoint) {
    sent.push(Object.fromEntries(Object.entries(init.headers)));
    return new Response("", { status: 201 });
  }
  throw new Error(`unexpected fetch ${target}`);
};

const call = (body, secret = "hook-secret") =>
  handler(
    new Request("https://fn.example.test/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mila-secret": secret },
      body: JSON.stringify(body),
    }),
  );
const reset = () => {
  rpcs = [];
  sent = [];
};
const asked = (fn) => rpcs.filter((r) => r.fn === fn);
const callId = "0f0e0d0c-0000-4000-8000-00000000abcd";
const topic = callId.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

// 1. Χωρίς το μυστικό, τίποτα.
for (const action of ["call", "call-ended"]) {
  reset();
  const response = await call({ action, call_id: callId, event: "ring", user_id: "user-1" }, "wrong");
  assert.equal(response.status, 403, `${action} needs the webhook secret`);
  assert.equal(sent.length, 0);
}

// 2. «Σε καλεί».
reset();
let response = await call({ action: "call", call_id: callId, event: "ring" });
assert.equal(response.status, 200);
assert.deepEqual(asked("push_call_targets")[0].args, { p_call: callId, p_event: "ring" });
assert.equal(sent.length, 1);
assert.equal(sent[0].TTL, "45", "a ring is worthless after 45 seconds");
assert.equal(sent[0].Topic, topic);

// 3. «Αναπάντητη».
reset();
await call({ action: "call", call_id: callId, event: "missed" });
assert.deepEqual(asked("push_call_targets")[0].args, { p_call: callId, p_event: "missed" });
assert.equal(sent[0].TTL, "86400");
assert.equal(sent[0].Topic, topic);

// Άγνωστο event: «σε καλεί», όπως πριν. Ποτέ «τέλος» από το action 'call'.
reset();
await call({ action: "call", call_id: callId, event: "ended" });
assert.equal(asked("push_call_targets")[0].args.p_event, "ring");
assert.equal(asked("push_call_ended_targets").length, 0);

// 4. «Τέλος»: για έναν άνθρωπο.
reset();
response = await call({ action: "call-ended", call_id: callId, user_id: "user-1" });
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { sent: 1, failed: 0, pruned: 0 });
assert.deepEqual(asked("push_call_ended_targets")[0].args, { p_call: callId, p_user: "user-1" });
assert.equal(asked("push_call_targets").length, 0);
assert.equal(sent[0].TTL, "86400", "an end push still matters when the phone comes back online");
assert.equal(sent[0].Topic, topic, "and replaces a ring that was not delivered yet");

reset();
response = await call({ action: "call-ended", call_id: callId });
assert.equal(response.status, 400, "end push needs the user");
assert.equal(sent.length, 0);

console.log("push calls OK");
