import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@/lib/photos";
import { OWNER_USER_ID } from "@/lib/owner";
import { getAccess, normEmail } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";

type DeleteResult = { ok: true } | { ok: false; error: string };

const OWNER_REFUSED: DeleteResult = { ok: false, error: "The owner's account can't be deleted here." };

// An auth user whose app_members row was never linked (user_id null): find
// them by email so Remove still deletes their account and data. Pages through
// at most 1000 auth users. Returns undefined when the lookup itself failed.
async function findAuthUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null | undefined> {
  const perPage = 200;
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error(`[delete-user] list auth users failed: ${error.message}`);
      return undefined;
    }
    const users = data?.users ?? [];
    const hit = users.find((u) => normEmail(u.email) === email);
    if (hit) return hit.id;
    if (users.length < perPage) break;
  }
  return null;
}

// Is this person the owner, by app_members (user_id and email)? Errors → the
// caller refuses (fail closed). undefined = couldn't check.
async function isOwnerRow(admin: SupabaseClient, userId: string | null, email: string): Promise<boolean | undefined> {
  if (userId) {
    const { data, error } = await admin.from("app_members").select("role").eq("user_id", userId);
    if (error) {
      console.error(`[delete-user] owner re-check (user_id) failed: ${error.message}`);
      return undefined;
    }
    if ((data ?? []).some((r) => r.role === "owner")) return true;
  }
  if (email) {
    const { data, error } = await admin.from("app_members").select("role").eq("email", email);
    if (error) {
      console.error(`[delete-user] owner re-check (email) failed: ${error.message}`);
      return undefined;
    }
    if ((data ?? []).some((r) => r.role === "owner")) return true;
  }
  return false;
}

// Remove a person from Xclr completely (service-role client only):
//   1. every file in their storage folder  xclr-photos/<userId>/
//   2. their auth user — every table references auth.users with
//      ON DELETE CASCADE, so all their rows go with it
//   3. their app_members row, so they're off the invite list
// Callers decide WHO may do this (the person themself, or the owner). This
// refuses the owner on its own too: OWNER_USER_ID, or an app_members owner row
// (re-checked here; a failed check refuses).
export async function deleteUserEverything(
  admin: SupabaseClient,
  target: { userId: string | null; email: string }
): Promise<DeleteResult> {
  const email = normEmail(target.email);
  let userId = target.userId;
  if (!userId && email) {
    const found = await findAuthUserIdByEmail(admin, email);
    if (found === undefined) return { ok: false, error: "Couldn't look up their account. Nothing was deleted — try again." };
    userId = found;
  }
  if (userId === OWNER_USER_ID) return OWNER_REFUSED;
  const owner = await isOwnerRow(admin, userId, email);
  if (owner === undefined) return { ok: false, error: "Couldn't check the account. Nothing was deleted — try again." };
  if (owner) return OWNER_REFUSED;

  if (userId) {
    const folder = userId;
    for (let round = 0; round < 50; round++) {
      const { data: files, error } = await admin.storage.from(PHOTO_BUCKET).list(folder, { limit: 1000 });
      if (error) {
        console.error(`[delete-user] list storage failed: ${error.message}`);
        return { ok: false, error: "Couldn't remove the photos. Nothing was deleted — try again." };
      }
      if (!files?.length) break;
      const { error: rmErr } = await admin.storage
        .from(PHOTO_BUCKET)
        .remove(files.map((f) => `${folder}/${f.name}`));
      if (rmErr) {
        console.error(`[delete-user] remove storage failed: ${rmErr.message}`);
        return { ok: false, error: "Couldn't remove the photos. Nothing else was deleted — try again." };
      }
      if (files.length < 1000) break;
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr && !/not.?found/i.test(delErr.message)) {
      console.error(`[delete-user] delete auth user failed: ${delErr.message}`);
      return { ok: false, error: "Couldn't delete the account. Try again." };
    }
  }

  // The cascade only nulls app_members.user_id — remove the row by email.
  if (email) {
    const { error: memErr } = await admin
      .from("app_members")
      .delete()
      .eq("email", email)
      .neq("role", "owner");
    if (memErr) console.error(`[delete-user] remove member row failed: ${memErr.message}`);
  }
  return { ok: true };
}

// "Delete my data and leave Xclr" for the signed-in person themself. Shared by
// the Profile server action and the paused-member route (/leave/delete).
// Fails closed: the owner, or a failed access lookup, is refused.
export async function deleteSelf(user: Pick<User, "id" | "email">, confirm: string): Promise<DeleteResult> {
  if (confirm.trim() !== "DELETE") return { ok: false, error: "Type DELETE in capitals to confirm." };
  if (user.id === OWNER_USER_ID) return OWNER_REFUSED;
  let access;
  try {
    access = await getAccess(user);
  } catch {
    return { ok: false, error: "Xclr couldn't check your access just now. Nothing was deleted — try again in a minute." };
  }
  if (access?.role === "owner") return OWNER_REFUSED;
  return deleteUserEverything(createAdminClient(), {
    userId: user.id,
    email: access?.email ?? normEmail(user.email),
  });
}
