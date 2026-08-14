"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Icon paths lifted from xclr-mock-v2.html's bottom nav (home / fork / dumbbell /
// chat bubble / target). Stroke is currentColor so the active/inactive text
// tokens color them.
const TABS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "/",
    label: "Today",
    icon: (
      <>
        <path d="M3 10.5L12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </>
    ),
  },
  {
    href: "/food",
    label: "Food",
    icon: (
      <>
        <path d="M4 3v8a3 3 0 003 3v7M7 3v6M10 3v6" />
        <path d="M17 3c-1.5 0-3 2-3 5s1 4 3 4v9" />
      </>
    ),
  },
  {
    href: "/workout",
    label: "Workout",
    icon: <path d="M6 8v8M18 8v8M4 10v4M20 10v4M6 12h12" />,
  },
  {
    href: "/chat",
    label: "Chat",
    icon: (
      <path d="M21 11.5a8.38 8.38 0 01-8.5 8.5 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 014 11.5 8.5 8.5 0 0112.5 3 8.38 8.38 0 0121 11.5z" />
    ),
  },
  {
    href: "/goals",
    label: "Goals",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.5" />
      </>
    ),
  },
];

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
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {t.icon}
              </svg>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
