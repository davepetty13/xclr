"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  deletePhoto,
  logPhotoFood,
  logPhotoWeight,
  readPhoto,
  savePhotoHealthNote,
  type PhotoView,
} from "@/app/(app)/photo/actions";
import {
  MEALS,
  PHOTO_KINDS,
  PHOTO_KIND_LABEL,
  type HealthReading,
  type PhotoFood,
  type PhotoKind,
} from "@/lib/photo-schema";
import { PhotoRecent, type RecentPhoto } from "@/components/app/photo-recent";
import { kgToLbs, lbsToKg } from "@/lib/units";

const BUCKET = "xclr-photos";
const MAX_EDGE = 1280;

// Resize to ≤1280px on the long edge and re-encode as JPEG 0.8 via canvas.
// Re-encoding drops all EXIF (incl. GPS location); the <img> decode applies the
// EXIF orientation first, so the picture stays upright.
async function toSmallJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode"));
      i.src = url;
    });
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error("empty");
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "white"; // transparent PNG screenshots → white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    if (!blob) throw new Error("encode");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function mealForNow(): string {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 17.5) return "snack";
  if (h < 22) return "dinner";
  return "snack";
}

const numOrNull = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null) => (n == null ? "" : String(n));

type FoodDraft = {
  name: string;
  serving: string;
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
};
type ReadingDraft = { name: string; value: string; unit: string; reference_range: string };

const inputCls = "field mt-1 w-full text-sm";

export function PhotoReader({
  userId,
  hasConsent,
  initialKind,
  recent,
  unit = "kg",
}: {
  userId: string;
  hasConsent: boolean;
  initialKind: PhotoKind;
  recent: RecentPhoto[];
  unit?: "kg" | "lbs";
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PhotoKind>(initialKind);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; consent?: boolean; soft?: boolean } | null>(
    null
  );
  const [photo, setPhoto] = useState<PhotoView | null>(null);
  const [editing, setEditing] = useState(false);
  const [foods, setFoods] = useState<FoodDraft[]>([]);
  const [meal, setMeal] = useState<string>("lunch");
  const [weight, setWeight] = useState("");
  const [readings, setReadings] = useState<ReadingDraft[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Free the local preview's memory when it changes.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const healthBlocked = kind === "health" && !hasConsent;

  function reset() {
    setPhoto(null);
    setEditing(false);
    setDone(null);
    setError(null);
    setStatus(null);
    setPreview(null);
  }

  function selectKind(k: PhotoKind) {
    if (busy) return;
    setKind(k);
    reset();
  }

  function loadDrafts(p: PhotoView) {
    setEditing(false);
    setDone(null);
    if (p.read.kind === "food") {
      setFoods(
        p.read.foods.map((f) => ({
          name: f.name,
          serving: f.serving ?? "",
          kcal: str(f.kcal),
          protein_g: str(f.protein_g),
          carbs_g: str(f.carbs_g),
          fat_g: str(f.fat_g),
        }))
      );
      setMeal(p.read.meal ?? mealForNow());
    } else if (p.read.kind === "scale") {
      // Draft is in the user's unit; converted back to kg before saving.
      const kg = p.read.weight_kg;
      setWeight(kg == null ? "" : (unit === "lbs" ? kgToLbs(kg) : kg).toFixed(2));
    } else {
      setReadings(
        p.read.readings.map((r) => ({
          name: r.name,
          value: r.value,
          unit: r.unit ?? "",
          reference_range: r.reference_range ?? "",
        }))
      );
      setTitle(p.read.document_type);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (!file || busy) return;
    const readKind = kind;
    reset();
    setBusy(true);
    try {
      setStatus("Getting your photo ready…");
      let blob: Blob;
      try {
        blob = await toSmallJpeg(file);
      } catch {
        setError({ text: "Couldn't open that photo. Try a JPEG or PNG, or take a new one." });
        return;
      }
      setPreview(URL.createObjectURL(blob));

      setStatus("Uploading…");
      const path = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await createClient()
        .storage.from(BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (upErr) {
        setError({ text: "Couldn't upload the photo. Check your connection and try again." });
        return;
      }

      setStatus("Reading your photo…");
      const r = await readPhoto(path, readKind);
      if (!r.ok) {
        setError({ text: r.error, consent: r.consentNeeded, soft: r.clarification });
        setPreview(null);
        return;
      }
      setPhoto(r.photo);
      loadDrafts(r.photo);
      router.refresh(); // show it in "Recent photos"
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  async function confirm() {
    if (!photo || busy) return;
    setBusy(true);
    setError(null);
    let r: { ok: true; message?: string } | { ok: false; error: string };
    if (photo.read.kind === "food") {
      const items: PhotoFood[] = foods.map((f) => ({
        name: f.name,
        serving: f.serving.trim() || null,
        kcal: numOrNull(f.kcal),
        protein_g: numOrNull(f.protein_g),
        carbs_g: numOrNull(f.carbs_g),
        fat_g: numOrNull(f.fat_g),
      }));
      r = await logPhotoFood(photo.id, items, meal);
    } else if (photo.read.kind === "scale") {
      const entered = numOrNull(weight);
      const kg = entered == null ? null : unit === "lbs" ? lbsToKg(entered) : entered;
      r =
        kg == null
          ? { ok: false, error: `Enter your weight in ${unit}.` }
          : await logPhotoWeight(photo.id, kg);
    } else {
      const items: HealthReading[] = readings.map((x) => ({
        name: x.name,
        value: x.value,
        unit: x.unit.trim() || null,
        reference_range: x.reference_range.trim() || null,
      }));
      r = await savePhotoHealthNote(photo.id, items, title);
    }
    setBusy(false);
    if (r.ok) {
      setDone(r.message ?? "Saved.");
      setEditing(false);
      router.refresh();
    } else setError({ text: r.error });
  }

  async function deleteNow() {
    if (!photo || busy) return;
    setBusy(true);
    const r = await deletePhoto(photo.id);
    setBusy(false);
    if (r.ok) {
      reset();
      router.refresh();
    } else setError({ text: r.error });
  }

  const totalKcal = foods.reduce((s, f) => s + (numOrNull(f.kcal) ?? 0), 0);
  const confirmLabel =
    photo?.read.kind === "health"
      ? "Save to health notes"
      : photo?.read.kind === "scale"
        ? "Log weight"
        : "Log it";

  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-3.5">
      <Link
        href="/chat"
        className="inline-flex min-h-[44px] items-center self-start px-1 text-[13px] font-semibold text-muted"
      >
        ← Coach
      </Link>
      <h1 className="-mt-2 px-1 font-display text-[22px] font-bold tracking-[-0.02em] text-ink">
        Read a photo
      </h1>

      <div
        role="tablist"
        aria-label="What's in the photo"
        className="flex gap-5 border-b border-hairline px-1"
      >
        {PHOTO_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            onClick={() => selectKind(k)}
            aria-selected={kind === k}
            disabled={busy}
            className="tab"
          >
            {PHOTO_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {healthBlocked ? (
        <p className="glass p-4 text-sm text-ink">
          Health paper photos (lab results, prescriptions) need health consent on.{" "}
          <Link href="/profile" className="font-medium text-green underline">
            Turn it on in your profile
          </Link>
          .
        </p>
      ) : (
        <label
          className={`glass flex min-h-[56px] cursor-pointer items-center justify-center gap-2 !rounded-band px-4 py-4 text-sm font-bold text-ink ${
            busy ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-green"
          >
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
            <circle cx="12" cy="13" r="3.5" />
          </svg>
          {busy ? "Working…" : photo || preview ? "Take another photo" : "Take or choose a photo"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={onFile}
            disabled={busy}
          />
        </label>
      )}

      {status ? (
        <p role="status" className="px-1 text-sm text-muted">
          {status}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className={`pop px-4 py-3 text-sm font-medium text-ink ${
            error.soft ? "" : "shadow-[inset_3px_0_0_var(--ember),var(--shadow-pop)]"
          }`}
        >
          {error.text}
          {error.consent ? (
            <>
              {" "}
              <Link href="/profile" className="text-green underline">
                Open profile
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {preview ? (
        <figure className="relative">
          {/* Local object URL of the resized photo. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Your photo"
            className="max-h-72 w-full rounded-band object-cover"
          />
          <figcaption className="mark absolute bottom-2.5 left-3 bg-card text-ink">Your photo</figcaption>
        </figure>
      ) : null}

      {photo ? (
        <>
          <div className="flex items-center gap-2 rounded-[14px] bg-card py-1 pl-3 pr-1 shadow-[inset_3px_0_0_var(--ember)]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0 text-ember"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <p className="flex-1 text-xs leading-[1.35] text-ink">
              Deletes itself <strong>{photo.expiresLabel}</strong> (48 h). Only the numbers you log are kept.
            </p>
            <button
              type="button"
              onClick={deleteNow}
              disabled={busy}
              className="min-h-[44px] shrink-0 rounded-control px-2.5 text-xs font-bold text-ink underline disabled:opacity-50"
            >
              Delete now
            </button>
          </div>

          <section
            className="glass px-4 py-3.5"
            aria-labelledby="photo-result-h"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id="photo-result-h" className="text-sm font-bold text-ink">
                Here&apos;s what I see
              </h2>
              {photo.read.kind === "food" ? <span className="mark mark-amber">estimate</span> : null}
            </div>

            {/* FOOD */}
            {photo.read.kind === "food" ? (
              <>
                <ul className="mt-1.5 divide-y divide-hairline">
                  {foods.map((f, i) => (
                    <li key={i} className="py-2">
                      {editing ? (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="col-span-2 text-xs text-muted">
                            Food
                            <input
                              className={inputCls}
                              value={f.name}
                              onChange={(e) =>
                                setFoods((a) =>
                                  a.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                                )
                              }
                            />
                          </label>
                          {(
                            [
                              ["serving", "Serving", "text"],
                              ["kcal", "kcal", "decimal"],
                              ["protein_g", "Protein g", "decimal"],
                              ["carbs_g", "Carbs g", "decimal"],
                              ["fat_g", "Fat g", "decimal"],
                            ] as const
                          ).map(([key, label, mode]) => (
                            <label key={key} className="text-xs text-muted">
                              {label}
                              <input
                                className={inputCls}
                                inputMode={mode}
                                value={f[key]}
                                onChange={(e) =>
                                  setFoods((a) =>
                                    a.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x))
                                  )
                                }
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => setFoods((a) => a.filter((_, j) => j !== i))}
                            className="btn-secondary self-end text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="text-ink">
                            {f.name}
                            {f.serving ? `, ${f.serving}` : ""}
                          </span>
                          <span className="whitespace-nowrap tnum text-muted">
                            {f.kcal || "—"}
                            {f.protein_g ? ` · P${f.protein_g}` : ""}
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-1 flex items-center justify-between gap-3 border-t border-hairline pt-2">
                  <label className="flex items-center gap-2 text-[13px] text-ink">
                    Meal
                    <select
                      value={meal}
                      onChange={(e) => setMeal(e.target.value)}
                      className="field !px-2 text-[13px] font-bold capitalize"
                    >
                      {MEALS.map((m) => (
                        <option key={m} value={m}>
                          {m.charAt(0).toUpperCase() + m.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="tnum font-display text-lg font-bold text-ink">
                    {Math.round(totalKcal).toLocaleString("en-US")}{" "}
                    <span className="font-sans text-xs font-medium text-muted">kcal</span>
                  </p>
                </div>
              </>
            ) : null}

            {/* SCALE / WATCH */}
            {photo.read.kind === "scale" ? (
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-center justify-between gap-3 text-ink">
                  Weight ({unit})
                  {editing ? (
                    <input
                      className={`${inputCls} max-w-[8rem] text-right`}
                      inputMode="decimal"
                      value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                    />
                  ) : (
                    <span className="tnum font-display text-lg font-bold">{weight || "—"}</span>
                  )}
                </label>
                {photo.read.body_fat_pct != null ? (
                  <p className="flex justify-between text-muted">
                    <span>Body fat</span>
                    <span className="tnum">{photo.read.body_fat_pct}%</span>
                  </p>
                ) : null}
                {photo.read.steps != null ? (
                  <p className="flex justify-between text-muted">
                    <span>Steps</span>
                    <span className="tnum">{photo.read.steps.toLocaleString()}</span>
                  </p>
                ) : null}
                {photo.read.active_kcal != null ? (
                  <p className="flex justify-between text-muted">
                    <span>Active kcal</span>
                    <span className="tnum">{photo.read.active_kcal}</span>
                  </p>
                ) : null}
                {photo.read.date_shown ? (
                  <p className="text-xs text-muted">Date on screen: {photo.read.date_shown}</p>
                ) : null}
                <p className="text-xs text-muted">
                  Xclr saves your weight for today. The other numbers are shown, not saved yet.
                </p>
              </div>
            ) : null}

            {/* HEALTH PAPER */}
            {photo.read.kind === "health" ? (
              <>
                <p className="mt-2 text-sm text-muted">{photo.read.summary}</p>
                {editing ? (
                  <label className="mt-3 block text-xs text-muted">
                    Note title
                    <input
                      className={inputCls}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                ) : (
                  <p className="mt-3 text-sm font-medium text-ink">{title}</p>
                )}
                <ul className="mt-2 divide-y divide-hairline">
                  {readings.map((r, i) => (
                    <li key={i} className="py-2 text-sm">
                      {editing ? (
                        <div className="grid grid-cols-2 gap-2">
                          {(
                            [
                              ["name", "Item"],
                              ["value", "Value"],
                              ["unit", "Unit"],
                              ["reference_range", "Reference range"],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key} className="text-xs text-muted">
                              {label}
                              <input
                                className={inputCls}
                                value={r[key]}
                                onChange={(e) =>
                                  setReadings((a) =>
                                    a.map((x, j) => (j === i ? { ...x, [key]: e.target.value } : x))
                                  )
                                }
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => setReadings((a) => a.filter((_, j) => j !== i))}
                            className="btn-secondary col-span-2 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-ink">{r.name}</span>
                          <span className="text-right tnum text-muted">
                            {r.value}
                            {r.unit ? ` ${r.unit}` : ""}
                            {r.reference_range ? (
                              <span className="block text-xs">ref {r.reference_range}</span>
                            ) : null}
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {done ? (
              <p role="status" className="mt-3 rounded-[14px] bg-green-soft px-3 py-2 text-sm font-medium text-ink">
                {done}{" "}
                {photo.read.kind === "food" ? (
                  <Link href="/food" className="text-green underline">
                    See Food
                  </Link>
                ) : null}
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className="btn-primary btn-primary-green text-[13px]"
                >
                  {busy ? "Saving…" : confirmLabel}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  disabled={busy}
                  aria-pressed={editing}
                  className="btn-secondary text-[13px]"
                >
                  {editing ? "Done fixing" : "Fix amounts"}
                </button>
              </div>
            )}
          </section>
        </>
      ) : null}

      <p className="px-1 text-[11px] leading-[1.4] text-muted">
        Health paper photos (lab results, prescriptions) need health consent on. Xclr notes the
        values for your training. It never diagnoses.
      </p>

      <PhotoRecent photos={recent} />
    </main>
  );
}
