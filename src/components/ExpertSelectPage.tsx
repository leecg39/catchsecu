"use client";
import { useState, type FormEvent } from "react";
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
  const assignments = useResource<ExpertAssignmentList>("/expert-assignments?scope=mine&pageSize=100");
  const [query, setQuery] = useState(""), [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const rows = assignments.data?.items.filter(item => item.companyName.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR"))) ?? [];
  async function select(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const selected = assignments.data?.items.find(item => item.companyId === companyId && item.canSelect);
      if (!selected) throw new Error("사용 가능한 배정 회사를 선택해주세요.");
      await api("/context", { method: "POST", body: JSON.stringify({ companyId: selected.companyId }) });
      router.push("/dashboard"); router.refresh();
    } catch (cause) { setError(errorText(cause)); assignments.reload(); } finally { setBusy(false); }
  }
  async function selectDirect(companyId: string) {
    setError(""); setBusy(true);
    try { await api("/context", { method: "POST", body: JSON.stringify({ companyId }) }); router.push("/dashboard"); router.refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <main className="expert-select-page"><h1>{profile.data?.name ?? "전문가"} 님, 좋은 하루입니다 😊</h1>
    <p>전문가 PLUS 를 진행하실 회사를 선택해주세요.</p>
    <form onSubmit={select}>
      <input className="cs-input" placeholder="회사 검색하기" aria-label="회사 검색하기" value={query} onChange={event => setQuery(event.target.value)} />
      {assignments.loading && <p role="status">배정된 회사를 불러오는 중입니다.</p>}
      {assignments.error && <><p role="alert">{assignments.error.message}</p><ActionButton type="button" secondary onClick={assignments.reload}>다시 시도</ActionButton></>}
      {assignments.data && !rows.length && <p>전문가 PLUS 로 배정 된 회사가 없습니다.</p>}
      {rows.length > 0 && <div className="expert-company-list" role="radiogroup" aria-label="배정된 회사">
        {rows.map(item => <label key={item.id} className="expert-company-item">
          <input type="radio" name="company" value={item.companyId} checked={companyId === item.companyId} disabled={!item.canSelect}
            onChange={() => setCompanyId(item.companyId)} />
          <span><strong>{item.companyName}</strong><small>{item.services.filter(service => service.status === "active").map(service => service.name).join(", ") || "사용 가능한 서비스 없음"}
            {item.status !== "active" && ` · ${expertStatusLabels[item.status]}`}</small></span>
        </label>)}</div>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      <ActionButton disabled={!companyId || busy}>{busy ? "확인 중…" : "전문가 PLUS 시작하기"}</ActionButton>
    </form>
    <div className="public-actions">{context.data?.memberships.filter(item => item.accessKind === "direct").map(item =>
      <button key={item.tenantId} className="cs-link" disabled={busy} onClick={() => selectDirect(item.tenantId)}>내 회사: {item.tenant.name}</button>)}
      {context.data?.user.platformAdmin && <Link href="/admin/expert-assignments">전문가 배정 관리</Link>}
      <Link href="/logout">로그아웃</Link></div>
  </main>;
}
