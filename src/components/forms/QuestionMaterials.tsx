"use client";
import { ExternalLink, Download } from "lucide-react";
import type { Question } from "@/contracts/forms";
import { questionMaterialSchema } from "@/contracts/question-materials";
import { formSystemCopy } from "@/contracts/form-system-copy";
import { useAuthorAsset } from "./AuthorAssetProvider";
import { authorAssetSizeLabel } from "@/lib/author-assets";

function MaterialFile({ assetKey, downloadLabel }: { assetKey: string; downloadLabel: string }) {
  const { asset, loading, error } = useAuthorAsset(assetKey);
  if (!asset || asset.info.purpose !== "QUESTION_MATERIAL") return <span className="cs-muted" role="status">{loading ? "자료를 불러오는 중…" : error ?? "첨부 자료를 불러올 수 없습니다."}</span>;
  return <a href={asset.url} download={asset.info.name} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
    aria-label={`${asset.info.name} · ${downloadLabel}`}><span dir="auto">{asset.info.name}</span>
    <small>{authorAssetSizeLabel(asset.info.size)}</small><Download size={16} aria-hidden="true" /></a>;
}

export function QuestionMaterials({ question, language }: { question: Pick<Question, "materialList">; language?: string | null }) {
  const materials = (question.materialList ?? []).flatMap(value => {
    const checked = questionMaterialSchema.safeParse(value);
    return checked.success ? [checked.data] : [];
  });
  if (!materials.length) return null;
  const { openInNewTab: openLabel, download } = formSystemCopy(language).questionMaterial;
  return <ul className="forms-question-materials">{materials.map((material, index) => <li key={index}>
    {material.materialType === "FILE" ? <MaterialFile assetKey={material.fileKey} downloadLabel={download} /> : <a href={material.linkUrl} target="_blank" rel="noopener noreferrer" title={material.linkUrl}
      aria-label={`${material.linkLabel} · ${openLabel}`}><span dir="auto">{material.linkLabel}</span><ExternalLink size={16} aria-hidden="true" /></a>}
  </li>)}</ul>;
}
