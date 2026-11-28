import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_BUCKET } from "@/lib/photos";

// Remove a person from Xclr completely (service-role client only):
//   1. every file in their storage folder  xclr-photos/<userId>/
//   2. their auth user — every table references auth.users with
//      ON DELETE CASCADE, so all their rows go with it
//   3. their app_members row, so they're off the invite list
// Callers decide WHO may do this (the person themself, or the owner) and
// never pass the owner's id.
export async function deleteUserEverything(
  admin: SupabaseClient,
  target: { userId: string | null; email: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (target.userId) {
    const folder = target.userId;
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

    const { error: delErr } = await admin.auth.admin.deleteUser(target.userId);
    if (delErr && !/not.?found/i.test(delErr.message)) {
      console.error(`[delete-user] delete auth user failed: ${delErr.message}`);
      return { ok: false, error: "Couldn't delete the account. Try again." };
    }
  }

  // The cascade only nulls app_members.user_id — remove the row by email.
  const { error: memErr } = await admin
    .from("app_members")
    .delete()
    .eq("email", target.email)
    .neq("role", "owner");
  if (memErr) console.error(`[delete-user] remove member row failed: ${memErr.message}`);
  return { ok: true };
}
