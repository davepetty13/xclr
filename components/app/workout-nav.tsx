"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUB = [
  { href: "/workout", label: "Today" },
  { href: "/workout/progress", label: "Progress" },
  { href: "/workout/review", label: "Review" },
  { href: "/workout/history", label: "History" },
] as const;

// Plain-word tabs (Glass · Sora): active = ink 700 + underline + ember dot,
// styled by the `tab` class off aria-current.
export function WorkoutNav({ pendingReviews = 0 }: { pendingReviews?: number }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Training views"
      className="flex gap-[22px] border-b border-hairline px-1"
    >
      {SUB.map((s) => {
        const active =
          s.href === "/workout" ? path === "/workout" : path.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className="tab"
          >
            {s.label}
            {s.href === "/workout/review" && pendingReviews > 0 ? (
              <span className="tnum font-bold text-ember-text">
                {pendingReviews}
                <span className="sr-only"> pending</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
