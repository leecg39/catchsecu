"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthorAsset } from "./AuthorAssetProvider";
import { useDialogFocus } from "../ux/focus";
import { formSystemCopy } from "@/contracts/form-system-copy";

function ImageDialog({ url, title, closeLabel, onClose }: { url: string; title: string; closeLabel: string; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, onClose);
  return createPortal(<div className="forms-image-backdrop" onClick={onClose}>
    <section ref={ref} className="forms-image-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={event => event.stopPropagation()}>
      <button type="button" data-dialog-close aria-label={closeLabel} onClick={onClose}>×</button>
      {/* Authenticated, no-store bytes must be fetched directly with the viewer's cookies. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={title} referrerPolicy="no-referrer" />
    </section>
  </div>, document.body);
}
export function OptionImage({ assetKey, label, reserve = false, language }: { assetKey?: string | null; label: string; reserve?: boolean; language?: string | null }) {
  const { asset } = useAuthorAsset(assetKey), [opened, setOpened] = useState<string>(), [failed, setFailed] = useState<string>();
  if (!assetKey && !reserve) return null;
  const copy = formSystemCopy(language).optionImage;
  const url = asset?.info.purpose === "OPTION_IMAGE" && ["image/jpeg", "image/png"].includes(asset.info.mime) ? asset.url : undefined;
  if (!url || failed === url) return <span className="forms-option-image-slot" aria-hidden="true" />;
  const title = label + " · " + copy.zoomTitle;
  return <><a className="forms-option-image" href={url} role="button" aria-label={title} referrerPolicy="no-referrer"
    onClick={event => { event.preventDefault(); event.stopPropagation(); setOpened(url); }}
    onKeyDown={event => { if (event.key === " ") { event.preventDefault(); event.stopPropagation(); setOpened(url); } }}>
    {/* Keep private scoped downloads out of the shared image optimization cache. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} width={72} height={72} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
  </a>{opened === url && <ImageDialog url={url} title={title} closeLabel={copy.zoomClose} onClose={() => setOpened(undefined)} />}</>;
}
