# Caretaker Claims Slot — Plan Brief

> Full plan: `context/changes/caretaker-claims-slot/plan.md`
> Research: `context/changes/caretaker-claims-slot/research.md`

## What & Why

A caretaker holding an invite link can select free care slots and claim them, giving their name
once — and only then does the sensitive half of the care instructions (address, access codes)
become visible to them. This is roadmap slice S-03, the north star: the smallest end-to-end
path whose delivery proves the product works, and the one thing PRD's Primary success criterion
asks for ("at least one caretaker signs up for a slot on their own").

## Starting Point

The caretaker page (`src/pages/invite/[token].astro`) already resolves an invite token and
renders a read-only day list — it ends with an explicit placeholder saying claiming is S-03.
The database is unusually well-prepared: S-02 shipped `care_slots_claim_complete`, which makes
`claimed_by_name is null` a _truthful_ freeness test, and the prescribed atomic claim statement
is already written in a schema comment. S-08 shipped `care_period_pets`, so a period can reach
its pets' instructions at all. What is missing is every write path, the instruction reveal, and
any caretaker-side interactivity.

## Desired End State

Opening a valid link shows the trip's pets, their public instructions, and a month grid of the
period with per-slot free/taken dots. The caretaker selects slots, types a name once, and
submits; either the whole selection lands or none of it does, and a slot taken in the meantime
produces a refusal naming the conflicting term. After claiming they see how many days they
hold, the full instruction list including the sensitive tier, and the trip's caretaker note. A
second claim from the same browser adds slots without re-asking the name; a different browser
sees the pre-claim view.

## Key Decisions Made

| Decision                      | Choice                                              | Why (1 sentence)                                                                                     | Source        |
| ----------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| Unit of the reveal            | Per **claimer**, not per claim event                | The design's "Masz 2 dni" screen cannot be rendered without per-person state.                        | Research (D1) |
| Period ↔ pet relation         | Separate change, shipped first                      | Kept S-03's outcome whole instead of splitting a must-have FR across two slices.                     | Research (D2) |
| Function topology             | Three functions                                     | `get_period_by_token` is `STABLE`, so Postgres forbids extending it to write.                        | Research      |
| Name input (FR-009 vs design) | Asked once, then one-tap                            | Satisfies must-have FR-009 and explains the design as the state _after_ a first claim.               | Plan          |
| Claim granularity             | Multi-select, one submit                            | One round trip on a phone beats three.                                                               | Plan          |
| Multi-slot semantics          | All-or-nothing, naming the conflict                 | Keeps the claim a single `UPDATE`, so S-02's atomicity guarantee carries over unchanged.             | Plan          |
| Transport                     | JSON `fetch` + explicit `Origin` check              | Astro's `checkOrigin` deliberately skips `application/json`, so the framework protects nothing here. | Plan          |
| Capability lifetime           | Cookie until period end + buffer                    | The caretaker needs the address on the day of care, often weeks after claiming.                      | Plan          |
| Capability storage            | `claim_digest` column on `care_slots`               | Avoids a new table and the full isolation suite `test-plan.md` §6.5 would require.                   | Plan          |
| Caretaker note (`NOTATKA`)    | Build now                                           | A per-trip note expresses something per-pet instructions cannot.                                     | Plan          |
| Calendar UI                   | Month grid per design, **3** dots                   | Design agreement; the two dots it draws predate the three-times-of-day schema.                       | Plan          |
| PRD §Non-Goals tension        | State the reading in the plan; amend PRD separately | A bearer capability is not a login, profile or history — but that is a reading, so it is recorded.   | Plan          |
| Cut line under time pressure  | DB and claim first, design last                     | The product works after Phase 4; Phase 5 is polish on a working flow.                                | Plan          |

## Scope

**In scope:** the caretaker note and claim-digest columns; a tightened three-column claim
invariant; `claim_slots` (`VOLATILE SECURITY DEFINER`, all-or-nothing); public instructions on
the existing read function; a new `get_claimed_details` for the sensitive tier; `POST /invite/claim`
with an explicit origin check; the first server-set HttpOnly cookie in this repo; the month-grid
caretaker calendar; a success design token and a `disabled` prop on `Input`.

**Out of scope:** caretaker accounts, profiles or history; an owner un-claim path (FR-010,
cut); caretaker names visible to each other (S-05); the owner's occupancy view (S-04);
structured feeding schedules (PRD Open Question #1); waiting lists and notifications (PRD
§Non-Goals); any PRD edit.

## Architecture / Approach

Three database functions, split because Postgres forces it: `get_period_by_token` stays
`STABLE` and grows the pets and _public_ instruction rows; `claim_slots` is a new `VOLATILE
SECURITY DEFINER` write; `get_claimed_details` serves the sensitive tier against (token +
claim secret) — a separate surface because `data-access.md:91-92` forbids widening the read
function's parameters. The caretaker's identity is a **capability, not an account**: the app
mints a 32-byte secret exactly as it mints the invite token, stores only its hex SHA-256 on
the claimed rows, and returns the raw value once into an HttpOnly cookie scoped to `/invite`.
"My slots" is then a digest filter, which is also how a follow-up claim attaches to the same
caretaker. Each function body is the _entire_ authorization boundary — there is no RLS behind
it, because anon holds no table grants at all.

## Phases at a Glance

| Phase                            | What it delivers                                                                    | Key risk                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Schema & RPC signature        | Note and digest columns, three-column claim invariant, note threaded through create | The sixth signature change in this project; grants are per-signature and silently reset |
| 2. The claim function            | Atomic all-or-nothing claim, grants, IDOR and concurrency tests                     | A `select` before the `update` silently reintroduces read-then-write and double-booking |
| 3. The reveal                    | Public tier on the read function, sensitive tier on a new one                       | The payload is a contract three consumers pin by exact key set                          |
| 4. Route, cookie & working claim | **North star delivered** — claim end-to-end on the existing list                    | Two deliberate inversions (no auth guard, manual origin check) that look like bugs      |
| 5. Design layer                  | Month grid, success banner, sensitive callout                                       | Two shared surfaces (`global.css`, `Input`) with call sites outside this slice          |

**Prerequisites:** S-08 `period-pets-relation` (landed 2026-09-06); a running local Supabase
stack for the integration project; the dev server **stopped** before any `npm run build`
(`lessons.md`).
**Estimated effort:** five phases, database-heavy at the front and UI-heavy at the back; the
cut line sits between Phase 4 and Phase 5.

## Open Risks & Assumptions

- **Nothing can invalidate a single caretaker's capability.** No owner un-claim exists (FR-010
  cut) and period revocation is S-06, still unbuilt — so a capability lives until the cookie's
  `Max-Age`.
- **No mechanism survives a screenshot**, and the invite link remains a bearer credential in
  browser history and any intermediate proxy log. This slice narrows neither.
- **The concurrency test proves an invariant, not the row lock.** Nothing forces two UPDATEs to
  overlap; the same test would pass against a broken read-then-write that happened not to
  interleave. Recorded rather than claimed as proof.
- **A shared or borrowed device retains the reveal** for the cookie's lifetime — the accepted
  cost of the chosen lifetime.
- **Rule 4 of the token model (uniform failure) genuinely widens here**, because a write must
  distinguish won from refused.
- **Assumption:** the design's month grid is worth its cost in a slice whose real risk is in the
  database. Phase ordering hedges this — Phase 5 can slip without blocking the north star.

## Success Criteria (Summary)

- A caretaker with no account opens a link on a phone, claims two slots with one submit, and
  reads the address and access codes that were invisible before.
- Two caretakers claiming the same slot at once produce exactly one winner, and the loser's
  whole selection stays free.
- A link-holder who has not claimed — and the same person in a different browser — never sees a
  sensitive instruction row.
