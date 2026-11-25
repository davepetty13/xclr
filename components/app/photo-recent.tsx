"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deletePhoto } from "@/app/(app)/photo/actions";
import { PHOTO_KIND_LABEL, type PhotoKind } from "@/lib/photo-schema";

export type RecentPhoto = {
  id: string;
  kind: PhotoKind;
  thumbUrl: string | null; // signed URL, valid 60 s
  timeLeft: string;
  expiresLabel: string;
};

// "Recent photos (auto-delete)": every photo still on the server, with how long
// it has left and a way to delete it now.
export function PhotoRecent({ photos }: { photos: RecentPhoto[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  if (!photos.length) return null;

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    const r = await deletePhoto(id);
    setBusyId(null);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <section className="mt-2 flex flex-col gap-2" aria-labelledby="recent-photos-h">
      <h2 id="recent-photos-h" className="px-1 text-sm font-bold text-ink">
        Recent photos (auto-delete)
      </h2>
      <p className="-mt-1 px-1 text-xs text-muted">
        Each photo deletes itself 48 hours after you take it.
      </p>
      {error ? (
        <p role="alert" className="px-1 text-sm font-medium text-ember-text">
          {error}
        </p>
      ) : null}
      <ul className="glass px-3 py-0.5">
        {photos.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0"
          >
            {p.thumbUrl && !broken.has(p.id) ? (
              // Signed, short-lived private URL — next/image can't optimize it.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.thumbUrl}
                alt={`${PHOTO_KIND_LABEL[p.kind]} photo`}
                className="h-12 w-12 flex-none rounded-xl object-cover"
                onError={() => setBroken((s) => new Set(s).add(p.id))}
              />
            ) : (
              <div
                aria-hidden
                className="h-12 w-12 flex-none rounded-xl bg-segment"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">{PHOTO_KIND_LABEL[p.kind]}</p>
              <p className="text-xs text-muted">
                {p.timeLeft} · deletes {p.expiresLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => remove(p.id)}
              disabled={busyId === p.id}
              className="btn-secondary px-3 text-[13px]"
            >
              {busyId === p.id ? "Deleting…" : "Delete now"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
