"use client";
import { useState } from "react";
import { questionImageCopy } from "@/contracts/form-system-copy";
import { useAuthorAsset } from "./AuthorAssetProvider";

function ResolvedQuestionImage({ url, language }: { url: string; language?: string | null }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const copy = questionImageCopy(language);
  if (failed) return <p className="cs-muted" role="status">{copy.unavailable}</p>;
  return <>
    {!loaded && <p className="cs-muted" role="status">{copy.loading}</p>}
    {/* Scoped no-store bytes use the viewer's cookies, never the shared image optimization cache. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt="" draggable={false} referrerPolicy="no-referrer"
      style={loaded ? undefined : { visibility: "hidden" }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
  </>;
}

/** A decorative question image, separate from selectable/zoomable option images. */
export function QuestionImage({ assetKey, language }: { assetKey?: string | null; language?: string | null }) {
  const { asset, loading } = useAuthorAsset(assetKey), copy = questionImageCopy(language);
  if (!assetKey) return null;
  const url = asset?.info.purpose === "QUESTION_IMAGE" && ["image/jpeg", "image/png"].includes(asset.info.mime) ? asset.url : undefined;
  return <div className="forms-question-image">
    {url ? <ResolvedQuestionImage key={url} url={url} language={language} />
      : <p className="cs-muted" role="status">{loading ? copy.loading : copy.unavailable}</p>}
  </div>;
}
