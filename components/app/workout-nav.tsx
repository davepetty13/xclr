"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SUB = [
  { href: "/workout", label: "Today" },
  { href: "/workout/progress", label: "Progress" },
  { href: "/workout/review", label: "Review" },
  { href: "/workout/history", label: "History" },
] as const;

export function WorkoutNav() {
  const path = usePathname();
  return (
    <div className="flex gap-1 rounded-chip border border-line bg-paper p-1">
      {SUB.map((s) => {
        const active =
          s.href === "/workout" ? path === "/workout" : path.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={`flex-1 rounded-tile px-2 py-2 text-center text-xs font-semibold transition-colors ${
              active ? "bg-card text-ink shadow-card" : "text-muted"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}
