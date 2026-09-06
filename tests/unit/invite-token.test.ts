import { describe, expect, it } from "vitest";
import { digestInviteToken, generateInviteToken } from "@/lib/invite-token";

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
