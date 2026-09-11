import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// S-06's two load-bearing SQL postures, pinned structurally. Added by the full-plan review,
// which found that both were guarded by prose alone.
//
// WHY THIS FILE EXISTS. `get_claimed_details` carries two properties that no behavioural test
// can see:
//
//   1. THE ORDERING. The revoked branch must sit after the claim-digest gate. This one IS
//      covered behaviourally — tests/rls/reveal-instructions.test.ts fails in both directions
//      if it moves — so here it is a cheap second guard, not the primary one.
//   2. THE WORK EQUALISATION (Phase 2 impl-review F2). Both hashes and both lookups must run
//      before either gate decides, so a revoked token costs what an unknown one costs. This is
//      INVISIBLE to behaviour: the full-plan review reverted it in a live catalog and all 305
//      tests stayed green. Nothing guarded a security fix with a documented attack scenario.
//
// WHY STRUCTURE AND NOT A COUNTER. The obvious test reads `idx_scan` on
// care_slots_period_claim_digest_idx around one unknown-token call and asserts it rose. That
// test would be WORSE than none: vitest runs test files in parallel, so "rose by at least one"
// is satisfied by any other file's activity — it would pass while the probe does not run. That
// is exactly the anti-pattern context/foundation/lessons.md records, and this slice has already
// committed it nine times across three reviews. A direct Postgres connection would let us
// measure honestly, but the repo has no pg client and adding one for a single test is the very
// infrastructure the counter option was meant to avoid.
//
// WHY THE MIGRATIONS AND NOT THE CATALOG. The migrations are the only thing that builds the
// catalog — `npm run db:reset` replays them — so the newest definition in the directory IS the
// deployed one. Reading the newest rather than a hardcoded filename is what makes this survive
// a future migration: one that reverted the equalisation would be picked up and fail here.
//
// Needs no database, which is why it lives in tests/unit.

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const TARGET = "function public.get_claimed_details";

/** The body of the NEWEST migration that (re)defines the reveal door, with SQL line comments
 *  stripped. Stripping is not fussiness: `pg_get_functiondef` and the file alike contain
 *  comments ABOUT predicates, and the full-plan review's own first check reported "the filter is
 *  still there" because it matched the comment saying the filter had been removed. */
function newestRevealDoorDefinition(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const defining = files.filter((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(TARGET));
  if (defining.length === 0) {
    throw new Error(`no migration defines ${TARGET} — did the function get renamed?`);
  }

  const newest = defining[defining.length - 1];
  const source = readFileSync(join(MIGRATIONS, newest), "utf8");
  const start = source.indexOf(TARGET);

  // Bounded to the BODY, ending at the dollar-quote that closes it. The `comment on` statements
  // that follow legitimately contain "revoked_at is null" — they describe the predicate the
  // OTHER two doors still carry — so a slice that ran to end-of-file would make the last
  // assertion below unsatisfiable for the right reason, which is its own kind of wrong.
  const end = source.indexOf("$$;", start);
  if (end === -1) {
    throw new Error(`could not find the end of ${TARGET}'s body in ${newest}`);
  }

  return source
    .slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("get_claimed_details — the shape behaviour cannot see", () => {
  const code = newestRevealDoorDefinition();

  const at = (needle: string): number => {
    const index = code.indexOf(needle);
    expect(index, `\`${needle}\` not found in the newest definition`).toBeGreaterThan(-1);
    return index;
  };

  it("hashes the claim secret before the period is even looked up", () => {
    // Hoisted in Phase 2's F2 fix. Before it, a token that resolved to nothing skipped this
    // hash entirely, which is half the work asymmetry.
    expect(at("v_claim_digest :=")).toBeLessThan(at("from public.care_periods"));
  });

  it("probes care_slots before either gate decides", () => {
    const slotProbe = at("from public.care_slots");
    const periodGate = at("if not v_period_found");

    expect(slotProbe).toBeLessThan(periodGate);
    expect(at("from public.care_periods")).toBeLessThan(periodGate);
  });

  it("keeps the care_slots probe reachable when no period matched", () => {
    // The other half of the equalisation. Without the coalesce the probe cannot run for an
    // unknown token, because v_period.id is NULL — and the asymmetry returns.
    expect(code).toContain("coalesce(v_period.id");
  });

  it("puts the revoked branch AFTER the claim gate", () => {
    // The security property. Also pinned behaviourally in
    // tests/rls/reveal-instructions.test.ts, which fails in both directions if this moves;
    // this is the cheap structural echo of it.
    expect(at("if not v_claim_found")).toBeLessThan(at("v_period.revoked_at is not null"));
  });

  it("no longer filters the period lookup on revoked_at", () => {
    // Asserted on comment-stripped code, so the migration's own note explaining that the
    // filter was removed cannot satisfy it.
    expect(code).not.toContain("revoked_at is null");
  });
});
