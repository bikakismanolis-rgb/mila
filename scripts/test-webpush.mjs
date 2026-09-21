// Έλεγχος της κρυπτογράφησης Web Push της Edge Function «push», χωρίς δίκτυο.
//
//   node scripts/test-webpush.mjs        (Node 22.18+, διαβάζει απευθείας το .ts)
//
// 1. Το επίσημο παράδειγμα του RFC 8291 (Appendix A): με τα ίδια κλειδιά και το
//    ίδιο salt πρέπει να βγει ΑΚΡΙΒΩΣ το ίδιο αποτέλεσμα, byte προς byte.
// 2. Κύκλος με τυχαία κλειδιά: κρυπτογραφούμε όπως ο server και
//    αποκρυπτογραφούμε όπως θα έκανε ο browser, με ανεξάρτητο κώδικα.
// 3. Η υπογραφή VAPID επαληθεύεται με το δημόσιο κλειδί.
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  endpointAllowed,
  generateVapid,
  vapidAuthorization,
} from "../supabase/functions/push/index.ts";

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok || !extra ? "" : "\n       " + extra}`);
  if (!ok) failed++;
};
const te = new TextEncoder();
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
const jwkFromRaw = (raw, d) => ({ kty: "EC", crv: "P-256", x: b64urlEncode(raw.slice(1, 33)), y: b64urlEncode(raw.slice(33, 65)), ...(d ? { d } : {}), ext: true });

/** Η πλευρά του browser (RFC 8291 §3.4), γραμμένη ξεχωριστά από τον server. */
async function decryptAsBrowser(body, uaPublicRaw, uaPrivateD, authSecret) {
  const salt = body.slice(0, 16), idlen = body[20];
  const asPublicRaw = body.slice(21, 21 + idlen), ciphertext = body.slice(21 + idlen);
  const uaPrivate = await crypto.subtle.importKey("jwk", jwkFromRaw(uaPublicRaw, uaPrivateD), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asPublic = await crypto.subtle.importKey("jwk", jwkFromRaw(asPublicRaw), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asPublic }, uaPrivate, 256));
  const one = new Uint8Array([1]);
  const ikm = await hmac(await hmac(authSecret, shared), cat(te.encode("WebPush: info\0"), uaPublicRaw, asPublicRaw, one));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(te.encode("Content-Encoding: aes128gcm\0"), one))).slice(0, 16);
  const nonce = (await hmac(prk, cat(te.encode("Content-Encoding: nonce\0"), one))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  let end = plain.length - 1; while (plain[end] === 0) end--;          // padding
  if (plain[end] !== 2) throw new Error("missing last-record delimiter");
  return new TextDecoder().decode(plain.slice(0, end));
}

console.log("[RFC 8291, Appendix A]");
{
  const asPublic = b64urlDecode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const uaPublic = b64urlDecode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
  const expected = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
  const body = await encryptPayload(
    te.encode("When I grow up, I want to be a watermelon"),
    uaPublic,
    b64urlDecode("BTBZMqHH6r4Tts7J_aSIgg"),
    { salt: b64urlDecode("DGv6ra1nlYgDCS1FRnbzlw"), serverKeys: { publicRaw: asPublic, privateJwk: jwkFromRaw(asPublic, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") } },
  );
  check("ίδιο αποτέλεσμα με το RFC, byte προς byte", b64urlEncode(body) === expected, `got ${b64urlEncode(body)}`);
  const back = await decryptAsBrowser(b64urlDecode(expected), uaPublic, "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94", b64urlDecode("BTBZMqHH6r4Tts7J_aSIgg"));
  check("ο «browser» των tests αποκρυπτογραφεί το παράδειγμα του RFC", back === "When I grow up, I want to be a watermelon", back);
}

console.log("[κύκλος με τυχαία κλειδιά]");
{
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const uaD = (await crypto.subtle.exportKey("jwk", ua.privateKey)).d;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = JSON.stringify({ title: "Μπάμπης", body: "Γεια σου! 👋 Θα έρθεις το Σάββατο;", conversationId: "abc" });
  const one = await encryptPayload(te.encode(message), uaPublic, auth);
  const two = await encryptPayload(te.encode(message), uaPublic, auth);
  check("ελληνικά + emoji επιστρέφουν αυτούσια", (await decryptAsBrowser(one, uaPublic, uaD, auth)) === message);
  check("κάθε αποστολή έχει άλλο salt και άλλο κλειδί (δύο ίδια μηνύματα ≠ ίδια bytes)", b64urlEncode(one) !== b64urlEncode(two));
  const wrongAuth = crypto.getRandomValues(new Uint8Array(16));
  check("με λάθος auth ΔΕΝ αποκρυπτογραφείται", await decryptAsBrowser(one, uaPublic, uaD, wrongAuth).then(() => false, () => true));
}

console.log("[VAPID]");
{
  const vapid = await generateVapid();
  check("δημόσιο κλειδί 65 bytes, μη συμπιεσμένο", b64urlDecode(vapid.publicKey).length === 65 && b64urlDecode(vapid.publicKey)[0] === 4);
  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc123", vapid, "mailto:noreply@milamessenger.com", 1_800_000_000);
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/) || [];
  const [h, c, s] = token.split(".");
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
  check("aud = origin της υπηρεσίας push, exp ≤ 24 ώρες, sub mailto", claims.aud === "https://fcm.googleapis.com" && claims.exp - 1_800_000_000 <= 86400 && claims.sub.startsWith("mailto:"), JSON.stringify(claims));
  check("k = το δημόσιο κλειδί", key === vapid.publicKey);
  const pub = await crypto.subtle.importKey("jwk", jwkFromRaw(b64urlDecode(vapid.publicKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  check("η υπογραφή ES256 επαληθεύεται", await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(s), te.encode(`${h}.${c}`)));
}

console.log("[επιτρεπόμενες διευθύνσεις]");
check("Chrome/Android (FCM)", endpointAllowed("https://fcm.googleapis.com/fcm/send/x"));
check("Firefox", endpointAllowed("https://updates.push.services.mozilla.com/wpush/v2/x"));
check("Safari/iOS", endpointAllowed("https://web.push.apple.com/x"));
check("Edge/Windows", endpointAllowed("https://db5p.notify.windows.com/w/?token=x"));
check("αυθαίρετη διεύθυνση απορρίπτεται", !endpointAllowed("https://evil.example.com/fcm.googleapis.com"));
check("μοιάζει-αλλά-δεν-είναι απορρίπτεται", !endpointAllowed("https://fcm.googleapis.com.evil.example/x"));
check("http απορρίπτεται", !endpointAllowed("http://fcm.googleapis.com/x"));

console.log(failed ? `\nFAILED: ${failed}` : "\nALL OK");
process.exit(failed ? 1 : 0);
