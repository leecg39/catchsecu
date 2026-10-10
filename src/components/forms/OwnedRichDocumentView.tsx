"use client";
import { richDocumentImages, richDocumentSchema } from "@/contracts/rich-content";
import { useAuthorAssetResolver } from "./AuthorAssetProvider";
import { RichDocumentView } from "./RichDocumentView";

export function OwnedRichDocumentView({ document, className }: { document: unknown; className?: string }) {
  const resolver = useAuthorAssetResolver(), parsed = richDocumentSchema.parse(document);
  const imageUrls = Object.fromEntries(richDocumentImages(parsed).flatMap(image => {
    const resolved = resolver.find(image.assetId);
    return resolved ? [[image.assetId, resolved.url]] : [];
  }));
  return <><RichDocumentView document={parsed} imageUrls={imageUrls} className={className} />
    {resolver.error && <p role="alert">본문 이미지를 불러오지 못했습니다: {resolver.error}</p>}
    {resolver.loading && richDocumentImages(parsed).length > 0 && <p role="status" className="cs-muted">본문 이미지를 불러오는 중입니다.</p>}</>;
}
