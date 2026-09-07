<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Caretaker Claims Slot

- **Plan**: `context/changes/caretaker-claims-slot/plan.md`
- **Scope**: Phase 4 of 5
- **Date**: 2026-09-07
- **Commits reviewed**: `cd88180` (phase 4)
- **Verdict**: NEEDS ATTENTION → all 10 findings triaged and fixed 2026-09-07
- **Findings**: 0 critical, 4 warnings, 6 observations (F1–F3 fixed during the review)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Automated criteria, re-verified from scratch

| Criterion                                          | Result                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| 4.1 route suite                                    | PASS — 12/12 after the F1 fix                                              |
| 4.2 uniform-failure unit test with the fourth kind | PASS — 70/70                                                               |
| 4.3 full suite                                     | PASS — 192/192                                                             |
| 4.4 `npm run lint`                                 | PASS — `EXIT=0`, 4 `no-console` warnings, all the same established pattern |
| 4.4 `npx astro check`                              | PASS — `EXIT=0`, 86 files                                                  |

Every exit code read without a pipeline.

## Ruled out (checked, not findings)

- The raw capability secret never reaches the response body, the logs, the rendered HTML or the
  island. `Object.keys(body)` is pinned; `error.details` is never logged; every raise in the
  claim function interpolates only lengths and counts.
- No error branch distinguishes bad-token from revoked from no-such-slot: all collapse to the
  one 404. A slot id from another period is indistinguishable from a nonexistent one.
- CSRF walked in full: cross-origin `fetch` sends Origin (→403); a cross-site form POST with
  `enctype=text/plain` can forge a JSON body but still sends Origin (→403); an opaque origin
  sends `Origin: null`, a non-null string that fails the equality (→403); Chrome's
  Lax-allows-unsafe carve-out applies only to cookies with NO SameSite attribute, so it does
  not reach this one.
- All requested traces correct: first claim, follow-up, identical retry, revoked trip,
  cross-trip cookie, conflicting selection, two browsers racing.
- `resolveInviteView` branch order is right and pinned three ways.
- `sensitiveByPet` is keyed by pet id, not by position.
- The plan's Phase-4 block says the route "passes its digest"; addendum A14 says it passes the
  RAW secret. **A14 is right and the code follows it** — a digest would fail `claim_slots`'s
  43-character bound and every follow-up claim would 400.
- Pattern compliance: no substantive mismatches against `api/periods.ts`, `schemas/period.ts`
  or `RegenerateLinkButton.tsx`.
- Addenda A10, A13, A17, A21, A28–A31 all verified as accurate and justified.

## Findings

### F1 — A corrupted capability cookie dead-ends the caretaker permanently

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/invite/claim.ts` (capability selection)
- **Detail**: `const secret = existing ?? generateClaimSecret()` — `??` catches only
  null/undefined, so an empty, truncated or tampered cookie went straight to `claim_slots`,
  which raises `PT400` on its 43-character bound. Nothing clears the cookie, so that browser
  would get a 400 on every future attempt, forever; refreshing does not help. The asymmetry
  made it undiagnosable: `get_claimed_details` answers NULL for a wrong-length secret, so the
  PAGE degrades silently to the pre-claim view while the ROUTE dead-ends — the symptom points
  nowhere near the cause.
- **Fix**: Validate against `CAPABILITY_SHAPE` (`/^[A-Za-z0-9_-]{43}$/`) and mint fresh on
  mismatch. Costs one name prompt; recovers on the next request.
- **Decision**: FIXED — with a falsification proof: reverting to `existing ?? mint()` makes the
  new test fail (`expected 400 to be 200`) while the other 11 pass.

### F2 — Missing diacritic in the post-claim banner

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: `src/pages/invite/[token].astro` (success banner)
- **Detail**: `Masz 1 dzien:` — every other string in the file carries correct diacritics.
  Introduced by an ASCII-only edit script that dodged an encoding problem; one of the two
  affected sentences was corrected at the time and this one was not.
- **Fix**: `dzień`.
- **Decision**: FIXED

### F3 — `kind: "claimed"` was computed, exported and tested but never read

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: `src/lib/invite-view.ts`, `src/pages/invite/[token].astro`
- **Detail**: The template branched on `claimed &&` / `!claimed` directly. Nothing broke —
  `claimed` and `period` carry the same status and title — but the plan asked for the post-claim
  branch to live in the function rather than as an inline `if`, and only the status/title half
  was honoured. Nothing prevented a future template `if` from diverging.
- **Fix**: The one PURE view decision (the pre-claim tier hint) now reads
  `view.kind === "period"`. The data-bearing blocks keep `claimed &&` because they dereference
  it and need TypeScript's narrowing; a comment records that the two are equivalent by
  construction inside the `payload` branch.
- **Decision**: FIXED

### F4 — The first anonymous write is irreversible, and the owner has no remedy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/pages/invite/claim.ts`; `docs/reference/data-access.md` rule 4
- **Detail**: `claim_slots` is the only anon-reachable write and there is no un-claim path
  anywhere — no migration sets `claimed_by_name = null`, and S-06 is _revoke the link_, which
  does not release slots. Anyone the invite link reaches (it is designed to be forwarded over
  WhatsApp) can permanently take every slot in a trip, repeatedly, with a fresh capability each
  time, and `regenerate_period_token` leaves the slots taken. **Before this commit the bearer
  link was read-only, so this exposure is new here, not inherited.** The plan's
  §What We're NOT Doing records "nothing can invalidate a single caretaker's capability", which
  is the narrower statement; it does not say the slots themselves cannot be recovered.
  `data-access.md` rule 4 documents the signalling widening for writes and says nothing about
  irreversibility.
- **Fix A ⭐ Recommended**: Record it explicitly — in rule 4 and in the change's risk register —
  and confirm a later slice gives the owner a "release this slot" action.
  - Strength: Honest, cheap, and puts the fact where the next reader of the access model will
    meet it. The release action is the half that actually matters; a rate limit only slows it.
  - Tradeoff: The exposure stays live until that slice ships.
  - Confidence: HIGH — FR-010 was cut deliberately, so this is a known scope decision, not an
    oversight; what is missing is the written consequence.
  - Blind spot: Whether an MVP audience forwards links widely enough for this to bite.
- **Fix B**: Add a per-token claim rate limit now.
  - Strength: Bounds the damage without waiting for a new slice.
  - Tradeoff: New surface, no precedent in this repo, and it does not undo a claim already made.
  - Confidence: MEDIUM.
- **Decision**: FIXED as a recorded consequence — `data-access.md` rule 4 now states that the write is irreversible and that a later slice owes the owner a "release this slot" action; the plan's §What We're NOT Doing was widened from "the capability survives" to "the CLAIM survives", and the follow-up entry was sharpened to say why revocation is not sufficient.

### F5 — `claim-cookie.ts` describes cross-trip behaviour the code does not have

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (documents)
- **Location**: `src/lib/claim-cookie.ts` (cookie contract comment)
- **Detail**: "it is what lets a caretaker help two households without re-entering their name."
  False, and verified against the migration: `claim_slots` scopes the stored-name lookup by
  `where s.period_id = v_period.id and s.claim_digest = v_claim_digest`, so on a second trip
  `v_name` is NULL and a name IS required again. `get_claimed_details` is period-scoped too, so
  the page computes `hasCapability = false` and the island renders the name field. The behaviour
  is correct — one identity per trip — but the file that exists to be the cookie's contract
  asserts the opposite, in the place most likely to be read instead of the code.
- **Fix**: "the cookie carries the capability across trips; the NAME is per-trip, because
  `claim_slots` scopes the stored name by `period_id`."
- **Decision**: FIXED — the comment now says the CAPABILITY carries across trips while the NAME is per-trip, quoting the period-scoped lookup that makes it so.

### F6 — `claim-cookie.ts` has no unit test, and its injectable clock exists for one

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: `src/lib/claim-cookie.ts`; `tests/unit/`
- **Detail**: `claimCookieOptions(endDate, now = new Date())` takes an injectable clock
  precisely so it can be tested, and nothing calls it outside the route. Delete
  `Math.max(seconds, MIN_AGE_SECONDS)`, or `BUFFER_DAYS`, or change the UTC parse to a local
  one — all tests stay green. The only assertion that touches it is
  `expect(record?.options.maxAge).toBeGreaterThan(0)` against a trip ending nine months out, so
  it cannot fail for any plausible regression. The floor it fails to guard is the one the file
  itself calls "the case that actually happens".
  Two adjacent test-infrastructure limits: the attribute assertion uses `toMatchObject`, so an
  added `domain` would pass (`toEqual` closes half of it), and the hand-written fake cookie
  object round-trips values raw while Astro's encodes/decodes via `decodeURIComponent` — no live
  bug, since base64url has no character that re-encodes, but the limit is unnamed.
- **Fix**: `tests/unit/claim-cookie.test.ts` with three cases — `end_date` today → ≈7 days;
  `end_date` 30 days past → exactly `MIN_AGE_SECONDS`; a `now` west of Greenwich → no
  off-by-one. Switch to `toEqual` and note the fake's encoding limit.
- **Decision**: FIXED — `tests/unit/claim-cookie.test.ts` (5 cases). Falsified twice: removing `Math.max(seconds, MIN_AGE_SECONDS)` fails the floor case; changing the UTC parse to a local one fails the timezone case. `toEqual` replaces `toMatchObject` so an added attribute is caught.

### F7 — "localhost counts as a secure context" is true, and not true on a LAN IP

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (documents)
- **Location**: `src/lib/claim-cookie.ts` (`secure: true`)
- **Detail**: True for `http://localhost` and `http://127.0.0.1`. NOT true for a dev server
  reached over a LAN IP (`http://192.168.x.x:4321`) — the browser silently drops a `Secure`
  cookie, and the symptom is exactly the one `MIN_AGE_SECONDS` exists to prevent: the claim
  succeeds, the reload shows the pre-claim page, and it reads as "it didn't work". Testing a
  mobile-first caretaker flow on a real phone is the obvious trigger.
- **Fix**: Keep `secure: true`; add one sentence naming the LAN-IP caveat so the symptom is
  diagnosable, and note it in the change's verification notes.
- **Decision**: FIXED — the LAN-IP caveat is named, with its symptom, so it is diagnosable rather than mysterious.

### F8 — Three route-level coverage gaps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: `tests/api/invite-claim.test.ts`
- **Detail**: (a) No test that a REVOKED period yields the uniform 404 — only an unknown token
  is exercised, and revoked-vs-unknown indistinguishability is precisely what rule 4 is about;
  the SQL layer covers it, the route's own mapping does not. (b) No test that a failed claim
  (403/404/409) sets NO cookie — today `set` sits after every refusal branch, but nothing pins
  that ordering. (c) No route-level test of the cross-trip cookie; Phase 3 pinned the SQL half,
  and `Path=/invite` is what makes the scenario real.
- **Fix**: Three cases.
- **Decision**: FIXED — three route-level cases. The no-cookie-on-refusal one was falsified by moving `cookies.set` above the error branches: it fails alone while the other 14 pass.

### F9 — Two comments misstate what crosses to the client and what the Origin check buys

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality (documents)
- **Location**: `src/pages/invite/[token].astro` (island comment); `src/pages/invite/claim.ts`
  (Origin comment)
- **Detail**: (a) "`hasCapability` is the ONLY thing about the capability that crosses to the
  client" is true of the capability and false of the token: Astro serializes island props into
  the HTML, so the raw invite token now has a second copy in the DOM. Not an escalation — it is
  already in the URL, and the response carries `no-referrer` + `no-store` — but the comment
  reads as if nothing credential-shaped crosses. (b) The Origin comment says the residual harm
  is "minting a fresh capability, which reveals nothing". The real residual harm is
  grief-claiming: a cross-site POST could take up to 93 slots under an attacker-chosen name in
  one request, and per F4 nothing can undo it.
- **Fix**: Correct both sentences; optionally have the island read the token from
  `location.pathname` instead of a prop.
- **Decision**: FIXED — the island comment now states precisely what crosses (the capability contributes a boolean; the TOKEN does cross as a prop and Astro serializes it into the HTML), and the Origin comment now names grief-claiming as the residual harm instead of "reveals nothing".

### F10 — Capability fixation via a planted cookie, and why `__Host-` is not the answer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: `src/pages/invite/claim.ts`, `src/lib/claim-cookie.ts`
- **Detail**: The route treats any well-formed 43-character `pupilownik_claim` value as this
  browser's capability. Anyone able to write a cookie for the site host — a sibling app on
  another port in development (cookies ignore ports), an XSS elsewhere on the origin, or a
  future subdomain — could plant a secret they know, and the victim's claim would then unlock
  the sensitive tier for them. Not exploitable today: no subdomains, HttpOnly + Secure, no
  `set:html` anywhere on the invite pages. The standard mitigation is a `__Host-` prefix, which
  forbids `Domain` and **pins `Path=/`** — directly contradicting the deliberate `/invite`
  scoping that keeps the credential off owner requests, which is the better property here.
- **Fix**: Record as a knowingly-taken trade-off rather than changing it.
- **Decision**: FIXED as a recorded trade-off — `claim-cookie.ts` explains why the name is NOT `__Host-` prefixed: that prefix pins `Path=/`, destroying the `/invite` scoping that keeps the credential off owner requests. Revisit if the app gains a subdomain.
