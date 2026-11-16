/**
 * Web Push on WebCrypto alone, so it runs the same in Supabase's Deno and in a Node test:
 * the payload is encrypted as RFC 8291 says (aes128gcm, one record), and the push service
 * is told who sends it by a VAPID token (RFC 8292). Nothing here reads the environment.
 */

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64u(text: string): Uint8Array {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob((text + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** The sender's key pair: the public half goes to browsers when they subscribe, the private half signs every send. */
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: b64u(raw), privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } };
}

/** The Authorization header for one push service: a token signed for that service's origin, valid for twelve hours. */
export async function vapidHeader(endpoint: string, keys: VapidKeys, subject: string): Promise<string> {
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto signs ECDSA as r‖s, which is the form a JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/**
 * The body of one push: salt ‖ record size ‖ the sender's one-time public key ‖ ciphertext.
 * `fixed` exists only for the RFC's test vector; a real send always draws a fresh key and salt.
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  auth: string,
  fixed?: { salt: Uint8Array; keys: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const server = fixed?.keys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", server.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, server.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\u0000"), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\u0000"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\u0000"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // One record, so the padding delimiter is 0x02 and nothing follows it.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher);
}
