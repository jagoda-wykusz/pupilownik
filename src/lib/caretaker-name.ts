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
// set:html — src/lib/claim-cookie.ts:23 depends on that staying true). The risks this module
// answers are: a name that renders as nothing, a name that reverses the line it sits on, and a
// name the owner reads as a different person than it is.
//
// Pure and dependency-free, like period-format.ts, so it unit-tests without a database.
//
// Characters are classified by NUMERIC CODEPOINT rather than by a regex character class, and
// that is deliberate. Every character this module exists to remove is invisible in an editor,
// so a literal class would be unreviewable — you cannot tell a correct one from a broken one by
// looking. Numbers you can check against a table.

/** Upper bound the database actually enforces, mirrored for the tests that pin the boundary. */
export const STORED_NAME_MAX = 80;

// Postgres `btrim(x)` with no second argument strips U+0020 and NOTHING else — verified in
// psql: tab, NBSP and ZWSP all survive it with length 1. So a name consisting of a single tab
// is non-empty, under the bound, and storable through a direct RPC call. Rows like that may
// already exist, which is why normalisation lives here at display time rather than in the write
// path: this is the only layer that can fix what is already stored.

/** Codepoints deleted outright — they are never a word break. */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200d], // zero-width space, ZWNJ, ZWJ
  [0x200e, 0x200f], // LRM, RLM
  [0x202a, 0x202e], // bidi embeddings and overrides — U+202E reverses the rest of the run
  [0x2060, 0x2060], // word joiner
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];

/**
 * Codepoints replaced by a space. C0 and C1 controls, so tab and newline included — newline
 * matters twice over, because the owner's own note renders with `whitespace-pre-line` and if
 * that class is ever copied onto a caretaker name an 80-character string becomes 40 rows.
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
    if (inRanges(codePoint, INVISIBLE_RANGES)) {
      continue;
    }
    // A control becomes a space rather than vanishing, so "Ania<TAB>Kowalska" stays two words.
    out += inRanges(codePoint, CONTROL_RANGES) ? " " : character;
  }

  // JS `\s` covers the Unicode whitespace btrim does not — NBSP, the U+2000 block, U+3000.
  const collapsed = out.replace(/\s+/gu, " ").trim();

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
export function groupCaretakers(slots: ClaimedSlotInput[]): CaretakerGrouping {
  // Claim order, so both the chosen name per capability and the ordinals are stable across
  // reloads. A null claimed_at cannot occur beside a non-null digest (care_slots_claim_complete
  // ties them), but sorting defensively costs nothing.
  const claimed = slots
    .filter((slot) => slot.claim_digest !== null)
    .sort((a, b) => (a.claimed_at ?? "").localeCompare(b.claimed_at ?? "") || a.id.localeCompare(b.id));

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
