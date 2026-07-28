// Prototype boundary only. This deliberately does not claim Signal/MLS properties.
const enc = new TextEncoder(),
  dec = new TextDecoder();
const b64 = (b: BufferSource) => {
  const bytes =
    b instanceof ArrayBuffer
      ? new Uint8Array(b)
      : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return btoa(String.fromCharCode(...bytes));
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function keyFor(id: string) {
  let raw = localStorage.getItem(`em:key:${id}`);
  if (!raw) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    raw = b64(bytes);
    localStorage.setItem(`em:key:${id}`, raw);
  }
  return crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptLocal(conversationId: string, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    key = await keyFor(conversationId),
    body = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(text),
    );
  return { body: b64(body), iv: b64(iv) };
}
export async function decryptLocal(
  conversationId: string,
  body: string,
  iv: string,
) {
  try {
    const key = await keyFor(conversationId),
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(iv) },
        key,
        unb64(body),
      );
    return dec.decode(plain);
  } catch {
    return "🔒 Encrypted on another device";
  }
}
