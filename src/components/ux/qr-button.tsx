"use client";
import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import { Modal } from "../shared";

export function QrButton({ url, name, filename }: { url: string; name: string; filename?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="ux-icon-button" aria-label={`${name} QR 코드`} title="QR 코드" onClick={() => setOpen(true)}>
      <QrCode size={15} aria-hidden="true" />
    </button>
    {open && <QrDialog url={url} name={name} filename={filename} onClose={() => setOpen(false)} />}
  </>;
}

function QrDialog({ url, name, filename, onClose }: { url: string; name: string; filename?: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState(""), [error, setError] = useState("");
  const absolute = url.startsWith("/") ? new URL(url, window.location.href).href : url;
  const safe = (filename ?? name).replace(/[^\w가-힣.-]+/g, "_") || "qr";
  useEffect(() => {
    let alive = true;
    import("qrcode").then(qr => qr.toDataURL(absolute, { width: 240, margin: 1, errorCorrectionLevel: "M" }))
      .then(png => { if (alive) setDataUrl(png); })
      .catch(() => { if (alive) setError("QR 코드를 만들지 못했습니다. 잠시 후 다시 시도해주세요."); });
    return () => { alive = false; };
  }, [absolute]);
  return <Modal title={`${name} QR 코드`} onClose={onClose}>
    <div className="ux-qr">
      {dataUrl ? <img src={dataUrl} width={200} height={200} alt={`${name} 주소 QR 코드`} />
        : error ? <p role="alert">{error}</p> : <p role="status">QR 코드 생성 중…</p>}
      <code className="ux-qr-url">{absolute}</code>
      {dataUrl && <a className="cs-button secondary" href={dataUrl} download={`${safe}-qr.png`}>PNG 다운로드</a>}
    </div>
  </Modal>;
}
