"use client";
import { useEffect, useRef, type RefObject } from "react";

const openDialogs: HTMLElement[] = [];
let scrollLocks = 0, savedOverflow = "";
const candidates = "a[href], button, input:not([type='hidden']), select, textarea, iframe, [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

export function focusableWithin(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(candidates)].filter(element =>
    !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}
export const isTopDialog = (dialog: HTMLElement) => openDialogs[openDialogs.length - 1] === dialog;
export const anyDialogOpen = () => openDialogs.length > 0;

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, initialSelector?: string) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDialogs.push(dialog);
    if (scrollLocks++ === 0) { savedOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    const items = focusableWithin(dialog);
    const initial = (initialSelector ? dialog.querySelector<HTMLElement>(initialSelector) : null) ?? dialog.querySelector<HTMLElement>("[data-autofocus]")
      ?? items.find(element => element.matches("input, select, textarea")) ?? items.find(element => !element.hasAttribute("data-dialog-close")) ?? dialog;
    initial.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog(dialog)) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(dialog);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = openDialogs.lastIndexOf(dialog);
      if (index >= 0) openDialogs.splice(index, 1);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [ref, initialSelector]);
}
