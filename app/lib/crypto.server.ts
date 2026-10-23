import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for courier and Meta secrets at rest. ENCRYPTION_KEY can be any long random
// string; it is stretched to 32 bytes with SHA256. Format: v1.<iv>.<tag>.<ciphertext> (base64url).

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("ENCRYPTION_KEY is missing or shorter than 16 characters");
  }
  return createHash("sha256").update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(".");
}

export function decrypt(token: string | null | undefined): string | null {
  if (!token) return null;
  const [v, iv, tag, data] = token.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Shows the last 4 characters of a stored secret so settings can say "connected (...a91f)". */
export function maskSecret(token: string | null | undefined): string | null {
  const plain = decrypt(token);
  if (!plain) return null;
  return plain.length <= 4 ? "****" : `****${plain.slice(-4)}`;
}

function pixelSecret(): string {
  return process.env.PIXEL_SECRET || process.env.SHOPIFY_API_SECRET || "dev-pixel-secret";
}

/** Per shop key the web pixel sends with every post, so random traffic cannot write signals. */
export function pixelKeyFor(shop: string): string {
  return createHmac("sha256", pixelSecret()).update(shop).digest("base64url").slice(0, 32);
}

export function verifyPixelKey(shop: string, provided: string | null | undefined): boolean {
  if (!provided) return false;
  const expected = Buffer.from(pixelKeyFor(shop));
  const got = Buffer.from(provided);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function stateKey(): string {
  return process.env.SHOPIFY_API_SECRET || process.env.ENCRYPTION_KEY || "dev-state-secret";
}

/** Short lived signed token that carries the shop through an OAuth round trip outside the Shopify iframe. */
export function signState(payload: Record<string, unknown>, ttlSeconds = 900): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState<T extends Record<string, unknown>>(state: string | null | undefined): T | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data as T;
  } catch {
    return null;
  }
}
