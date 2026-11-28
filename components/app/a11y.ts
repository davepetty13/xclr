"use client";

import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

// Shared keyboard helpers for sheets, tabs and radio groups.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getClientRects().length > 0
  );
}

// Keeps Tab / Shift+Tab inside an open sheet: past the last control goes back
// to the first, and the other way round. Focus that escaped (e.g. a click on
// the scrim) is pulled back in on the next Tab.
export function useFocusTrap(ref: RefObject<HTMLElement>, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const list = focusables(root);
      if (!list.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const at = document.activeElement as HTMLElement | null;
      const inside = !!at && root.contains(at);
      if (e.shiftKey && (!inside || at === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || at === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, active]);
}

// Arrow keys for a role="radiogroup" of role="radio" buttons (roving focus):
// Left/Up = previous, Right/Down = next, Home/End = first/last. Disabled
// options are skipped. Give each radio tabIndex={checked ? 0 : -1}.
export function radioKeys<T>(
  options: readonly T[],
  current: T,
  choose: (v: T) => void,
  isDisabled: (v: T) => boolean = () => false
) {
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : e.key === "Home" || e.key === "End"
            ? 0
            : null;
    if (step == null) return;
    e.preventDefault();
    const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !isDisabled(o));
    if (!enabled.length) return;
    let target: { o: T; i: number };
    if (e.key === "Home") target = enabled[0];
    else if (e.key === "End") target = enabled[enabled.length - 1];
    else {
      const at = Math.max(0, enabled.findIndex(({ o }) => o === current));
      target = enabled[(at + step + enabled.length) % enabled.length];
    }
    choose(target.o);
    const radios = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    radios[target.i]?.focus();
  };
}
