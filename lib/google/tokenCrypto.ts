import crypto from "crypto";

/**
 * At-rest encryption for the Google OAuth refresh token (AES-256-GCM,
 * Node built-in — no new dependency).
 *
 * Stored format: "enc:v1:" + base64(iv[12] | authTag[16] | ciphertext).
 * The version prefix means a future key/algorithm rotation can coexist
 * with old rows, and anything without the prefix (or that fails
 * authentication) simply decrypts to null — callers treat that as
 * "not connected" so Kelsey can reconnect rather than seeing a crash.
 *
 * The short-lived access token (1h) is deliberately NOT encrypted; only
 * the long-lived refresh token is worth protecting.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "Missing required environment variable: GOOGLE_TOKEN_ENCRYPTION_KEY"
    );
  }
  const key = Buffer.from(raw.trim(), "hex");
  if (key.length !== 32) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes) — generate with `openssl rand -hex 32`"
    );
  }
  return key;
}

/** Encrypt a token for storage. Throws when the key is missing/malformed. */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Decrypt a stored token. Returns null on ANY failure — missing key, wrong
 * key, tampered/truncated value, or a value that predates encryption.
 */
export function decryptToken(stored: string): string | null {
  try {
    if (!stored.startsWith(PREFIX)) return null;
    const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
    if (buf.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
