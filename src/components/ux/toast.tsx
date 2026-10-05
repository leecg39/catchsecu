"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import "./ux.css";

export type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const sequence = useRef(0);
  const dismiss = useCallback((id: number) => setItems(list => list.filter(item => item.id !== id)), []);
  const show = useCallback<ShowToast>((message, tone = "success") => {
    const id = ++sequence.current;
    setItems(list => [...list.slice(-2), { id, message, tone }]);
  }, []);
  return <ToastContext.Provider value={show}>{children}
    <div className="ux-toasts" aria-live="polite" aria-relevant="additions">
      {items.map(item => <Toast key={item.id} item={item} onClose={dismiss} />)}
    </div>
  </ToastContext.Provider>;
}

function Toast({ item, onClose }: { item: ToastItem; onClose: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onClose(item.id), item.tone === "error" ? 7000 : 4000);
    return () => window.clearTimeout(timer);
  }, [item, onClose, paused]);
  return <div className={`ux-toast ${item.tone}`} role={item.tone === "error" ? "alert" : "status"}
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <span className="ux-toast-icon" aria-hidden="true">{item.tone === "error" ? "!" : item.tone === "info" ? "i" : "✓"}</span>
    <p>{item.message}</p>
    <button type="button" aria-label="알림 닫기" onClick={() => onClose(item.id)}>×</button>
  </div>;
}
