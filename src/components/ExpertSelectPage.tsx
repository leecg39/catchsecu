"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorText, useResource } from "@/lib/api";
import type { Application } from "./ApplicationContext";
import type { ExpertAssignmentList } from "@/contracts/expert-assignments";
import { expertStatusLabels } from "@/contracts/expert-assignments";
import { ActionButton } from "./shared";

export function ExpertSelectPage() {
  const router = useRouter();
  const profile = useResource<{ name: string }>("/me");
  const context = useResource<Application>("/context");
  const [query, setQuery] = useState(""), [companyId, setCompanyId] = useState("");
  const [page, setPage] = useState(1), pageSize = 20;
  const assignments = useResource<ExpertAssignmentList>("/expert-assignments?scope=mine&pageSize=" + pageSize + "&page=" + page + "&search=" + encodeURIComponent(query.trim()));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), rows = assignments.data?.items ?? [], selected = rows.find(item => item.companyId === companyId);
  async function select(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return; lock.current = true; setError(""); setBusy(true);
    try {
      const selected = assignments.data?.items.find(item => item.companyId === companyId && item.canSelect);
      if (!selected) throw new Error("사용 가능한 배정 회사를 선택해주세요.");
      await api("/context", { method: "POST", body: JSON.stringify({ companyId: selected.companyId }) });
      router.push("/dashboard"); router.refresh();
    } catch (cause) { setError(errorText(cause)); assignments.reload(); } finally { lock.current = false; setBusy(false); }
  }
  async function selectDirect(companyId: string) {
    if (lock.current) return; lock.current = true; setError(""); setBusy(true);
    try { await api("/context", { method: "POST", body: JSON.stringify({ companyId }) }); router.push("/dashboard"); router.refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { lock.current = false; setBusy(false); }
  }
  return <main className="expert-select-page"><h1>{profile.data?.name ?? "전문가"} 님, 좋은 하루입니다 😊</h1>
    <p>전문가 PLUS 를 진행하실 회사를 선택해주세요.</p>
    <form onSubmit={select}>
      <input className="cs-input" placeholder="회사 검색하기" aria-label="회사 검색하기" value={query} disabled={busy} maxLength={100}
        onChange={event => { setQuery(event.target.value); setPage(1); setCompanyId(""); setError(""); }} />
      {assignments.loading && <p role="status">배정된 회사를 불러오는 중입니다.</p>}
      {assignments.error && <><p role="alert">{assignments.error.message}</p><ActionButton type="button" secondary onClick={assignments.reload}>다시 시도</ActionButton></>}
      {assignments.data && !rows.length && <p>{query.trim() ? "검색 결과가 없습니다." : "전문가 PLUS 로 배정 된 회사가 없습니다."}</p>}
      {rows.length > 0 && <div className="expert-company-list" role="radiogroup" aria-label="배정된 회사">
        {rows.map(item => <label key={item.id} className="expert-company-item">
          <input type="radio" name="company" value={item.companyId} checked={companyId === item.companyId} disabled={!item.canSelect || busy}
            onChange={() => setCompanyId(item.companyId)} />
          <span><strong>{item.companyName}</strong><small>{item.services.filter(service => service.status === "active").map(service => service.name).join(", ") || "사용 가능한 서비스 없음"}
            {item.status !== "active" && ` · ${expertStatusLabels[item.status]}`}</small></span>
        </label>)}</div>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {assignments.data && <div className="cs-pagination"><span>총 {assignments.data.total}개</span><div>
        <button type="button" aria-label="이전 페이지" disabled={busy || assignments.loading || page <= 1}
          onClick={() => { setPage(page - 1); setCompanyId(""); }}>‹</button>
        <span>{page} / {Math.max(1, Math.ceil(assignments.data.total / pageSize))}</span>
        <button type="button" aria-label="다음 페이지" disabled={busy || assignments.loading || page * pageSize >= assignments.data.total}
          onClick={() => { setPage(page + 1); setCompanyId(""); }}>›</button>
      </div></div>}
      <ActionButton disabled={!selected?.canSelect || assignments.loading || busy}>{busy ? "확인 중…" : "전문가 PLUS 시작하기"}</ActionButton>
    </form>
    <div className="public-actions">{context.data?.memberships.filter(item => item.accessKind === "direct").map(item =>
      <button key={item.tenantId} className="cs-link" disabled={busy} onClick={() => selectDirect(item.tenantId)}>내 회사: {item.tenant.name}</button>)}
      {context.data?.user.platformAdmin && <Link href="/admin/expert-assignments">전문가 배정 관리</Link>}
      <Link href="/logout">로그아웃</Link></div>
  </main>;
}
