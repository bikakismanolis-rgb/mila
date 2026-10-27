// Έλεγχος των servers που δίνει η function «push» για τις κλήσεις, χωρίς δίκτυο.
//
//   node scripts/test-ice.mjs        (Node 22.18+, διαβάζει απευθείας το .ts)
//
// Χωρίς ρυθμίσεις: μόνο STUN. Με TURN_URLS + TURN_SECRET (coturn): όνομα
// «λήξη:χρήστης» και κωδικός HMAC-SHA1, όπως τον ελέγχει ο coturn. Με σταθερά
// στοιχεία: ακριβώς αυτά.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const vars = {};
globalThis.Deno = { env: { get: (name) => vars[name] } };
const { iceServers } = await import("../supabase/functions/push/index.ts");

let result = await iceServers("user-1");
assert.equal(result.relay, false, "no TURN without settings");
assert.equal(result.iceServers.length, 1);
assert.ok(result.iceServers[0].urls.every((u) => u.startsWith("stun:")));

vars.TURN_URLS = "turn:turn.example.com:3478?transport=udp, turns:turn.example.com:5349";
vars.TURN_SECRET = "s3cret";
result = await iceServers("user-1");
assert.equal(result.relay, true);
const turn = result.iceServers[1];
assert.deepEqual(turn.urls, ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"]);
const [expiry, user] = turn.username.split(":");
assert.equal(user, "user-1");
assert.ok(Number(expiry) > Date.now() / 1000 + 3600, "credential lasts hours");
assert.equal(turn.credential, createHmac("sha1", "s3cret").update(turn.username).digest("base64"), "coturn REST credential");

delete vars.TURN_SECRET;
vars.TURN_USERNAME = "static-user";
vars.TURN_CREDENTIAL = "static-pass";
result = await iceServers("user-1");
assert.equal(result.iceServers[1].username, "static-user");
assert.equal(result.iceServers[1].credential, "static-pass");

console.log("ice OK");
