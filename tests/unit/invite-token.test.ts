import { describe, expect, it } from "vitest";
import { digestClaimSecret, digestInviteToken, generateClaimSecret, generateInviteToken } from "@/lib/invite-token";

// Pure logic — no Supabase, so this runs in the `unit` project with Docker down.
describe("invite token", () => {
  it("mints a URL-safe token with 256 bits of entropy", () => {
    const token = generateInviteToken();

    // 32 bytes base64-encoded is 44 chars with padding; base64url drops the trailing "=".
    expect(token).toHaveLength(43);
    // No "+", "/" or "=" — the value goes straight into a path segment.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("mints a different token every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
  });

  it("digests to stable hex SHA-256", async () => {
    // Known vector: sha256("abc"). If the encoding ever drifts, this catches it before the
    // database disagrees.
    await expect(digestInviteToken("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic for a given token and distinct across tokens", async () => {
    const token = generateInviteToken();
    const [first, second] = await Promise.all([digestInviteToken(token), digestInviteToken(token)]);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await expect(digestInviteToken(generateInviteToken())).resolves.not.toBe(first);
  });
});

// The caretaker capability secret (S-03) reuses the token primitive on purpose. These
// assertions are what keeps that reuse honest: if either name is ever re-implemented rather
// than aliased, "byte-identical to what Postgres computes" stops being true silently, and the
// only symptom would be a claim secret that never matches its stored digest.
describe("claim capability secret", () => {
  it("mints the same 43-character base64url shape as an invite token", () => {
    const secret = generateClaimSecret();

    expect(secret).toHaveLength(43);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("mints a different secret every time", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateClaimSecret()));
    expect(secrets.size).toBe(50);
  });

  it("digests to the same hex SHA-256 the database computes", async () => {
    // Same known vector as the token above: sha256("abc"). The database side is
    // encode(sha256(convert_to(x, 'UTF8')), 'hex'), and care_slots_claim_digest_format pins
    // the column to exactly this shape.
    await expect(digestClaimSecret("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );

    const secret = generateClaimSecret();
    await expect(digestClaimSecret(secret)).resolves.toMatch(/^[0-9a-f]{64}$/);
    // Not merely "looks the same" — the two names must resolve to one implementation.
    await expect(digestClaimSecret(secret)).resolves.toBe(await digestInviteToken(secret));
  });
});
