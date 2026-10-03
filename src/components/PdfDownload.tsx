"use client";
import { useState } from "react";
import { errorText } from "@/lib/api";
export function PdfDownload({ path, label = "PDF 다운로드" }: { path: string; label?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function download() {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1" + path, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "PDF를 내려받지 못했습니다."); }
      if (!response.headers.get("content-type")?.startsWith("application/pdf")) throw new Error("PDF 파일 형식을 확인할 수 없습니다.");
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement("a");
      const encoded = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      anchor.href = url; anchor.download = encoded ? decodeURIComponent(encoded) : "document.pdf";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <span className="pdf-download"><button type="button" className="cs-link" disabled={busy} onClick={download}>{busy ? "PDF 준비 중…" : label}</button>{error && <span role="alert">{error}</span>}</span>;
}
