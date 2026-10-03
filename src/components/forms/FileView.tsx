"use client";
import { useState } from "react";
import Link from "next/link";
import { useResource } from "@/lib/api";
import { fileDownloadUrl, sharedFileDownloadUrl } from "@/lib/file-upload";
import type { FileInfo } from "@/contracts/files";
import { Panel } from "../shared";

export function FileView({ path }: { path: string }) {
  const segments = path.split("/").filter(Boolean), [, submissionId, questionId, fileId] = segments;
  const shared = segments.at(-1) === "shared", [page, setPage] = useState(1);
  const single = !!fileId && fileId !== "shared";
  const valid = shared ? segments.length === 3 || segments.length === 5 : segments.length === 2 || segments.length === 4;
  const base = shared ? "/viewer/files" : "/files";
  const endpoint = valid ? single ? base + "/" + fileId + "?" + new URLSearchParams({ submissionId, questionId }) :
    base + "?" + new URLSearchParams({ submissionId, page: String(page), pageSize: "20" }) : null;
  const resource = useResource<FileInfo | { items: FileInfo[]; total: number }>(endpoint);
  const items = resource.data ? "items" in resource.data ? resource.data.items : [resource.data] : [];
  return <div className="public-standalone"><Panel title="파일 보기">
    {!valid ? <p role="alert">파일 링크를 확인해주세요.</p> : resource.loading ? <p role="status">파일을 불러오는 중입니다.</p> :
      resource.error ? <><p role="alert">{resource.error.message}</p>{resource.error.status === 401 && <Link className="cs-button" href={(shared ? "/shared-privacy/verify?returnTo=" : "/login?returnTo=") + encodeURIComponent(path)}>{shared ? "이메일 인증" : "로그인"}</Link>}</> :
      items.length ? <ul className="cs-stack">{items.map(file => <li key={file.id}><strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)}KB
        <p><a className="cs-button secondary" href={(shared ? sharedFileDownloadUrl : fileDownloadUrl)(file.id, submissionId, file.questionId!)}>다운로드</a></p></li>)}</ul> :
      <p>첨부파일이 없습니다.</p>}
    {resource.data && "total" in resource.data && resource.data.total > 20 && <div className="cs-row">
      <button disabled={page === 1} onClick={() => setPage(value => value - 1)}>이전</button><span>{page} 페이지</span>
      <button disabled={page * 20 >= resource.data.total} onClick={() => setPage(value => value + 1)}>다음</button></div>}
  </Panel></div>;
}
