import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Photos are kept at most 48 hours (photo_reads.expires_at), then deleted from
// storage and marked deleted_at. Three layers make sure that happens:
//   a) deleteExpiredPhotosFor — on photo page load and at the start of readPhoto
//   b) deletePhotoNow        — the user's "Delete now" button
//   c) deleteAllExpired      — the cron (app/api/cron/photo-cleanup), service role
// A row is only marked deleted once the storage remove succeeded, so a failed
// remove is retried by the next layer instead of leaving an orphan file.

export const PHOTO_BUCKET = "xclr-photos";
export const PHOTO_TTL_HOURS = 48;

// Works with both the user's cookie client and the admin client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

type Row = { id: string; storage_path: string; user_id?: string };

async function removeRows(supabase: Supa, rows: Row[], tag: string): Promise<number> {
  if (!rows.length) return 0;
  const { error: rmErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .remove(rows.map((r) => r.storage_path));
  // Removing a file that's already gone is not an error in Supabase storage.
  if (rmErr) {
    console.error(`[photos:${tag}] storage remove failed: ${rmErr.message}`);
    return 0;
  }
  const { error: upErr } = await supabase
    .from("photo_reads")
    // Clear what was read too: once the photo is gone, only numbers the user
    // logged (in food_logs / weights / medical_conditions) remain anywhere.
    .update({ deleted_at: new Date().toISOString(), result: null })
    .in(
      "id",
      rows.map((r) => r.id)
    );
  if (upErr) {
    console.error(`[photos:${tag}] mark deleted failed: ${upErr.message}`);
    return 0;
  }
  return rows.length;
}

// (a) Delete this user's photos that are past expires_at.
export async function deleteExpiredPhotosFor(supabase: Supa, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("photo_reads")
    .select("id, storage_path")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .lte("expires_at", new Date().toISOString())
    .limit(100);
  if (error) {
    console.error(`[photos:expired-user] ${error.message}`);
    return 0;
  }
  return removeRows(supabase, (data ?? []) as Row[], "expired-user");
}

// (b) Delete one photo now (user-initiated, or after a failed/unclear read).
export async function deletePhotoNow(
  supabase: Supa,
  userId: string,
  photoId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("photo_reads")
    .select("id, storage_path")
    .eq("user_id", userId)
    .eq("id", photoId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error(`[photos:delete-now] ${error.message}`);
    return false;
  }
  if (!data) return true; // already gone
  return (await removeRows(supabase, [data as Row], "delete-now")) === 1;
}

// Remove an uploaded file that never got a photo_reads row (e.g. consent missing).
export async function removeUpload(supabase: Supa, storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
  if (error) console.error(`[photos:remove-upload] ${error.message}`);
}

// (c) Cron: delete ALL users' expired photos in batches of 100.
// Needs the service-role client (lib/supabase/admin.ts).
export async function deleteAllExpired(
  admin: Supa,
  opts: { maxBatches?: number } = {}
): Promise<{ deleted: number; batches: number; failed: boolean }> {
  const maxBatches = opts.maxBatches ?? 20;
  let deleted = 0;
  let batches = 0;
  for (; batches < maxBatches; ) {
    const { data, error } = await admin
      .from("photo_reads")
      .select("id, storage_path, user_id")
      .is("deleted_at", null)
      .lte("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(100);
    if (error) {
      console.error(`[photos:cron] ${error.message}`);
      return { deleted, batches, failed: true };
    }
    // Defence in depth: only ever remove a file inside its row owner's folder.
    const rows = ((data ?? []) as Row[]).filter(
      (r) => !!r.user_id && r.storage_path.startsWith(`${r.user_id}/`)
    );
    if (!(data ?? []).length) break;
    if (!rows.length) break;
    batches++;
    const n = await removeRows(admin, rows, "cron");
    if (n === 0) return { deleted, batches, failed: true }; // don't spin on a failing batch
    deleted += n;
    if (rows.length < 100) break;
  }
  return { deleted, batches, failed: false };
}

// (d) Cron: remove uploads that never got a photo_reads row (tab closed or the
// read crashed between upload and readPhoto). Anything in the bucket older
// than the TTL with no live row is deleted.
export async function deleteOrphanUploads(admin: Supa): Promise<number> {
  const cutoff = Date.now() - PHOTO_TTL_HOURS * 3_600_000;
  const { data: folders, error } = await admin.storage.from(PHOTO_BUCKET).list("", { limit: 1000 });
  if (error) {
    console.error(`[photos:orphans] list folders failed: ${error.message}`);
    return 0;
  }
  let removed = 0;
  for (const folder of folders ?? []) {
    if (!/^[0-9a-f-]{36}$/.test(folder.name)) continue;
    const { data: files, error: fErr } = await admin.storage
      .from(PHOTO_BUCKET)
      .list(folder.name, { limit: 1000 });
    if (fErr) {
      console.error(`[photos:orphans] list failed: ${fErr.message}`);
      continue;
    }
    const old = (files ?? []).filter((f) => {
      const t = Date.parse(String(f.created_at ?? ""));
      return Number.isFinite(t) && t < cutoff;
    });
    if (!old.length) continue;
    const paths = old.map((f) => `${folder.name}/${f.name}`);
    const { data: live, error: liveErr } = await admin
      .from("photo_reads")
      .select("storage_path")
      .in("storage_path", paths)
      .is("deleted_at", null);
    if (liveErr) {
      console.error(`[photos:orphans] lookup failed: ${liveErr.message}`);
      continue;
    }
    const liveSet = new Set((live ?? []).map((r) => r.storage_path as string));
    const orphans = paths.filter((p) => !liveSet.has(p));
    if (!orphans.length) continue;
    const { error: rmErr } = await admin.storage.from(PHOTO_BUCKET).remove(orphans);
    if (rmErr) console.error(`[photos:orphans] remove failed: ${rmErr.message}`);
    else removed += orphans.length;
  }
  return removed;
}

// "Sat 2:21 AM" in the user's timezone.
export function expiryLabel(expiresAt: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(expiresAt));
  } catch {
    return new Date(expiresAt).toUTCString();
  }
}

// "47 h left" / "35 min left".
export function timeLeftLabel(expiresAt: string, now: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "deleting";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(min, 1)} min left`;
  return `${Math.floor(min / 60)} h left`;
}
