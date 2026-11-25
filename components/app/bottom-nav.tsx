"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Glass v3 nav: solid white bar, hairline top, 5 items. Active = ink label +
// green icon. Height is exactly h-20 (+ safe area); the chat composer is pinned
// at that offset, so keep them in sync.
const TABS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "/",
    label: "Today",
    icon: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  },
  {
    href: "/food",
    label: "Food",
    icon: (
      <>
        <path d="M3 12h18a9 9 0 0 1-18 0z" />
        <path d="M9 8c0-2 2-2 2-4M14 8c0-2 2-2 2-4" />
      </>
    ),
  },
  {
    href: "/workout",
    label: "Train",
    icon: <path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12" />,
  },
  {
    href: "/chat",
    label: "Coach",
    icon: <path d="M4 5h16v11H9l-5 4z" />,
  },
  {
    href: "/goals",
    label: "Goals",
    icon: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
  },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--hairline)]"
    >
      <div className="mx-auto flex h-20 w-full max-w-md items-start justify-around pt-2">
        {TABS.map((t) => {
          const active =
            t.href === "/"
              ? path === "/"
              : path.startsWith(t.href) ||
                (t.href === "/goals" && path.startsWith("/profile")) ||
                (t.href === "/chat" && path.startsWith("/photo"));
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] w-16 flex-col items-center gap-[3px] text-[11px] ${
                active ? "font-bold text-ink" : "font-semibold text-muted"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth={active ? 2 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={active ? "text-green" : undefined}
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
