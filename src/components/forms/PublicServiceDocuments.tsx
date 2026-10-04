"use client";
import { Panel } from "../shared";
import { useResource } from "@/lib/api";
import { parseServiceDocumentPath, type PublicServiceDocument } from "@/contracts/public-service-documents";

const titles = { collection: "수집 항목 안내", recipients: "제공·수탁 안내", overseas: "국외 이전 안내", resident: "고유식별정보 안내" } as const;
export function PublicServiceDocuments({ path }: { path: string }) {
  const parsed = parseServiceDocumentPath(path);
  const query = parsed ? new URLSearchParams(parsed.query).toString() : "";
  const result = useResource<{ serviceName: string; companyName: string; items: PublicServiceDocument[] }>(parsed ? `/public/services/${parsed.serviceId}/documents?${query}` : null);
  const view = parsed?.query.view as keyof typeof titles | undefined;
  return <main className="document-public"><Panel>
    {!parsed ? <><h1>안내를 찾을 수 없습니다.</h1><p role="alert">공개 문서 경로를 확인해주세요.</p></> : result.error ? <><h1>안내를 열 수 없습니다.</h1><p role="alert">{result.error.message}</p></> : !result.data ? <p role="status">안내를 불러오는 중입니다.</p> : <>
      <h1>{titles[view ?? "collection"]}</h1>
      <p>{result.data.companyName} · {result.data.serviceName}</p>
      {result.data.items.length === 0 ? <p>게시 중인 안내가 없습니다.</p> : <ul>{result.data.items.map(item => <li key={item.url}><a href={item.url}>{item.title}</a> · v{item.number} · {item.effectiveDate}</li>)}</ul>}
    </>}
  </Panel></main>;
}
