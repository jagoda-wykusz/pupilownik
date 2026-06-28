import { describe, expect, it } from "vitest";
import { createOwnerClient } from "./helpers/auth";

// Plumbing check: prove the harness yields two genuinely distinct authenticated
// identities under the anon key before the real RLS assertions rely on it.
describe("harness smoke", () => {
  it("creates two distinct owners, each authenticated as itself", async () => {
    const a = await createOwnerClient();
    const b = await createOwnerClient();

    expect(a.userId).not.toBe(b.userId);

    const { data: aUser } = await a.client.auth.getUser();
    const { data: bUser } = await b.client.auth.getUser();

    expect(aUser.user?.id).toBe(a.userId);
    expect(bUser.user?.id).toBe(b.userId);
  });
});
