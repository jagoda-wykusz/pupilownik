// Turning a stored caretaker name into something safe to put on the owner's screen, plus the
// per-period grouping that disambiguates two caretakers who typed the same thing.
//
// Why this module exists at all: `care_slots.claimed_by_name` is the first — and so far only —
// string in this product written by an UNAUTHENTICATED caller that is then rendered on an
// AUTHENTICATED screen. `claim_slots` is granted to `anon`, so `src/lib/schemas/claim.ts` is a
// UX layer, not a boundary, and the function body's whole validation is: btrim, reject empty,
// reject over 80 characters. There is no character class — unlike the `token` field on the same
// schema, which has one.
//
// XSS is NOT the risk here (Astro escapes every interpolation, and nothing in this repo uses
// set:html — the `__Host-` trade-off note in src/lib/claim-cookie.ts depends on that staying true). The risks this module
// answers are: a name that renders as nothing, a name that reverses the line it sits on, and a
// name the owner reads as a different person than it is.
//
// Pure and dependency-free, like period-format.ts, so it unit-tests without a database.
//
// Invisible characters are removed by Unicode PROPERTY, not by a hand-written table. The first
// cut of this module listed six numeric ranges on the grounds that a literal character class
// would be unreviewable — true, but a numeric table has the worse problem: it freezes one
// person's 2026 recollection of the invisible set. Measured against the shipped ranges, a name
// made of Hangul fillers, soft hyphens, Arabic letter marks, variation selectors, invisible
// operators or Unicode TAG characters all survived and rendered blank — the exact outcome this
// module exists to prevent, and in the tag-character case a channel for smuggling hidden text
// onto the owner's screen. `\p{Default_Ignorable_Code_Point}` covers every one of them, tracks
// the Unicode version instead of a snapshot, and is more reviewable than a table of hex, not
// less. Verified: it matches all six original ranges and none of the whitespace the collapse
// below relies on `\s` for (U+00A0, U+1680, U+2000-200A, U+2028/9, U+202F, U+205F, U+3000).
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

// The three blank-rendering characters the property does not reach: interlinear annotation
// marks and the Braille blank pattern, which is a printing character that happens to have no
// ink. Numeric because there is no property that groups them.
const EXTRA_INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0xfff9, 0xfffb], // interlinear annotation anchor / separator / terminator
  [0x2800, 0x2800], // Braille pattern blank
];

/**
 * Codepoints replaced by a space. C0 and C1 controls, so tab and newline included — newline
 * matters twice over, because the owner's own note renders with `whitespace-pre-line` and if
 * that class is ever copied onto a caretaker name an 80-character string becomes 40 rows.
 * Not covered by Default_Ignorable, and a word break rather than nothing, so kept separate.
 */
const CONTROL_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
];

function inRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([low, high]) => codePoint >= low && codePoint <= high);
}

/**
 * Reduce a stored caretaker name to something safe to render.
 *
 * Returns `null` when nothing survives — the signal for "this term is taken, but the name is
 * unusable". The page renders a neutral fallback for that rather than an empty cell, because
 * `care_slots_claim_complete` guarantees `claimed_at` is set whenever a name is, so "taken with
 * no readable name" is a real state and not a bug to hide.
 *
 * Known cosmetic cost, accepted deliberately: removing ZWJ and variation selectors degrades
 * emoji sequences to their component glyphs in text presentation. A name is still a name after
 * that, whereas an unstripped tag-character run is invisible smuggled text.
 */
export function normalizeCaretakerName(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }

  let out = "";
  // for..of iterates by codepoint, not by UTF-16 unit, so an astral-plane character is not
  // split into surrogates that then fail the range checks.
  for (const character of raw) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (inRanges(codePoint, EXTRA_INVISIBLE_RANGES)) {
      continue;
    }
    // A control becomes a space rather than vanishing, so "Ania<TAB>Kowalska" stays two words.
    out += inRanges(codePoint, CONTROL_RANGES) ? " " : character;
  }

  // Strip BEFORE composing: a combining grapheme joiner sits between a base and its accent
  // precisely to block composition, so removing it first is what lets NFC do its job.
  //
  // NFC matters because grouping keys on this string. Without it "e" + U+0301 and U+00E9 are
  // two different Map keys rendering as one identical "é" — two caretakers shown as one with
  // no ordinal, which is the worst outcome this module has.
  const composed = out.replace(DEFAULT_IGNORABLE, "").normalize("NFC");

  // JS `\s` covers the Unicode whitespace btrim does not — NBSP, U+1680, the U+2000 block,
  // U+2028/9, U+202F, U+205F, U+3000.
  const collapsed = composed.replace(/\s+/gu, " ").trim();

  return collapsed === "" ? null : collapsed;
}

/** What the page renders for a claimed term whose name normalises to nothing. */
export const UNNAMED_CARETAKER_LABEL = "bez imienia";

/** A claimed slot, reduced to the fields grouping needs. */
export interface ClaimedSlotInput {
  id: string;
  claimed_by_name: string | null;
  claim_digest: string | null;
  /** Orders the ordinals so a reload is stable. */
  claimed_at: string | null;
}

/**
 * What the page may render for one claimed term.
 *
 * Deliberately carries NO digest. That is the whole point of the type: grouping needs
 * `claim_digest` as input, and reading it in Astro frontmatter is fine because that runs on the
 * server — but Astro serializes island props into the HTML, so the moment a digest reaches a
 * prop or an attribute it is disclosed. `20260907171514_claim_secret_not_digest.sql:14-19` names
 * "S-04's occupancy payload" verbatim as the disclosure to avoid. Making the digest absent from
 * the OUTPUT type turns that leak into a type error instead of a review catch.
 */
export interface CaretakerLabel {
  /** Already normalised, already falling back to UNNAMED_CARETAKER_LABEL. Safe to render. */
  label: string;
  /** 1-based, and set ONLY when another distinct capability shares this label. */
  ordinal: number | null;
}

export interface CaretakerGrouping {
  bySlotId: Map<string, CaretakerLabel>;
  /** Distinct capabilities holding at least one term in this period. */
  caretakerCount: number;
}

/**
 * Group a period's claimed slots by capability, and number the labels that collide.
 *
 * Two things the schema does not hold, both of which this has to cope with rather than assume
 * away. First, two different capabilities can carry the same name: nothing constrains
 * `claimed_by_name` — no uniqueness, no FK, no verification — so two people following the same
 * forwarded link can both be "Ania" and only their digests differ. Showing them as one person
 * is the wrong answer on the screen the PRD leans on for "właściciel widzi obsadę i może
 * reagować", so a colliding label gets an ordinal.
 *
 * Second, one capability can carry two names. `claim_slots` reuses the stored name on a
 * follow-up claim, but its lookup is a plain read with no lock, so two concurrent FIRST claims
 * presenting the same secret can each write their own — and a direct owner UPDATE can do it
 * too. Grouping is therefore keyed on the digest and takes the first name in claim order,
 * matching the `order by s.claimed_at, s.id` that `claim_slots` itself settled on.
 *
 * Ordinals are per-render and mean nothing outside this page. That is a real limitation, not an
 * oversight: there is no stable caretaker identity in this product to number.
 */
// Plain codepoint order, deliberately NOT localeCompare. These are machine strings — ISO-8601
// timestamps and uuids — where codepoint order IS the correct order. localeCompare with no
// locale argument resolves the HOST default locale and uses whatever ICU the Node build ships,
// and ICU applies variable weighting to exactly the punctuation these strings are made of
// (`-`, `:`, `.`, `+`). The ordinals below are meant to be stable across reloads; "stable until
// someone upgrades Node" is not that, and there was never anything to gain here.
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function groupCaretakers(slots: ClaimedSlotInput[]): CaretakerGrouping {
  // Claim order, so both the chosen name per capability and the ordinals are stable across
  // reloads. A null claimed_at cannot occur beside a non-null digest (care_slots_claim_complete
  // ties them), but sorting defensively costs nothing.
  const claimed = slots
    .filter((slot) => slot.claim_digest !== null)
    .sort((a, b) => byCodePoint(a.claimed_at ?? "", b.claimed_at ?? "") || byCodePoint(a.id, b.id));

  // digest -> the label that capability shows, fixed by its earliest claim.
  const labelByDigest = new Map<string, string>();
  for (const slot of claimed) {
    const digest = slot.claim_digest;
    if (digest === null || labelByDigest.has(digest)) {
      continue;
    }
    labelByDigest.set(digest, normalizeCaretakerName(slot.claimed_by_name) ?? UNNAMED_CARETAKER_LABEL);
  }

  // A label is ambiguous only when two DISTINCT capabilities wear it. One capability across
  // five terms is one caretaker and gets no ordinal.
  const digestsByLabel = new Map<string, string[]>();
  for (const [digest, label] of labelByDigest) {
    const digests = digestsByLabel.get(label) ?? [];
    digests.push(digest);
    digestsByLabel.set(label, digests);
  }

  const ordinalByDigest = new Map<string, number>();
  for (const digests of digestsByLabel.values()) {
    if (digests.length < 2) {
      continue;
    }
    digests.forEach((digest, index) => {
      ordinalByDigest.set(digest, index + 1);
    });
  }

  const bySlotId = new Map<string, CaretakerLabel>();
  for (const slot of claimed) {
    const digest = slot.claim_digest;
    if (digest === null) {
      continue;
    }
    bySlotId.set(slot.id, {
      label: labelByDigest.get(digest) ?? UNNAMED_CARETAKER_LABEL,
      ordinal: ordinalByDigest.get(digest) ?? null,
    });
  }

  return { bySlotId, caretakerCount: labelByDigest.size };
}
