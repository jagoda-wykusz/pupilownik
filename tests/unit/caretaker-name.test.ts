import { describe, expect, it } from "vitest";
import {
  groupCaretakers,
  normalizeCaretakerName,
  UNNAMED_CARETAKER_LABEL,
  type ClaimedSlotInput,
} from "@/lib/caretaker-name";
// The 80-character bound has ONE home: period-format.ts, whose own comment says "change one
// and you must change both" about the guard inside claim_slots. A second copy here would have
// made it three.
import { MAX_CLAIMANT_NAME_LENGTH } from "@/lib/period-format";

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
    expect(normalizeCaretakerName(ZWSP.repeat(MAX_CLAIMANT_NAME_LENGTH))).toBeNull();
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

  it("removes the invisible characters a hand-written range table missed", () => {
    // Every one of these survived the first implementation and rendered blank or deceptively.
    // They are the reason this module classifies by Unicode property rather than by a table.
    const HANGUL_FILLER = ch(0x3164);
    const SOFT_HYPHEN = ch(0x00ad);
    const ARABIC_LETTER_MARK = ch(0x061c);
    const VARIATION_SELECTOR = ch(0xfe0f);
    const TAG_LATIN_A = ch(0xe0041);
    const BRAILLE_BLANK = ch(0x2800);
    const INTERLINEAR = ch(0xfff9);

    expect(normalizeCaretakerName(HANGUL_FILLER.repeat(3))).toBeNull();
    expect(normalizeCaretakerName(BRAILLE_BLANK.repeat(3))).toBeNull();
    expect(normalizeCaretakerName(INTERLINEAR)).toBeNull();
    // A soft-hyphenated name must key identically to the plain one, or it evades the ordinal.
    expect(normalizeCaretakerName(`A${SOFT_HYPHEN}n${SOFT_HYPHEN}ia`)).toBe("Ania");
    expect(normalizeCaretakerName(`Ania${ARABIC_LETTER_MARK}`)).toBe("Ania");
    expect(normalizeCaretakerName(`Ania${VARIATION_SELECTOR}`)).toBe("Ania");
    // Tag characters are the hidden-text smuggling channel: arbitrary ASCII, invisible.
    expect(normalizeCaretakerName(`Ania${TAG_LATIN_A}`)).toBe("Ania");
  });

  it("composes accents so one rendered name is one key", () => {
    // "e" + combining acute and precomposed "é" render identically. Without NFC they are two
    // Map keys, so two caretakers would show as one name with no ordinal to separate them.
    const decomposed = `Ren${"e" + ch(0x0301)}`;
    const precomposed = `Ren${ch(0x00e9)}`;
    expect(normalizeCaretakerName(decomposed)).toBe(normalizeCaretakerName(precomposed));
  });

  it("preserves a name at the stored maximum length", () => {
    const longest = "a".repeat(MAX_CLAIMANT_NAME_LENGTH);
    expect(normalizeCaretakerName(longest)).toBe(longest);
    expect(normalizeCaretakerName(longest)).toHaveLength(MAX_CLAIMANT_NAME_LENGTH);
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

  it("breaks a claimed_at tie on id, which is the COMMON path not an edge case", () => {
    // claim_slots writes every slot of one claim in a single transaction with a single now(),
    // so equal claimed_at is normal. This tie-break is what makes ordinals stable, and it is
    // ordered by codepoint rather than locale collation for the same reason.
    const shared = "2026-11-01T08:00:00Z";
    const { bySlotId } = groupCaretakers([
      slot({ id: "s2", claimed_by_name: "Ania", claim_digest: DIGEST_B, claimed_at: shared }),
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: shared }),
    ]);

    expect(bySlotId.get("s1")?.ordinal).toBe(1);
    expect(bySlotId.get("s2")?.ordinal).toBe(2);
  });

  it("numbers a three-way collision 1, 2, 3", () => {
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
      slot({ id: "s2", claimed_by_name: "Ania", claim_digest: DIGEST_B, claimed_at: "2026-11-01T09:00:00Z" }),
      slot({ id: "s3", claimed_by_name: "Ania", claim_digest: DIGEST_C, claimed_at: "2026-11-01T10:00:00Z" }),
    ]);

    expect([bySlotId.get("s1")?.ordinal, bySlotId.get("s2")?.ordinal, bySlotId.get("s3")?.ordinal]).toEqual([1, 2, 3]);
    expect(caretakerCount).toBe(3);
  });

  it("falls back for an empty stored name, not just an invisible one", () => {
    const { bySlotId } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "", claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    expect(bySlotId.get("s1")).toEqual({ label: UNNAMED_CARETAKER_LABEL, ordinal: null });
  });

  it("tolerates a digest with no claimed_at, which only a direct owner UPDATE can produce", () => {
    // care_slots_claim_complete ties the three columns, so this is unreachable through any
    // function — but contract-surfaces.md records that the owner's table grant can break that
    // invariant, and this page is where they would see the result.
    const { bySlotId, caretakerCount } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: "Ania", claim_digest: DIGEST_A, claimed_at: null }),
    ]);

    expect(bySlotId.get("s1")).toEqual({ label: "Ania", ordinal: null });
    expect(caretakerCount).toBe(1);
  });

  it("passes an over-length name through, because display truncation owns that", () => {
    // Reachable only by a direct owner UPDATE — claim_slots raises past 80. The helper does not
    // enforce the bound: the page clips with CSS and keeps the whole value in `title`.
    const overlong = "a".repeat(MAX_CLAIMANT_NAME_LENGTH + 20);
    const { bySlotId } = groupCaretakers([
      slot({ id: "s1", claimed_by_name: overlong, claim_digest: DIGEST_A, claimed_at: "2026-11-01T08:00:00Z" }),
    ]);

    expect(bySlotId.get("s1")?.label).toHaveLength(MAX_CLAIMANT_NAME_LENGTH + 20);
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
