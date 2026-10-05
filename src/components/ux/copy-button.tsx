"use client";
import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "./toast";

export function CopyButton({ text, label = "복사", copied = "복사됐습니다." }: { text: string; label?: string; copied?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  async function copy() {
    try {
      const value = text.startsWith("/") ? new URL(text, window.location.href).href : text;
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const area = document.createElement("textarea");
        area.value = value;
        area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      toast(copied);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
    } catch {
      toast("복사에 실패했습니다. 주소를 직접 선택해 복사해주세요.", "error");
    }
  }
  return <button type="button" className="ux-icon-button" aria-label={label} title={label} onClick={copy}>
    {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
  </button>;
}
