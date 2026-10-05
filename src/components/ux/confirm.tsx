"use client";
import { createContext, useCallback, useContext, useId, useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "./focus";

export type ConfirmOptions = { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default" };
type Pending = ConfirmOptions & { resolve: (accepted: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    current.current?.resolve(false);
    current.current = { ...options, resolve };
    setPending(current.current);
  }), []);
  const settle = useCallback((accepted: boolean) => {
    current.current?.resolve(accepted);
    current.current = null;
    setPending(null);
  }, []);
  return <ConfirmContext.Provider value={confirm}>{children}{pending && <ConfirmDialog {...pending} onSettle={settle} />}</ConfirmContext.Provider>;
}

function ConfirmDialog({ title, message, confirmLabel = "확인", cancelLabel = "취소", tone = "danger", onSettle }: ConfirmOptions & { onSettle: (accepted: boolean) => void }) {
  const ref = useRef<HTMLElement>(null), id = useId();
  useDialogFocus(ref, () => onSettle(false), "[data-confirm-cancel]");
  return <div className="cs-backdrop" onClick={() => onSettle(false)}>
    <section ref={ref} className="cs-modal ux-confirm" role="alertdialog" aria-modal="true" aria-labelledby={id + "-title"}
      aria-describedby={message ? id + "-message" : undefined} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <header><h2 id={id + "-title"}>{title}</h2></header>
      <div className="cs-modal-body">
        {message && <div id={id + "-message"} className="ux-confirm-message">{message}</div>}
        <div className="ux-confirm-actions">
          <button type="button" className="cs-button secondary" data-confirm-cancel onClick={() => onSettle(false)}>{cancelLabel}</button>
          <button type="button" className={"cs-button" + (tone === "danger" ? " ux-danger" : "")} onClick={() => onSettle(true)}>{confirmLabel}</button>
        </div>
      </div>
    </section>
  </div>;
}
