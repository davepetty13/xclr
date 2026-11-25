"use client";

// Route-level error boundary for the app tabs. Plain words, no blame.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-col gap-3 px-4 pb-6 pt-5">
      <section
        role="alert"
        className="pop flex flex-col gap-3 px-4 py-4 shadow-[inset_3px_0_0_var(--ember),var(--shadow-pop)]"
      >
        <p className="text-sm font-medium text-ink">Something didn&apos;t load. Your data is safe.</p>
        <button type="button" onClick={() => reset()} className="btn-secondary w-full text-sm">
          Try again
        </button>
      </section>
    </main>
  );
}
