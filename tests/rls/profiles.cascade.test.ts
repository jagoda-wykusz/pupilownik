import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import { describe, expect, it } from "vitest";
import { createOwnerClient } from "../helpers/auth";
import { getTestEnv } from "../setup";

// Data-integrity guarantee: deleting an owner in auth.users cascades to public.profiles
// (the FK is `on delete cascade`). This is kept OUT of the owner-isolation suite because
// it needs a privileged delete of an auth.users row — a service_role operation. The
// service_role client lives here ONLY for that delete + the post-delete read; it must
// never be used to assert RLS (it bypasses RLS entirely).
describe("profiles auth.users delete-cascade", () => {
  it("removes the profile when its auth user is deleted", async () => {
    const { url } = getTestEnv();
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      throw new Error("SUPABASE_SERVICE_KEY must be set in .env.test for the cascade test (see .env.test.example).");
    }
    const admin = createClient<Database>(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Arrange: a fresh owner whose profile the signup trigger created.
    const owner = await createOwnerClient();
    const { data: before } = await admin.from("profiles").select("id").eq("id", owner.userId);
    expect(before).toEqual([{ id: owner.userId }]);

    // Act: delete the auth user (admin-only).
    const { error: delErr } = await admin.auth.admin.deleteUser(owner.userId);
    expect(delErr).toBeNull();

    // Assert: the profile is gone (cascade). Read via service_role since the user's JWT
    // is now invalid — this read is a schema check, not an RLS assertion.
    const { data: after } = await admin.from("profiles").select("id").eq("id", owner.userId);
    expect(after).toEqual([]);
  });
});
