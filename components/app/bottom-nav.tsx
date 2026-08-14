"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today" },
  { href: "/food", label: "Food" },
  { href: "/workout", label: "Workout" },
  { href: "/chat", label: "Chat" },
  { href: "/goals", label: "Goals" },
] as const;

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card">
      <div className="mx-auto flex w-full max-w-md">
        {TABS.map((t) => {
          const active =
            t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-semibold transition-colors ${
                active ? "text-green" : "text-faint"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  active ? "bg-green" : "bg-transparent"
                }`}
              />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
