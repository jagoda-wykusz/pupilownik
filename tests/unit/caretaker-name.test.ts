import { describe, expect, it } from "vitest";
import {
  groupCaretakers,
  normalizeCaretakerName,
  STORED_NAME_MAX,
  UNNAMED_CARETAKER_LABEL,
  type ClaimedSlotInput,
} from "@/lib/caretaker-name";

// Display-side handling for the one string in this product that an unauthenticated caller
// writes and an authenticated screen renders. Runs in the `unit` project — no Supabase.
//
// Hostile inputs are built with String.fromCodePoint rather than pasted as literals. Every
// character under test is invisible, so a literal would make these assertions unreviewable and
// a mangled paste would silently weaken them.
const ch = (codePoint: number) => String.fromCodePoint(codePoint);

const ZWSP = ch(0x200b);
const RLO = ch(0x202e);
const BOM = ch(0xfeff);
const NBSP = ch(0x00a0);
const TAB = ch(0x09);
const NEWLINE = ch(0x0a);

describe("normalizeCaretakerName", () => {
  it("leaves an ordinary name untouched", () => {
    expect(normalizeCaretakerName("Ania")).toBe("Ania");
    expect(normalizeCaretakerName("Anna Kowalska-Nowak")).toBe("Anna Kowalska-Nowak");
  });

  it("trims the Unicode whitespace btrim does not", () => {
    // Postgres btrim() with no second argument strips U+0020 and nothing else, so each of
    // these reaches the database with the padding intact.
    expect(normalizeCaretakerName(`${NBSP}Ania${NBSP}`)).toBe("Ania");
    expect(normalizeCaretakerName(`${TAB}Ania${NEWLINE}`)).toBe("Ania");
  });

  it("collapses interior whitespace runs to a single space", () => {
    expect(normalizeCaretakerName("Ania    Kowalska")).toBe("Ania Kowalska");
    // A control becomes a space rather than vanishing — the two words must not merge.
    expect(normalizeCaretakerName(`Ania${TAB}Kowalska`)).toBe("Ania Kowalska");
    expect(normalizeCaretakerName(`Ania${NEWLINE}${NEWLINE}Kowalska`)).toBe("Ania Kowalska");
  });

  it("returns null for a name that renders as nothing", () => {
    // Each of these is non-empty, under 80 characters, and passes claim_slots' guard, so each
    // is storable through a direct RPC call and may already sit in the table.
    expect(normalizeCaretakerName(TAB)).toBeNull();
    expect(normalizeCaretakerName(NBSP)).toBeNull();
    expect(normalizeCaretakerName(ZWSP)).toBeNull();
    expect(normalizeCaretakerName(ZWSP.repeat(STORED_NAME_MAX))).toBeNull();
    expect(normalizeCaretakerName(BOM)).toBeNull();
    expect(normalizeCaretakerName("")).toBeNull();
    expect(normalizeCaretakerName(null)).toBeNull();
  });

  it("strips bidi overrides so a name cannot reverse the line it sits on", () => {
    expect(normalizeCaretakerName(`Ania${RLO}Kowalska`)).toBe("AniaKowalska");
    expect(normalizeCaretakerName(`${RLO}Ania`)).toBe("Ania");
  });

  it("strips zero-width characters without merging or splitting words", () => {
    // Removed outright, not replaced by a space: a ZWSP is never a word break.
    expect(normalizeCaretakerName(`An${ZWSP}ia`)).toBe("Ania");
  });

  it("preserves a name at the stored maximum length", () => {
    const longest = "a".repeat(STORED_NAME_MAX);
    expect(normalizeCaretakerName(longest)).toBe(longest);
    expect(normalizeCaretakerName(longest)).toHaveLength(STORED_NAME_MAX);
  });

  it("keeps Polish characters and astral-plane codepoints intact", () => {
    expect(normalizeCaretakerName("Zażółć gęślą jaźń")).toBe("Zażółć gęślą jaźń");
    // Iterating by codepoint rather than UTF-16 unit — a surrogate pair must survive whole.
    const emoji = ch(0x1f436);
    expect(normalizeCaretakerName(`Ania ${emoji}`)).toBe(`Ania ${emoji}`);
  });
});

describe("groupCaretakers", () => {
  const slot = (over: Partial<ClaimedSlotInput> & { id: string }): ClaimedSlotInput => ({
    claimed_by_name: null,
    claim_digest: null,
    claimed_at: null,
    ...over,
  });

  const DIGEST_A = "a".repeat(64);
  const DIGEST_B = "b".repeat(64);
  const DIGEST_C = "c".repeat(64);

  it("leaves every ordinal null when no two caretakers share a name", () => {
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
      slot({ id: "s2", claimed_by_name: "Basia", claim_digest: DIGEST_B, claimed_at: "2026-11-01T09:00:00Z" }),
    ]);

    expect(bySlotId.get("s1")).toEqual({ label: "Ania", ordinal: null });
    expect(bySlotId.get("s2")).toEqual({ label: "Basia", ordinal: null });
    expect(caretakerCount).toBe(2);
  });

  it("numbers two distinct capabilities that share a name, in claim order", () => {
    // The case the schema permits and cannot prevent: two people following the same forwarded
    // link both type "Ania". Rendering them as one person is the wrong answer.
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s2", claimed_by_name: "Ania", claim_digest: DIGEST_B, claimed_at: "2026-11-02T09:00:00Z" }),
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    expect(bySlotId.get("s1")).toEqual({ label: "Ania", ordinal: 1 });
    expect(bySlotId.get("s2")).toEqual({ label: "Ania", ordinal: 2 });
    expect(caretakerCount).toBe(2);
  });

  it("counts one capability once however many terms it holds, and gives it no ordinal", () => {
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
      slot({ id: "s2", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T09:00:00Z" }),
      slot({ id: "s3", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-02T08:00:00Z" }),
    ]);

    expect(caretakerCount).toBe(1);
    for (const id of ["s1", "s2", "s3"]) {
      expect(bySlotId.get(id)).toEqual({ label: "Ania", ordinal: null });
    }
  });

  it("collides names that differ only by invisible characters", () => {
    // Without normalisation these are two distinct strings and the page would show two
    // apparently identical names with no ordinal to tell them apart — the worst outcome.
    const { bySlotId } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
      slot({
        id: "s2",
        claimed_by_name: `An${ZWSP}ia${NBSP}`,
        claim_digest: DIGEST_B,
        claimed_at: "2026-11-01T09:00:00Z",
      }),
    ]);

    expect(bySlotId.get("s1")).toEqual({ label: "Ania", ordinal: 1 });
    expect(bySlotId.get("s2")).toEqual({ label: "Ania", ordinal: 2 });
  });

  it("falls back to a neutral label when a name normalises to nothing", () => {
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: ZWSP, claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    expect(bySlotId.get("s1")).toEqual({ label: UNNAMED_CARETAKER_LABEL, ordinal: null });
    expect(caretakerCount).toBe(1);
  });

  it("keeps one capability to one label even when the stored names disagree", () => {
    // Reachable without an owner UPDATE: claim_slots looks the stored name up with a plain
    // read and no lock, so two concurrent FIRST claims on the same secret each write their own.
    // Earliest claim wins, matching the `order by s.claimed_at, s.id` claim_slots settled on.
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s2", claimed_by_name: "Basia", claim_digest: DIGEST_A, claimed_at: "2026-11-01T09:00:00Z" }),
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    expect(caretakerCount).toBe(1);
    expect(bySlotId.get("s1")?.label).toBe("Ania");
    expect(bySlotId.get("s2")?.label).toBe("Ania");
  });

  it("ignores free slots entirely", () => {
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "free" }),
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    expect(bySlotId.has("free")).toBe(false);
    expect(caretakerCount).toBe(1);
  });

  it("returns an empty grouping for a period nobody has claimed", () => {
    const { bySlotId, caretakerCount } = groupCaretakers([slot({ id: "a" }), slot({ id: "b" })]);

    expect(bySlotId.size).toBe(0);
    expect(caretakerCount).toBe(0);
  });

  it("never carries a digest in its output", () => {
    // The structural guarantee that keeps claim_digest off the page. The migration that
    // introduced the current claim scheme names "S-04's occupancy payload" as the disclosure
    // to avoid; this asserts the shape rather than trusting a later reader to remember.
    const { bySlotId } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_C, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    const entry = bySlotId.get("s1");
    expect(Object.keys(entry ?? {}).sort()).toEqual(["label", "ordinal"]);
    expect(JSON.stringify(entry)).not.toContain(DIGEST_C);
    expect(JSON.stringify([...bySlotId])).not.toMatch(/[0-9a-f]{64}/);
  });
});
