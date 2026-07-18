import crypto from "node:crypto";

// Google access/refresh tokens are the only truly sensitive thing stored. We
// encrypt them at rest so a leaked database file is useless on its own. The key
// comes from ENCRYPTION_KEY (preferred) or falls back to JWT_SECRET, so it works
// out of the box. Note: this protects the database at rest — it is not a defense
// against someone who already has full access to the running server.
const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "dreamcatcher-local-dev-key";
const key = crypto.createHash("sha256").update(secret).digest(); // 32 bytes
const PREFIX = "v1.";

export function encrypt(plain: string | null): string | null {
  if (plain == null) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, ct].map((b) => b.toString("base64")).join(".");
}

export function decrypt(value: string | null): string | null {
  if (value == null || !value.startsWith(PREFIX)) return value; // null or legacy plaintext
  try {
    const [ivB, tagB, ctB] = value.slice(PREFIX.length).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null; // wrong key or tampered data
  }
}
