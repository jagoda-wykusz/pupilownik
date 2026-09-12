import { describe, expect, it } from "vitest";

// THROWAWAY. This file exists to make one GitHub Actions run red on purpose, so that the claim
// README now makes as fact — "a red Actions run cannot block a merge on this plan" — is observed
// instead of quoted from GitHub's documentation. Delete the branch once the PR has been looked at;
// this must never reach master.
describe("a deliberate failure, to make the CI run red", () => {
  it("fails on purpose", () => {
    expect("this run is meant to be red").toBe("and it is");
  });
});
