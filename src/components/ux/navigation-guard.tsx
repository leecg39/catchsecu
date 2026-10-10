"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useId, useMemo, useRef, type ComponentProps, type ReactNode } from "react";
import { useConfirm } from "./confirm";
import { protectHistoryNavigation, type HistoryNavigation } from "@/lib/history-guard";

const defaultMessage = "저장하지 않은 변경 사항이 있습니다. 이 화면을 나가면 입력한 내용이 사라집니다.";
type Guard = { set: (id: string, message: string | null) => void; blocked: () => boolean; confirmLeave: () => Promise<boolean>; discardConfirmedChanges: () => void };
const GuardContext = createContext<Guard>({ set: () => {}, blocked: () => false, confirmLeave: async () => true, discardConfirmedChanges: () => {} });
export const useNavigationGuard = () => useContext(GuardContext);

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guards = useRef(new Map<string, string>());
  const ask = useConfirm();
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!guards.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const guard = useMemo<Guard>(() => ({
    set: (id, message) => { if (message) guards.current.set(id, message); else guards.current.delete(id); },
    blocked: () => guards.current.size > 0,
    confirmLeave: async () => !guards.current.size || ask({ title: "저장하지 않은 변경 사항", message: guards.current.values().next().value ?? defaultMessage, confirmLabel: "나가기", cancelLabel: "계속 편집" }),
    // Use only after the user confirmed and a context change committed, immediately before navigation.
    discardConfirmedChanges: () => guards.current.clear(),
  }), [ask]);
  useEffect(() => {
    const navigation = (window as Window & { navigation?: HistoryNavigation }).navigation;
    if (navigation) return protectHistoryNavigation(navigation, guard.blocked, guard.confirmLeave);
  }, [guard]);
  return <GuardContext.Provider value={guard}>{children}</GuardContext.Provider>;
}

export function useUnsavedChanges(dirty: boolean, message = defaultMessage) {
  const { set } = useContext(GuardContext), id = useId();
  useEffect(() => { set(id, dirty ? message : null); return () => set(id, null); }, [dirty, message, id, set]);
}

type Href = ComponentProps<typeof Link>["href"];
function hrefText(href: Href) {
  if (typeof href === "string") return href;
  const query = href.query && typeof href.query === "object"
    ? new URLSearchParams(Object.entries(href.query).flatMap(([key, value]) => value == null ? [] : (Array.isArray(value) ? value : [value]).map(item => [key, String(item)]))).toString() : "";
  return (href.pathname ?? "") + (query ? "?" + query : href.search ?? "") + (href.hash ?? "");
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const guard = useContext(GuardContext), router = useRouter();
  return <Link {...props} onNavigate={event => {
    onNavigate?.(event);
    if (!guard.blocked()) return;
    event.preventDefault();
    void guard.confirmLeave().then(leave => {
      if (!leave) return;
      const target = hrefText(props.href);
      if (props.replace) router.replace(target); else router.push(target);
    });
  }} />;
}
