// Test για την κρυπτογράφηση από άκρη σε άκρη (apps/web/src/e2ee.ts).
// Τρέξε από τη ρίζα του project:
//   node scripts/test-e2ee.mjs        (Node 22.18+, διαβάζει απευθείας το .ts)
//
// Ελέγχει ότι: ο παραλήπτης και ο αποστολέας διαβάζουν, όποιος δεν έχει κλειδί
// όχι, και ότι ο server δεν μπορεί να πειράξει τίποτα χωρίς να φανεί (να
// μετακινήσει το μήνυμα σε άλλη συνομιλία, να αλλάξει αποστολέα, να αλλάξει
// bytes, να δώσει το κλειδί μιας συσκευής σε άλλη). Και ότι τα σχήματα που
// βγάζει ο browser περνάνε τους ελέγχους της βάσης (0010).
import assert from "node:assert/strict";
import * as e from "../apps/web/src/e2ee.ts";


const alice = await e.loadOrCreateDevice("alice");
const bob = await e.loadOrCreateDevice("bob");
const eve = await e.loadOrCreateDevice("eve");
assert.equal(alice.publicKey.length, 87, "public key is 87 chars base64url");
assert.match(alice.publicKey, /^[A-Za-z0-9_-]{87}$/);
const A = await e.rememberDeviceId(alice, "dev-a");
const B = await e.rememberDeviceId(bob, "dev-b");
const E = await e.rememberDeviceId(eve, "dev-e");
assert.equal((await e.loadOrCreateDevice("alice")).publicKey, alice.publicKey, "same device after reload (memory fallback)");

const ctx = { conversationId: "conv-1", senderId: "alice", clientId: "client-1" };
const plain = { t: "Γεια σου Μπάμπη! 👋", f: { n: "photo.jpg", m: "image/jpeg", s: 1234, k: "kk", i: "ii" } };
const { envelope, keys } = await e.encryptMessage(A, ctx, plain, [
  { deviceId: "dev-a", publicKey: A.publicKey },
  { deviceId: "dev-b", publicKey: B.publicKey },
  { deviceId: "bad", publicKey: "A".repeat(87) },   // χαλασμένο κλειδί: παραλείπεται
]);
assert.equal(keys.length, 2, "broken recipient key skipped");
const env = JSON.parse(envelope);
assert.match(env.iv, /^[A-Za-z0-9_-]{16}$/, "iv shape matches the server check");
assert.ok(env.ct.length >= 22);
for (const k of keys) assert.match(k.key, /^[A-Za-z0-9_-]{40,200}$/, "wrapped key shape matches the server check");
assert.ok(!envelope.includes("Μπάμπη") && !envelope.includes("photo"), "no plaintext in envelope");

const e2ee = { v: 1, envelope, clientId: "client-1", senderKey: A.publicKey,
  keys: Object.fromEntries(keys.map(k => [k.device, k.key])) };

assert.deepEqual(await e.decryptMessage(B, "conv-1", "alice", e2ee), plain, "bob decrypts");
assert.deepEqual(await e.decryptMessage(A, "conv-1", "alice", e2ee), plain, "sender's own device decrypts");
assert.equal(await e.decryptMessage(E, "conv-1", "alice", e2ee), null, "eve has no key");
// Eve παίρνει το κλειδί του Bob (σαν να το έδινε ο server σε λάθος συσκευή)
assert.equal(await e.decryptMessage(E, "conv-1", "alice", { ...e2ee, keys: { "dev-e": e2ee.keys["dev-b"] } }), null, "key for another device is useless");
// Ο server μετακινεί το μήνυμα σε άλλη συνομιλία / αλλάζει αποστολέα / client id
assert.equal(await e.decryptMessage(B, "conv-2", "alice", e2ee), null, "moved conversation detected");
assert.equal(await e.decryptMessage(B, "conv-1", "mallory", e2ee), null, "changed sender detected");
assert.equal(await e.decryptMessage(B, "conv-1", "alice", { ...e2ee, clientId: "client-2" }), null, "changed client id detected");
// Ο server κολλάει το τυλιγμένο κλειδί σε ΑΛΛΟ ciphertext με το ίδιο content key; Δεν μπορεί να φτιάξει άλλο ciphertext χωρίς το κλειδί, αλλά ας αλλάξει ένα byte:
const tampered = JSON.stringify({ iv: env.iv, ct: env.ct.slice(0, -2) + (env.ct.endsWith("AA") ? "AB" : "AA") });
assert.equal(await e.decryptMessage(B, "conv-1", "alice", { ...e2ee, envelope: tampered }), null, "tampered ciphertext detected");
// Ο server λέει ότι το έστειλε η Eve (αλλάζει senderKey)
assert.equal(await e.decryptMessage(B, "conv-1", "alice", { ...e2ee, senderKey: E.publicKey }), null, "swapped sender key detected");

// Παράδοση αργότερα: η Alice έστειλε μόνο για τη δική της συσκευή, ο Bob
// απέκτησε συσκευή μετά. Η Alice ξανατυλίγει το κλειδί και ο Bob διαβάζει.
const solo = await e.encryptMessage(A, ctx, { t: "for later" }, [{ deviceId: "dev-a", publicKey: A.publicKey }]);
const later = await e.rewrapForDevices(A, ctx, solo.envelope, solo.keys[0].key, [{ deviceId: "dev-b", publicKey: B.publicKey }]);
assert.equal(later.length, 1);
assert.match(later[0].key, /^[A-Za-z0-9_-]{40,200}$/);
const soloBox = { v: 1, envelope: solo.envelope, clientId: "client-1", senderKey: A.publicKey, keys: { "dev-b": later[0].key } };
assert.equal((await e.decryptMessage(B, "conv-1", "alice", soloBox))?.t, "for later", "late delivery decrypts");
assert.equal(await e.decryptMessage(B, "conv-2", "alice", soloBox), null, "late key is bound to the conversation");
// Μόνο η συσκευή που το έστειλε μπορεί να το ξανατυλίξει.
await assert.rejects(e.rewrapForDevices(E, ctx, solo.envelope, solo.keys[0].key, [{ deviceId: "dev-b", publicKey: B.publicKey }]),
  "another device cannot rewrap");

// Μήκος: στρογγυλεμένο
const short = await e.encryptMessage(A, ctx, { t: "a" }, [{ deviceId: "dev-b", publicKey: B.publicKey }]);
const short2 = await e.encryptMessage(A, ctx, { t: "abcdefghij" }, [{ deviceId: "dev-b", publicKey: B.publicKey }]);
assert.equal(JSON.parse(short.envelope).ct.length, JSON.parse(short2.envelope).ct.length, "length is padded");

// Long Greek text near limit
const long = "α".repeat(8000);
const big = await e.encryptMessage(A, ctx, { t: long }, [{ deviceId: "dev-b", publicKey: B.publicKey }]);
assert.ok(big.envelope.length < 65536, "8000 Greek chars fit the server limit: " + big.envelope.length);
assert.equal((await e.decryptMessage(B, "conv-1", "alice", { ...e2ee, envelope: big.envelope, keys: { "dev-b": big.keys[0].key } }))?.t, long);

// Αρχεία
const data = new TextEncoder().encode("file contents ".repeat(1000)).buffer;
const enc = await e.encryptFile(data);
const back = await e.decryptFile(await enc.blob.arrayBuffer(), enc.key, enc.iv);
assert.deepEqual(new Uint8Array(back), new Uint8Array(data), "file roundtrip");
await assert.rejects(e.decryptFile(await enc.blob.arrayBuffer(), enc.key, e.toB64(new Uint8Array(12))), "wrong iv fails");

// Κωδικός ασφαλείας: ίδιος και από τις δύο πλευρές, αλλάζει με νέα συσκευή
const s1 = await e.safetyCode({ userId: "alice", keys: [A.publicKey] }, { userId: "bob", keys: [B.publicKey] });
const s2 = await e.safetyCode({ userId: "bob", keys: [B.publicKey] }, { userId: "alice", keys: [A.publicKey] });
assert.deepEqual(s1, s2); assert.equal(s1.length, 12); assert.ok(s1.every(g => /^\d{5}$/.test(g)));
const s3 = await e.safetyCode({ userId: "alice", keys: [A.publicKey, E.publicKey] }, { userId: "bob", keys: [B.publicKey] });
assert.notDeepEqual(s1, s3, "new device changes the code");
console.log("e2ee OK");
