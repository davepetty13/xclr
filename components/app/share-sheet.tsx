"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cardToBlob,
  drawCard,
  loadCardFonts,
  type CardBackground,
  type CardFonts,
  type CardKind,
  type ShareBundle,
} from "@/lib/share-cards";
import { CARD_H, CARD_W } from "@/lib/share-card-theme";

// Share sheet (v3.8, ShareSheet mock). The card is drawn right here on the
// phone from the user's own numbers. A chosen photo is only drawn into the
// canvas — never uploaded, never stored — and is released when the sheet closes.

const TAB_NAME: Record<CardKind, string> = { session: "Session", week: "Week", pr: "PR" };
const HEADING: Record<CardKind, string> = {
  session: "Flex your session",
  week: "Flex your week",
  pr: "Flex your PR",
};
const SHARE_TITLE: Record<CardKind, string> = {
  session: "My Xclr session",
  week: "My Xclr week",
  pr: "My new PR on Xclr",
};

function saveFile(file: File): boolean {
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    if ("download" in a) {
      a.href = url;
      a.download = file.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(url, "_blank", "noopener");
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch {
    return false;
  }
}

export function ShareSheet({
  bundle,
  initialTab = "session",
  onClose,
}: {
  bundle: ShareBundle;
  initialTab?: CardKind;
  onClose: () => void;
}) {
  const tabs = (["session", "week", "pr"] as CardKind[]).filter((k) => bundle[k] != null);
  const [tab, setTab] = useState<CardKind>(tabs.includes(initialTab) ? initialTab : tabs[0] ?? "session");
  const [background, setBackground] = useState<CardBackground>(initialTab === "week" ? "paper" : "dark");
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [showNotes, setShowNotes] = useState(false); // off by default (privacy)
  const [showWeight, setShowWeight] = useState(false); // off by default (privacy)
  const [fonts, setFonts] = useState<CardFonts | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photoUrlRef = useRef<string | null>(null);
  const drawGen = useRef(0);
  const headingId = useId();
  const previewId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Fonts first (Sora 600/700/800 + Hanken Grotesk), then draw.
  useEffect(() => {
    let alive = true;
    void loadCardFonts().then((f) => {
      if (alive) setFonts(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Focus, Escape, and no page scroll behind the sheet.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, mounted]);

  // Release the photo when the sheet closes.
  useEffect(
    () => () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    },
    []
  );

  // Draw the card, then pre-make the PNG so "Share" can call navigator.share
  // straight from the tap (iPhone needs that).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fonts) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const gen = ++drawGen.current;
    setReady(false);
    fileRef.current = null;
    drawCard(ctx, tab, bundle, {
      background: background === "photo" && !photo ? "dark" : background,
      photo,
      showNotes,
      showWeight,
      fonts,
    });
    void cardToBlob(canvas).then((blob) => {
      if (gen !== drawGen.current || !blob) return;
      fileRef.current = new File([blob], `xclr-${tab}.png`, { type: "image/png" });
      setReady(true);
    });
  }, [tab, background, photo, showNotes, showWeight, fonts, bundle, mounted]);

  const pickPhoto = useCallback(() => {
    if (photo && background !== "photo") {
      setBackground("photo");
      return;
    }
    inputRef.current?.click();
  }, [photo, background]);

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow picking the same photo again
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setStatus("That file isn't a photo.");
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = url;
      setPhoto(img);
      setBackground("photo");
      setStatus(null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("Couldn't open that photo. Try another one.");
    };
    img.src = url;
  }

  function share() {
    const file = fileRef.current;
    if (!file) return;
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (nav?.share && nav.canShare?.({ files: [file] })) {
      nav.share({ files: [file], title: SHARE_TITLE[tab] }).then(
        () => setStatus(null),
        (err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return; // closed the share sheet
          setStatus(saveFile(file) ? "Sharing isn't available here, so the image was saved instead." : "Couldn't share the image.");
        }
      );
      return;
    }
    setStatus(
      saveFile(file)
        ? "Sharing isn't available in this browser — the image was saved so you can post it."
        : "Couldn't save the image."
    );
  }

  function save() {
    const file = fileRef.current;
    if (!file) return;
    setStatus(saveFile(file) ? "Image saved." : "Couldn't save the image.");
  }

  const noteToggle = tab === "session" && !!bundle.session?.note;
  const weightToggle = tab === "week" && !!bundle.week?.bodyWeight;

  if (!mounted) return null;

  const bgButton = (value: CardBackground, label: string, onClick: () => void) => {
    const active = background === value && (value !== "photo" || !!photo);
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`${active ? "btn-primary" : "btn-secondary"} w-full text-[13px]`}
      >
        {label}
      </button>
    );
  };

  return createPortal(
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-scrim" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="pop fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[92dvh] w-full max-w-md flex-col gap-3 overflow-y-auto !rounded-b-none px-[18px] pb-[calc(22px+env(safe-area-inset-bottom))] pt-2.5"
      >
        <span aria-hidden className="h-1 w-10 shrink-0 self-center rounded-sm bg-line" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={headingId} className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
            {HEADING[tab]}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-control bg-segment text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {tabs.length > 1 ? (
          <div role="tablist" aria-label="Card" className="flex gap-5 border-b border-hairline">
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                aria-controls={previewId}
                onClick={() => setTab(k)}
                className="tab"
              >
                {TAB_NAME[k]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-start gap-3.5">
          <div className="relative h-[288px] w-[162px] flex-none overflow-hidden rounded-[14px] bg-ink shadow-pop">
            <canvas
              id={previewId}
              ref={canvasRef}
              width={CARD_W}
              height={CARD_H}
              role="img"
              aria-label={`Preview of the ${TAB_NAME[tab].toLowerCase()} card`}
              className="h-full w-full"
            />
            {!fonts ? (
              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-faint">
                Drawing…
              </span>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <span id={`${previewId}-bg`} className="text-xs font-bold text-muted">
              Background
            </span>
            <div role="group" aria-labelledby={`${previewId}-bg`} className="flex flex-col gap-1.5">
              {bgButton("dark", "Dark", () => setBackground("dark"))}
              {bgButton("paper", "Paper", () => setBackground("paper"))}
              {bgButton(
                "photo",
                photo ? (background === "photo" ? "Change photo…" : "My photo") : "My photo…",
                pickPhoto
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={onPhoto}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>

            {noteToggle || weightToggle ? (
              <>
                <span className="mt-0.5 text-xs font-bold text-muted">On the card</span>
                {noteToggle ? (
                  <label className="flex min-h-[44px] items-center justify-between gap-2 text-[13px] font-medium text-ink">
                    Session notes
                    <input
                      type="checkbox"
                      checked={showNotes}
                      onChange={(e) => setShowNotes(e.target.checked)}
                      className="h-5 w-5 accent-green"
                    />
                  </label>
                ) : null}
                {weightToggle ? (
                  <label className="flex min-h-[44px] items-center justify-between gap-2 text-[13px] font-medium text-ink">
                    Body weight
                    <input
                      type="checkbox"
                      checked={showWeight}
                      onChange={(e) => setShowWeight(e.target.checked)}
                      className="h-5 w-5 accent-green"
                    />
                  </label>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <p className="text-[11px] leading-[1.4] text-muted">
          Weight and health notes are never on a card unless you switch them on. Made on your phone from your
          numbers — no AI, no cost.
          {background === "photo" && photo ? " Your photo stays on this phone." : ""}
        </p>
        {status ? (
          <p role="status" className="text-[13px] font-medium text-ink">
            {status}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <button
            type="button"
            onClick={save}
            disabled={!ready}
            className="btn-secondary min-h-[48px] rounded-[12px] text-sm"
          >
            Save image
          </button>
          <button
            type="button"
            onClick={share}
            disabled={!ready}
            aria-label={`Share the ${TAB_NAME[tab].toLowerCase()} card`}
            className="btn-primary btn-primary-green min-h-[48px] rounded-[12px] text-sm"
          >
            Share
          </button>
        </div>
      </section>
    </>,
    document.body
  );
}

// A button that opens the sheet (for server-rendered pages: pass plain data).
export function ShareButton({
  bundle,
  initialTab = "session",
  label,
  ariaLabel,
  className = "btn-secondary text-[13px]",
}: {
  bundle: ShareBundle;
  initialTab?: CardKind;
  label: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    ref.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        className={className}
      >
        {label}
      </button>
      {open ? <ShareSheet bundle={bundle} initialTab={initialTab} onClose={close} /> : null}
    </>
  );
}
