import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";

describe("token encryption", () => {
  it("round-trips a value", () => {
    const token = "ya29.some-google-access-token";
    const enc = encrypt(token);
    expect(enc).not.toBe(token);
    expect(enc?.startsWith("v1.")).toBe(true);
    expect(decrypt(enc)).toBe(token);
  });

  it("passes null through unchanged", () => {
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });

  it("leaves legacy plaintext (pre-encryption rows) readable", () => {
    // Old databases stored tokens in the clear; decrypt must return them as-is.
    expect(decrypt("plain-old-token")).toBe("plain-old-token");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });
});
