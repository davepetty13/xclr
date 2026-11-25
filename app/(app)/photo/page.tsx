import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TZ } from "@/lib/time";
import {
  PHOTO_BUCKET,
  deleteExpiredPhotosFor,
  expiryLabel,
  timeLeftLabel,
} from "@/lib/photos";
import { isPhotoKind, type PhotoKind } from "@/lib/photo-schema";
import { PhotoReader } from "@/components/app/photo-reader";
import type { RecentPhoto } from "@/components/app/photo-recent";

// Photo reads share the chat AI budget (lib/anthropic.ts AI_BUDGET_SECONDS.chat).
// Must stay a literal.
export const maxDuration = 120;

export default async function PhotoPage({
  searchParams,
}: {
  searchParams?: { kind?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Layer (a): every visit clears this user's photos that are past 48 h.
  await deleteExpiredPhotosFor(supabase, user.id);

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, health_data_consent_at, weight_unit")
    .eq("id", user.id)
    .maybeSingle();
  const tz = (profile?.timezone as string | null) ?? DEFAULT_TZ;
  const hasConsent = Boolean(profile?.health_data_consent_at);

  const nowIso = new Date().toISOString();
  const { data: rows } = await supabase
    .from("photo_reads")
    .select("id, kind, storage_path, expires_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(10);

  const live = rows ?? [];
  const signed = new Map<string, string>();
  if (live.length) {
    const { data: urls } = await supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(
        live.map((r) => r.storage_path as string),
        60
      );
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  const now = Date.now();
  const recent: RecentPhoto[] = live
    .filter((r) => isPhotoKind(r.kind))
    .map((r) => ({
      id: r.id as string,
      kind: r.kind as PhotoKind,
      thumbUrl: signed.get(r.storage_path as string) ?? null,
      timeLeft: timeLeftLabel(r.expires_at as string, now),
      expiresLabel: expiryLabel(r.expires_at as string, tz),
    }));

  const askedKind = searchParams?.kind;
  const initialKind: PhotoKind = isPhotoKind(askedKind) ? askedKind : "food";

  return (
    <PhotoReader
      userId={user.id}
      hasConsent={hasConsent}
      initialKind={initialKind}
      recent={recent}
      unit={profile?.weight_unit === "lbs" ? "lbs" : "kg"}
    />
  );
}
